import { workspaceRequestHeaders } from "../workspace-mode.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Message, Run } from "../../shared/types.ts";
import { spokenText, VoiceEpoch } from "./voice-audio.ts";
import { useVoiceInput } from "./useVoiceInput.ts";
import { PlaybackLevelMeter } from "./voice-levels.ts";
import { PCMStreamPlayer } from "./voice-pcm-player.ts";
import { markLatency } from "./latency.ts";

interface VoiceConfig { streamingTts?: boolean; tts: boolean; asr: boolean; provider: string; voice: string }
interface Options { scope: string; messages: Message[]; run?: Run; onTranscript(text: string): void; quick: boolean }
type PlaybackPhase = "idle" | "loading" | "speaking";
const autoKey = "orbit.voice.delivery.v1";

export function useVoice({ scope, onTranscript, quick }: Options) {
  const [config, setConfig] = useState<VoiceConfig | null>(null);
  const [playback, setPlayback] = useState<PlaybackPhase>("idle");
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [spokenContent, setSpokenContent] = useState("");
  const [callActive, setCallActive] = useState(false), [micMuted, setMicMuted] = useState(false);
  const [outputLevel, setOutputLevel] = useState(0);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [playbackSource, setPlaybackSource] = useState("");
  const [preferencesReady, setPreferencesReady] = useState(() => !window.orbitDesktop?.readPreferences);
  const [autoSpeak, setAutoSpeak] = useState(() => { if (window.orbitDesktop?.readPreferences) return false; try { return localStorage.getItem(autoKey) !== "false"; } catch { return true; } });
  const alive = useRef(true), configRef = useRef(config), preferenceEpoch = useRef(0);
  const spokenPreference = useRef<boolean | null>(null);
  const speechEpoch = useRef(new VoiceEpoch()), synthesisRequest = useRef<AbortController | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null), audioURL = useRef<string | null>(null);
  const outputMeter = useRef<PlaybackLevelMeter | null>(null);
  const streamPlayer = useRef<PCMStreamPlayer | null>(null);
  const call = useRef({ active: false, muted: false });
  const interruptOnInputStart = useRef(true);
  const channel = useRef<BroadcastChannel | null>(null), instance = useRef(crypto.randomUUID());
  configRef.current = config;
  const stopPlayback = useCallback(() => {
    speechEpoch.current.next(); synthesisRequest.current?.abort(); synthesisRequest.current = null;
    if (audio.current) { audio.current.onended = null; audio.current.onerror = null; audio.current.pause(); audio.current.removeAttribute("src"); audio.current = null; }
    outputMeter.current?.dispose(); outputMeter.current = null;
    streamPlayer.current?.dispose(); streamPlayer.current = null;
    if (audioURL.current) URL.revokeObjectURL(audioURL.current); audioURL.current = null;
    window.speechSynthesis?.cancel();
    if (alive.current) { setPlayback("idle"); setSpeakingId(null); setSpokenContent(""); setOutputLevel(0); }
  }, []);

  const claim = useCallback(() => { channel.current?.postMessage({ type: "interrupt", sender: instance.current }); }, []);
  const input = useVoiceInput({ scope, onTranscript, onSpeechStart: stopPlayback, onStart: () => { if (interruptOnInputStart.current) stopPlayback(); claim(); setError(""); setNotice(""); } });
  const startCall = useCallback(async () => {
    if (document.hidden || !alive.current) return;
    interruptOnInputStart.current = !call.current.active;
    call.current = { active: true, muted: false }; setCallActive(true); setMicMuted(false);
    await input.start();
  }, [input.start]);
  const endCall = useCallback(() => {
    call.current = { active: false, muted: false };
    stopPlayback(); input.stop();
    if (alive.current) { setCallActive(false); setMicMuted(false); }
  }, [stopPlayback, input.stop]);
  const toggleMicrophone = useCallback(async () => {
    if (!call.current.active || call.current.muted) { await startCall(); return; }
    // Pausing releases the physical capture and provider connection. Spoken output can continue.
    call.current.muted = true; setMicMuted(true); input.stop();
  }, [input.stop, startCall]);
  const interrupt = endCall;
  useEffect(() => {
    // Keep the call surface available after a connection or permission failure; resume is explicit.
    if (call.current.active && input.phase === "idle" && input.error) { call.current.muted = true; setMicMuted(true); }
  }, [input.phase, input.error]);
  const refreshConfig = useCallback(async () => {
    try {
      const response = await fetch("/api/voice/config", { headers: workspaceRequestHeaders() }); if (!response.ok) throw new Error();
      const next = await response.json() as VoiceConfig;
      if (alive.current) { configRef.current = next; setConfig(next); } return next;
    } catch { return null; }
  }, []);
  const speak = useCallback(async (content: string, id: string, brief = false) => {
    const text = spokenText(content, brief);
    if (!text) return;
    stopPlayback(); claim(); setError(""); setNotice("");
    const token = speechEpoch.current.next();
    const valid = () => alive.current && speechEpoch.current.current(token);
    setSpeakingId(id); setSpokenContent(text); setPlayback("loading");
    const systemSpeech = (fallback = false) => {
      if (!valid()) return;
      if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") {
        stopPlayback(); setError("当前环境没有可用的朗读声音。"); return;
      }
      setPlaybackSource("系统声音");
      if (fallback) setNotice("语音服务暂不可用，已改用系统声音。");
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "zh-CN"; utterance.rate = 1;
      const voice = window.speechSynthesis.getVoices().find(item => /^zh[-_]CN/i.test(item.lang)) || window.speechSynthesis.getVoices().find(item => /^zh/i.test(item.lang));
      if (voice) utterance.voice = voice;
      utterance.onstart = () => { if (valid()) { setPlayback("speaking"); markLatency("audio-start"); } };
      utterance.onend = () => { if (valid()) stopPlayback(); };
      utterance.onerror = event => { if (valid()) { stopPlayback(); if (!["interrupted", "canceled"].includes(event.error)) setError("系统朗读未能启动，请点击朗读重试。"); } };
      window.speechSynthesis.speak(utterance);
    };
    const available = configRef.current;
    if (!available?.tts) { systemSpeech(); return; }
    const controller = new AbortController(); synthesisRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), 65000);
    let streamedAudioStarted = false;
    try {
      markLatency("tts-request");
      if (available.streamingTts && text.length <= 120 && typeof AudioContext !== "undefined") {
        const player = new PCMStreamPlayer({
          onStart: () => { if (valid()) { streamedAudioStarted = true; setPlayback("speaking"); markLatency("audio-start"); } },
          onLevel: value => { if (valid()) setOutputLevel(value); },
        });
        streamPlayer.current = player;
        const response = await fetch("/api/voice/synthesize-stream", { method: "POST", headers: { ...workspaceRequestHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: controller.signal });
        if (!response.ok || !response.body || response.headers.get("content-type") !== "audio/pcm" || response.headers.get("x-audio-sample-rate") !== "24000" || response.headers.get("x-audio-channels") !== "1" || response.headers.get("x-audio-format") !== "pcm_s16le") throw new Error("语音流格式无效");
        markLatency("audio-first-byte");
        await player.ready;
        if (!valid()) { player.dispose(); return; }
        setPlaybackSource(available.provider?.startsWith("doubao") ? "豆包声音" : "语音服务");
        const reader = response.body.getReader(); let received = 0, streamEnded = false;
        try {
          while (valid()) {
            const { value, done } = await reader.read();
            if (done) { streamEnded = true; break; }
            if (!valid()) break;
            received += value.length;
            if (received > 24000 * 2 * 60) throw new Error("语音流超出上限");
            player.append(value);
          }
        } finally { if (!valid() || !streamEnded) { controller.abort(); await reader.cancel().catch(() => {}); } reader.releaseLock(); }
        if (!valid()) { player.dispose(); return; }
        if (!received) throw new Error("没有音频");
        player.end();
        // Provider/network timeouts stop at EOF, not while the buffered voice is finishing.
        clearTimeout(timeout);
        await player.finished;
        if (valid()) stopPlayback();
        return;
      }
      const response = await fetch("/api/voice/synthesize", { method: "POST", headers: { ...workspaceRequestHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: controller.signal });
      if (!response.ok || !response.headers.get("content-type")?.startsWith("audio/")) throw new Error("合成失败");
      const blob = await response.blob();
      if (!valid()) return;
      if (!blob.size) throw new Error("没有音频");
      audioURL.current = URL.createObjectURL(blob);
      const player = new Audio(audioURL.current); audio.current = player;
      const meter = new PlaybackLevelMeter(player, value => { if (valid()) setOutputLevel(value); });
      outputMeter.current = meter;
      await meter.ready;
      if (!valid()) { meter.dispose(); return; }
      setPlaybackSource(available.provider?.startsWith("doubao") ? "豆包声音" : "语音服务");
      player.onended = () => { if (valid()) stopPlayback(); };
      player.onerror = () => { if (valid()) { stopPlayback(); setError("音频播放失败，请点击朗读重试。"); } };
      await player.play();
      if (valid()) { setPlayback("speaking"); markLatency("audio-start"); meter.start(); } else player.pause();
    } catch {
      if (valid()) {
        controller.abort();
        streamedAudioStarted ||= Boolean(streamPlayer.current?.started);
        streamPlayer.current?.dispose(); streamPlayer.current = null;
        if (streamedAudioStarted) { stopPlayback(); setError("讲解连接中断，内容已保留，可手动重听。"); return; }
        if (audio.current) { audio.current.onended = null; audio.current.onerror = null; audio.current.pause(); audio.current = null; }
        outputMeter.current?.dispose(); outputMeter.current = null; setOutputLevel(0);
        if (audioURL.current) URL.revokeObjectURL(audioURL.current); audioURL.current = null;
        systemSpeech(true);
      }
    }
    finally { clearTimeout(timeout); if (synthesisRequest.current === controller) synthesisRequest.current = null; }
  }, [claim, stopPlayback]);


  const toggleAuto = useCallback(() => {
    const next = !autoSpeak; spokenPreference.current = next; preferenceEpoch.current++; setPreferencesReady(true); setAutoSpeak(next); stopPlayback();
    if (window.orbitDesktop?.writePreferences) {
      void window.orbitDesktop.writePreferences({ spokenDelivery: next }).catch(() => { if (alive.current) setNotice("本次设置已生效，暂时无法保存到本机。"); });
    } else { try { localStorage.setItem(autoKey, String(next)); } catch {} }
  }, [autoSpeak, stopPlayback]);

  useEffect(() => {
    alive.current = true; void refreshConfig();
    const preferences = window.orbitDesktop;
    const prefToken = preferenceEpoch.current;
    if (preferences?.readPreferences) void preferences.readPreferences().then(value => {
      if (alive.current && preferenceEpoch.current === prefToken) { spokenPreference.current = value.spokenDelivery; setAutoSpeak(value.spokenDelivery); setPreferencesReady(true); }
    }).catch(() => { if (alive.current && preferenceEpoch.current === prefToken) { setAutoSpeak(false); setPreferencesReady(true); setNotice("暂时无法读取语音偏好，本次先保持静音。"); } });
    const unsubscribe = preferences?.onPreferencesChanged?.(value => {
      const changed = spokenPreference.current !== value.spokenDelivery;
      spokenPreference.current = value.spokenDelivery;
      preferenceEpoch.current++; setPreferencesReady(true); setAutoSpeak(value.spokenDelivery);
      // Navigation preferences share the native store. Saving a recent matter
      // must not interrupt a manually requested narration while auto-speak is off.
      if (changed && !value.spokenDelivery) stopPlayback();
    });
    if (typeof BroadcastChannel !== "undefined") {
      const bus = new BroadcastChannel("orbit-voice"); channel.current = bus;
      bus.onmessage = event => { if (event.data?.type === "interrupt" && event.data.sender !== instance.current) interrupt(); };
    }
    const hidden = () => { if (document.hidden) interrupt(); };
    const storage = (event: StorageEvent) => { if (event.key === autoKey && !window.orbitDesktop) { setAutoSpeak(event.newValue !== "false"); stopPlayback(); } };
    const refresh = () => { void refreshConfig(); };
    const preview = (event: Event) => {
      const text = (event as CustomEvent<{ text?: unknown }>).detail?.text;
      if (typeof text !== "string" || !text.trim()) return;
      interrupt(); const token = speechEpoch.current.next();
      void refreshConfig().then(() => { if (alive.current && speechEpoch.current.current(token)) void speak(text, "voice-preview", false); });
    };
    document.addEventListener("visibilitychange", hidden); window.addEventListener("storage", storage); window.addEventListener("pagehide", interrupt); window.addEventListener("orbit-voice-config-changed", refresh); window.addEventListener("focus", refresh); window.addEventListener("orbit-voice-preview", preview); window.addEventListener("orbit-voice-stop", interrupt);
    return () => { alive.current = false; interrupt(); unsubscribe?.(); channel.current?.close(); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("storage", storage); window.removeEventListener("pagehide", interrupt); window.removeEventListener("orbit-voice-config-changed", refresh); window.removeEventListener("focus", refresh); window.removeEventListener("orbit-voice-preview", preview); window.removeEventListener("orbit-voice-stop", interrupt); };
  }, [refreshConfig, interrupt, stopPlayback, speak]);
  useEffect(() => { interrupt(); setNotice(""); setError(""); }, [scope, interrupt]);
  // Work answers are never auto-read here. The host delivers separately authored spokenText after visual ACK.
  const recording = input.phase === "idle" ? "idle" : input.phase === "requesting" ? "requesting" : "recording";
  return { config, recording, inputPhase: input.phase, partial: input.partial, playback, speakingId, seconds: 0,
    callActive, micMuted, inputLevel: callActive && !micMuted ? input.level : 0, outputLevel, spokenContent, startCall, endCall, toggleMicrophone,
    inputError: input.error, error: input.error || error, notice: input.notice || notice, playbackSource, autoSpeak, preferencesReady, quick,
    startRecording: startCall, stopRecording: endCall, cancelRecording: endCall, stopPlayback, interrupt, speak, toggleAuto,
    interruptAll: () => { interrupt(); claim(); }, clearNotice: () => { setError(""); setNotice(""); input.clearNotice(); },
  };
}
export type VoiceController = ReturnType<typeof useVoice>;
