import { workspaceRequestHeaders } from "../workspace-mode.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import { VoiceEpoch } from "./voice-audio.ts";
import { smoothLevel, visualLevel } from "./voice-levels.ts";
import { markLatency } from "./latency.ts";

type Phase = "idle" | "requesting" | "listening" | "speaking" | "recognizing";
interface Options { scope: string; onTranscript(text: string): void; onSpeechStart(): void; onStart(): void }

/** One explicit microphone session. Finals auto-submit; capture is never restarted after navigation or hide. */
export function useVoiceInput({ scope, onTranscript, onSpeechStart, onStart }: Options) {
  const [phase, setPhase] = useState<Phase>("idle"), [partial, setPartial] = useState("");
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [level, setLevel] = useState(0), levelRef = useRef(0);
  const publishedLevel = useRef({ value: 0, at: 0 });
  const alive = useRef(true), phaseRef = useRef<Phase>("idle"), epoch = useRef(new VoiceEpoch());
  const callbacks = useRef({ onTranscript, onSpeechStart, onStart }); callbacks.current = { onTranscript, onSpeechStart, onStart };
  const activeScope = useRef(scope); activeScope.current = scope;
  const media = useRef<MediaStream | null>(null), context = useRef<AudioContext | null>(null);
  const processor = useRef<AudioWorkletNode | null>(null), socket = useRef<WebSocket | null>(null);
  const request = useRef<AbortController | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recognitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updatePhase = useCallback((value: Phase) => { phaseRef.current = value; if (alive.current) setPhase(value); }, []);
  const stop = useCallback(() => {
    epoch.current.next(); request.current?.abort(); request.current = null;
    if (timer.current) clearTimeout(timer.current); timer.current = null;
    if (recognitionTimer.current) clearTimeout(recognitionTimer.current); recognitionTimer.current = null;
    if (processor.current) { processor.current.port.onmessage = null; processor.current.disconnect(); processor.current = null; }
    media.current?.getTracks().forEach(track => track.stop()); media.current = null;
    if (context.current) { void context.current.close().catch(() => {}); context.current = null; }
    if (socket.current) {
      socket.current.onopen = null; socket.current.onmessage = null; socket.current.onerror = null; socket.current.onclose = null;
      if (socket.current.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ type: "close" }));
      socket.current.close(); socket.current = null;
    }
    levelRef.current = 0;
    publishedLevel.current = { value: 0, at: 0 };
    updatePhase("idle"); if (alive.current) { setPartial(""); setNotice(""); setLevel(0); }
  }, [updatePhase]);
  const start = useCallback(async () => {
    if (phaseRef.current !== "idle" || document.hidden) return;
    stop(); callbacks.current.onStart(); setError(""); setNotice(""); updatePhase("requesting");
    const token = epoch.current.next(), capturedScope = activeScope.current;
    const valid = () => alive.current && epoch.current.current(token) && activeScope.current === capturedScope && !document.hidden;
    const fail = (message: string) => { if (!valid()) return; stop(); setError(message); };
    timer.current = setTimeout(() => fail("语音连接超时，请重新开启"), 25000);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === "undefined") throw new Error("当前环境不支持实时语音输入。");
      if (window.orbitDesktop && !await window.orbitDesktop.requestMicrophonePermission()) throw new Error("请在系统设置中允许 Orbit 使用麦克风，然后重新点击麦克风。");
      if (!valid()) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (!valid()) { stream.getTracks().forEach(track => track.stop()); return; }
      media.current = stream;
      stream.getAudioTracks().forEach(track => { track.onended = () => fail("麦克风已断开，请重新开启"); });
      const audioContext = new AudioContext({ sampleRate: 16000 }); context.current = audioContext;
      await audioContext.audioWorklet.addModule(new URL("./voice-pcm-worklet.js", import.meta.url));
      if (!valid()) return;
      await audioContext.resume(); if (!valid()) return;
      const controller = new AbortController(); request.current = controller;
      const response = await fetch("/api/voice/stream-session", { method: "POST", headers: workspaceRequestHeaders(), signal: controller.signal });
      const session = await response.json(); if (!valid()) return;
      if (!response.ok) throw new Error(typeof session.error === "string" ? session.error : "无法开启语音，请稍后重试");
      if (typeof session.ticket !== "string" || session.path !== "/api/voice/stream") throw new Error("语音连接配置无效");
      const url = new URL(session.path, location.href); url.protocol = location.protocol === "https:" ? "wss:" : "ws:"; url.searchParams.set("ticket", session.ticket);
      const ws = new WebSocket(url); socket.current = ws;
      const accepted = new Set<string>(); let speakingId = "", pendingUtterance = false, locallyPaused = false, localSpeaking = false, lastPartial = "";
      const clearRecognitionTimer = () => { if (recognitionTimer.current) clearTimeout(recognitionTimer.current); recognitionTimer.current = null; };
      const awaitRecognition = (renew = false) => {
        if (localSpeaking || !pendingUtterance || recognitionTimer.current && !renew) return;
        clearRecognitionTimer();
        recognitionTimer.current = setTimeout(() => {
          if (!valid()) return;
          // Keep the visible text, but never submit a partial or accept this connection's late final.
          const retained = lastPartial;
          stop(); setPartial(retained); setError("这句话未能及时识别完成，尚未发送。恢复麦克风后可以重说一次。");
        }, 12000);
      };
      const beginSpeech = () => {
        // A short pause can precede a late provider onset. Do not interrupt twice
        // or revoke the same foreground request again while that utterance is pending.
        if (!pendingUtterance) {
          pendingUtterance = true;
          markLatency("speech-start", speakingId ? { utteranceId: speakingId } : undefined);
          callbacks.current.onSpeechStart(); window.dispatchEvent(new Event("orbit-user-speech-start"));
        }
      };
      ws.onmessage = event => {
        if (!valid()) return;
        let value: { type: string; text?: string; utteranceId?: string; message?: string };
        try { value = JSON.parse(event.data); } catch { fail("语音返回格式错误，请重试"); return; }
        if (value.type === "ready") {
          if (processor.current) return;
          if (timer.current) clearTimeout(timer.current); timer.current = null;
          const node = new AudioWorkletNode(audioContext, "orbit-voice-pcm"); processor.current = node;
          node.port.onmessage = pcm => {
            if (!valid() || ws.readyState !== WebSocket.OPEN) return;
            if (pcm.data?.type === "level") {
              levelRef.current = smoothLevel(levelRef.current, visualLevel(pcm.data.rms));
              const now = performance.now(), previous = publishedLevel.current;
              if (now - previous.at >= 100 && (Math.abs(levelRef.current - previous.value) >= .01 || levelRef.current === 0 && previous.value !== 0)) {
                publishedLevel.current = { value: levelRef.current, at: now }; setLevel(levelRef.current);
              }
              return;
            }
            if (pcm.data?.type === "speech_start" || pcm.data?.type === "speech_resume") {
              localSpeaking = true; locallyPaused = false; clearRecognitionTimer(); setNotice(""); beginSpeech(); updatePhase("speaking");
              return;
            }
            if (pcm.data?.type === "speech_pause") {
              localSpeaking = false; locallyPaused = true;
              if (pendingUtterance) {
                updatePhase("recognizing");
                markLatency("speech-pause", speakingId ? { utteranceId: speakingId } : undefined);
                awaitRecognition();
              }
              return;
            }
            if (pcm.data?.type === "speech_end") { localSpeaking = false; locallyPaused = true; if (pendingUtterance) { updatePhase("recognizing"); awaitRecognition(); } return; }
            if (ws.bufferedAmount > 64000) { fail("语音网络较慢，请重新开启"); return; }
            ws.send(pcm.data);
          };
          node.onprocessorerror = () => fail("声音采集已中断，请重新开启");
          audioContext.createMediaStreamSource(stream).connect(node);
          // Worklet output is silent; connecting keeps processing active without microphone monitoring.
          node.connect(audioContext.destination); updatePhase("listening"); return;
        }
        if (value.type === "speech_started") {
          if (value.utteranceId && accepted.has(value.utteranceId)) return;
          speakingId = value.utteranceId ?? speakingId;
          beginSpeech(); setNotice(""); updatePhase(locallyPaused ? "recognizing" : "speaking"); awaitRecognition(); return;
        }
        if (value.type === "partial") {
          if (value.utteranceId && accepted.has(value.utteranceId)) return;
          if (typeof value.text === "string" && value.text.trim()) {
            const changed = lastPartial !== value.text; lastPartial = value.text;
            speakingId = value.utteranceId ?? speakingId; beginSpeech(); setPartial(value.text);
            if (!localSpeaking) updatePhase("recognizing");
            awaitRecognition(changed);
          }
          return;
        }
        if (value.type === "final") {
          if (!value.utteranceId || accepted.has(value.utteranceId)) return;
          accepted.add(value.utteranceId); if (accepted.size > 300) accepted.delete(accepted.values().next().value!);
          markLatency("transcript-final", { utteranceId: value.utteranceId });
          clearRecognitionTimer(); speakingId = ""; pendingUtterance = false; locallyPaused = false; localSpeaking = false; lastPartial = ""; setPartial(""); setNotice(""); updatePhase("listening");
          if (typeof value.text === "string" && value.text.trim() && /[\p{L}\p{N}]/u.test(value.text)) callbacks.current.onTranscript(value.text.trim());
          return;
        }
        if (value.type === "no_speech") {
          if (value.utteranceId && accepted.has(value.utteranceId)) return;
          if (value.utteranceId && speakingId && value.utteranceId !== speakingId) return;
          if (value.utteranceId) accepted.add(value.utteranceId);
          clearRecognitionTimer(); speakingId = ""; pendingUtterance = false; locallyPaused = false; localSpeaking = false; lastPartial = ""; setPartial(""); setNotice("刚才没有听清，可以再说一次"); updatePhase("listening"); return;
        }
        if (value.type === "error") fail(value.message?.slice(0, 180) || "语音暂时不可用，请重新开启");
      };
      ws.onerror = () => fail("语音连接失败，请重新开启");
      ws.onclose = () => fail("语音连接已结束，点击麦克风可继续");
    } catch (cause) {
      if (valid()) fail(cause instanceof DOMException && cause.name === "NotAllowedError" ? "麦克风权限未开启。允许访问后，请重新点击麦克风。" : cause instanceof Error ? cause.message : "无法打开麦克风。");
    }
  }, [stop, updatePhase]);
  useEffect(() => { stop(); setError(""); }, [scope, stop]);
  useEffect(() => {
    alive.current = true;
    const hidden = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", hidden); window.addEventListener("pagehide", stop);
    return () => { alive.current = false; stop(); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", stop); };
  }, [stop]);
  return { phase, partial, error, notice, level, start, stop, clearNotice: () => { setError(""); setNotice(""); } };
}
