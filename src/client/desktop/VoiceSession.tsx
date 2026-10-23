import { Keyboard, Mic, MicOff, PhoneOff, RotateCcw, Square, Volume2, VolumeX } from "lucide-react";
import type { AssistantDelivery } from "../../shared/delivery.ts";
import type { VoiceController } from "./useVoice.ts";
import VoicePresence from "./VoicePresence.tsx";
import { voiceSessionState } from "./voice-session-state.ts";
import { plainSummary } from "./workspace-state.ts";

interface Props {
  voice: VoiceController; busy: boolean; routing: boolean; delivery: AssistantDelivery | null;
  ready: boolean; lastUserText: string; resourceTitle?: string; keyboardOpen: boolean;
  textReply?: string; deliveryError?: string;
  onKeyboard(): void; onStopTask(): void; compact?: boolean;
}
export default function VoiceSession({ voice, busy, routing, delivery, ready, lastUserText, resourceTitle, keyboardOpen, onKeyboard, onStopTask, compact, textReply, deliveryError }: Props) {
  const presence = voiceSessionState({ inputPhase: voice.inputPhase, playback: voice.playback, micMuted: voice.micMuted,
    inputError: voice.inputError, partial: voice.partial, spokenContent: voice.spokenContent,
    busy, routing, openingContent: !!delivery?.target && !ready, lastUserText, deliveredText: delivery?.spokenText || "" });
  const textOnly = !busy && (!delivery || delivery.kind === "preview") && !!textReply;
  if (presence.phase === "error" && voice.partial) {
    presence.caption = voice.partial;
    presence.speaker = "尚未发送";
    presence.hint = voice.inputError;
  }
  if (textOnly && ["listening", "muted"].includes(presence.phase)) {
    presence.caption = plainSummary(textReply, 180);
    presence.speaker = "文字答复";
    presence.hint = "完整答复已保留在讨论记录中";
  }
  const level = presence.phase === "hearing" || presence.phase === "listening" ? voice.inputLevel : presence.phase === "speaking" ? voice.outputLevel : 0;
  const playbackNotice = (voice.error && voice.error !== voice.inputError ? voice.error : voice.notice) || (textOnly ? deliveryError : undefined);
  return <section className={`dt-voice-session ${compact ? "dt-voice-session-compact" : ""}`} aria-label="语音通话" data-voice-state={presence.phase}>
    <div className="dt-voice-session-top"><span><i className={voice.micMuted ? "is-paused" : ""}/>与 Orbit 通话中</span><button className="dt-icon" type="button" aria-label={voice.autoSpeak ? "静音语音讲解" : "开启语音讲解"} aria-pressed={voice.autoSpeak} onClick={voice.toggleAuto} title={voice.autoSpeak ? "静音讲解，保留字幕" : "开启语音讲解"}>{voice.autoSpeak ? <Volume2 size={16}/> : <VolumeX size={16}/>}</button></div>
    {resourceTitle && <div className="dt-call-context" title={resourceTitle}><span>一起看</span><strong>{resourceTitle}</strong></div>}
    <div className="dt-voice-session-center"><VoicePresence phase={presence.phase} level={level}/><div className="dt-call-state" role="status" aria-live="polite"><h2>{presence.title}</h2><p>{presence.hint}</p></div></div>
    <div className={`dt-call-caption ${presence.phase === "hearing" ? "dt-call-caption-user" : ""}`} aria-live="off">
      {presence.caption ? <><span>{presence.speaker}</span><p>{presence.caption}</p></> : <p className="dt-call-caption-empty">{voice.autoSpeak ? "说话时，字幕会显示在这里。" : "讲解已静音，文字与内容仍会呈现。"}</p>}
    </div>
    {playbackNotice && <p className="dt-call-notice" role="status">{playbackNotice}</p>}
    <div className="dt-call-controls">
      <div><button type="button" className={`dt-call-control ${voice.micMuted ? "is-active" : ""}`} aria-label={voice.micMuted ? "恢复麦克风" : "暂停麦克风"} aria-pressed={voice.micMuted} onClick={() => void voice.toggleMicrophone()}>{voice.inputError ? <RotateCcw size={20}/> : voice.micMuted ? <MicOff size={20}/> : <Mic size={20}/>}</button><span>{voice.inputError ? "重新连接" : voice.micMuted ? "已暂停" : "麦克风"}</span></div>
      <div><button type="button" className="dt-call-control dt-call-end" aria-label="结束语音通话" onClick={voice.endCall}><PhoneOff size={21}/></button><span>结束</span></div>
      <div><button type="button" className={`dt-call-control ${keyboardOpen ? "is-active" : ""}`} aria-label={keyboardOpen ? "收起键盘输入" : "打字补充"} aria-pressed={keyboardOpen} onClick={onKeyboard}><Keyboard size={21}/></button><span>键盘</span></div>
    </div>
    <div className="dt-call-footnote">{busy ? <button type="button" onClick={onStopTask}><Square size={10}/>停止当前任务</button> : <span>{voice.micMuted ? "暂停期间不采集声音" : "收起窗口后，麦克风会关闭"}</span>}</div>
  </section>;
}
