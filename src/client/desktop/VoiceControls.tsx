import { AudioLines, LoaderCircle, Mic, Volume2, VolumeX, X } from "lucide-react";
import type { VoiceController } from "./useVoice.ts";

export function VoiceControls({ voice }: { voice: VoiceController }) {
  const active = voice.callActive, pending = voice.recording === "requesting";
  return <div className="dt-voice-controls">
    <button type="button" className={`dt-voice-button ${voice.autoSpeak ? "dt-voice-enabled" : ""}`} aria-label={voice.autoSpeak ? "静音语音讲解" : "开启语音讲解"} aria-pressed={voice.autoSpeak} title="语音讲解" onClick={voice.toggleAuto}>{voice.autoSpeak ? <Volume2 size={15}/> : <VolumeX size={15}/>}</button>
    <button type="button" className="dt-voice-entry" aria-label={active ? "结束实时语音" : "开启实时语音"} aria-pressed={active} title="开始语音通话" onClick={() => active ? voice.endCall() : void voice.startCall()}>{pending ? <LoaderCircle size={16} className="dt-spin"/> : <Mic size={16}/>}<span>通话</span></button>
  </div>;
}
export function VoiceStatus({ voice }: { voice: VoiceController }) {
  const inputStatus = voice.inputPhase === "requesting" ? "正在连接麦克风…" : voice.partial || (voice.inputPhase === "speaking" ? "正在听你说…" : voice.inputPhase === "listening" ? "可以直接说话，停顿后自动发送" : "");
  const outputStatus = voice.playback === "loading" ? "正在准备声音…" : voice.playback === "speaking" ? `正在讲解 · ${voice.playbackSource}` : "";
  const text = voice.error || voice.notice || voice.partial || (voice.inputPhase === "speaking" ? inputStatus : outputStatus || inputStatus);
  if (!text) return null;
  return <div className={`dt-voice-status ${voice.error ? "dt-voice-error" : ""}`} role={voice.error ? "alert" : "status"} aria-live="polite">
    {voice.recording === "recording" ? <span className="dt-voice-dot"/> : <AudioLines size={13}/>}
    <span>{text}</span>
    {voice.playback !== "idle" && <button type="button" onClick={voice.stopPlayback}>停止讲解</button>}
    {voice.recording !== "idle" ? <button type="button" onClick={voice.cancelRecording}>结束语音</button>
      : voice.inputError ? <><button type="button" onClick={() => void voice.startRecording()}>重试</button><button type="button" aria-label="关闭语音提示" onClick={voice.clearNotice}><X size={12}/></button></>
        : voice.playback === "idle" && <button type="button" aria-label="关闭语音提示" onClick={voice.clearNotice}><X size={12}/></button>}
  </div>;
}
