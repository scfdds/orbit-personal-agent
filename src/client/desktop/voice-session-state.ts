export type VoicePresence = "connecting" | "listening" | "hearing" | "working" | "preparing" | "speaking" | "muted" | "error";

export interface VoiceSessionFacts {
  inputPhase: string; playback: string; micMuted: boolean; inputError: string;
  partial: string; spokenContent: string; busy: boolean; routing: boolean;
  openingContent: boolean; lastUserText: string; deliveredText: string;
}

/** A single, truthful state for the call surface. Levels never substitute for connection state. */
export function voiceSessionState(facts: VoiceSessionFacts): { phase: VoicePresence; title: string; hint: string; caption: string; speaker: string } {
  if (facts.inputPhase === "speaking") return { phase: "hearing", title: "在听你说", hint: "说完后，Orbit 会接着处理", caption: facts.partial, speaker: "你" };
  if (facts.playback === "speaking") return { phase: "speaking", title: "Orbit 在说", hint: facts.micMuted ? "麦克风已暂停，仍可听取讲解" : "随时开口，可以打断", caption: facts.spokenContent, speaker: "Orbit" };
  if (facts.inputError) return { phase: "error", title: "语音连接已暂停", hint: "可以重新连接，也可以继续打字", caption: facts.inputError, speaker: "连接提示" };
  if (facts.inputPhase === "requesting") return { phase: "connecting", title: "正在连接", hint: "首次使用需要允许麦克风访问", caption: "", speaker: "" };
  if (facts.inputPhase === "recognizing") return { phase: "working", title: "正在确认这句话", hint: "可以继续补充", caption: facts.partial, speaker: facts.partial ? "你" : "" };
  if (facts.openingContent) return { phase: "preparing", title: "正在打开内容", hint: "内容就绪后，讲解会接上", caption: facts.lastUserText, speaker: "你的需求" };
  if (facts.playback === "loading") return { phase: "preparing", title: "正在准备讲解", hint: facts.micMuted ? "麦克风已暂停" : "也可以继续补充你的想法", caption: "", speaker: "" };
  if (facts.busy) return { phase: "working", title: facts.routing ? "正在理解你的需求" : "正在处理", hint: facts.micMuted ? "麦克风已暂停，任务继续进行" : "可以继续说，也可以先看资料", caption: facts.lastUserText, speaker: "你的需求" };
  if (facts.micMuted) return { phase: "muted", title: "麦克风已暂停", hint: "恢复后继续说，或用键盘补充", caption: facts.deliveredText, speaker: facts.deliveredText ? "刚才的重点" : "" };
  return { phase: "listening", title: "可以直接说话", hint: "聊个新想法，或接着之前的事", caption: facts.deliveredText, speaker: facts.deliveredText ? "刚才的重点" : "" };
}
