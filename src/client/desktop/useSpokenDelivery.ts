import { useCallback, useEffect, useRef, useState } from "react";
import type { AssistantDelivery } from "../../shared/delivery.ts";
import type { VoiceController } from "./useVoice.ts";
import { deliveryTab } from "./delivery-state.ts";
import { markLatency } from "./latency.ts";

/** Presentation commits before speech. A new request, interruption or hidden window never replays history. */
export function useSpokenDelivery(delivery: AssistantDelivery | null, voice: VoiceController, blocked: boolean) {
  const [readyId, setReadyId] = useState<string | null>(null);
  const [focusMatched, setFocusMatched] = useState(false);
  const handled = useRef(new Set<string>());
  const visualMarks = useRef(new Set<string>());
  const current = useRef(delivery); current.current = delivery;
  const stop = useCallback(() => {
    if (current.current) handled.current.add(current.current.id);
    voice.stopPlayback();
  }, [voice.stopPlayback]);
  const onReady = useCallback((id: string, matched: boolean) => {
    if (current.current?.id !== id) return;
    if (!visualMarks.current.has(id)) {
      visualMarks.current.add(id);
      if (visualMarks.current.size > 50) visualMarks.current.delete(visualMarks.current.values().next().value!);
      markLatency("visual-ready", { runId: current.current.runId, ...(current.current.requestId ? { requestId: current.current.requestId } : {}) });
    }
    setReadyId(id); setFocusMatched(matched);
  }, []);

  useEffect(() => {
    voice.stopPlayback(); setReadyId(null); setFocusMatched(false);
    // Speech-only answers have no asynchronous visual resource; the caption is their visual delivery.
    if (delivery && !deliveryTab(delivery)) {
      const frame = requestAnimationFrame(() => setReadyId(delivery.id));
      return () => cancelAnimationFrame(frame);
    }
  }, [delivery?.id, voice.stopPlayback]);
  useEffect(() => {
    const interrupt = () => stop();
    const hidden = () => { if (document.hidden) stop(); };
    window.addEventListener("orbit-user-speech-start", interrupt);
    window.addEventListener("orbit-delivery-interrupt", interrupt);
    document.addEventListener("visibilitychange", hidden);
    return () => { window.removeEventListener("orbit-user-speech-start", interrupt); window.removeEventListener("orbit-delivery-interrupt", interrupt); document.removeEventListener("visibilitychange", hidden); };
  }, [stop]);
  useEffect(() => {
    if (blocked) { stop(); return; }
    if (!voice.preferencesReady) return;
    if (!delivery || delivery.kind === "preview" || readyId !== delivery.id || handled.current.has(delivery.id)) return;
    handled.current.add(delivery.id);
    if (handled.current.size > 200) handled.current.delete(handled.current.values().next().value!);
    if (voice.autoSpeak && !document.hidden) void voice.speak(delivery.spokenText, delivery.id);
  }, [delivery, readyId, blocked, voice.preferencesReady, voice.autoSpeak, voice.speak, stop]);
  const replay = () => {
    if (delivery && delivery.kind !== "preview" && readyId === delivery.id && !blocked) void voice.speak(delivery.spokenText, delivery.id);
  };
  return { ready: !!delivery && readyId === delivery.id, focusMatched, onReady, stop, replay };
}
