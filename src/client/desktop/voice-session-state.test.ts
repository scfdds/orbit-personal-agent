import test from "node:test";
import assert from "node:assert/strict";
import { voiceSessionState, type VoiceSessionFacts } from "./voice-session-state.ts";

const facts = (patch: Partial<VoiceSessionFacts> = {}): VoiceSessionFacts => ({
  inputPhase: "listening", playback: "idle", micMuted: false, inputError: "",
  partial: "", spokenContent: "", busy: false, routing: false, openingContent: false,
  lastUserText: "请帮我回顾旅行计划。", deliveredText: "预算已确认，日期还没定。", ...patch,
});

test("user speech interrupts the displayed explanation and uses live partial captions", () => {
  const state = voiceSessionState(facts({ inputPhase: "speaking", playback: "speaking", inputError: "迟到的连接错误", openingContent: true, busy: true, partial: "等等，日期改成", spokenContent: "上一段仍在结束" }));
  assert.equal(state.phase, "hearing");
  assert.equal(state.speaker, "你");
  assert.equal(state.caption, "等等，日期改成");
  assert.doesNotMatch(state.title, /准备|处理|Orbit 在说/);
});

test("actual playback takes priority over connection errors and background work even with the microphone paused", () => {
  const state = voiceSessionState(facts({ inputPhase: "requesting", playback: "speaking", micMuted: true, inputError: "麦克风连接断开", openingContent: true, busy: true, spokenContent: "现在继续为你讲解已经保存的方案。" }));
  assert.equal(state.phase, "speaking");
  assert.equal(state.speaker, "Orbit");
  assert.match(state.hint, /麦克风已暂停.*仍可听取讲解/);
  assert.equal(state.caption, "现在继续为你讲解已经保存的方案。");
});

test("manual history playback captions reflect the actual spoken content, not the latest delivery", () => {
  const state = voiceSessionState(facts({ playback: "speaking", spokenContent: "这是上周合同条款的历史答复。", deliveredText: "这是今天旅行计划的最新重点。" }));
  assert.equal(state.caption, "这是上周合同条款的历史答复。");
  assert.match(state.hint, /可以打断/);
  // If the player has no caption, do not substitute an unrelated recent delivery.
  assert.equal(voiceSessionState(facts({ playback: "speaking", spokenContent: "" })).caption, "");
});

test("a failed input connection takes priority over preparing or working without claiming to listen", () => {
  const state = voiceSessionState(facts({ inputPhase: "requesting", playback: "loading", inputError: "麦克风权限被拒绝", openingContent: true, busy: true, micMuted: true, partial: "过期转写" }));
  assert.equal(state.phase, "error");
  assert.equal(state.caption, "麦克风权限被拒绝");
  assert.equal(state.speaker, "连接提示");
  assert.match(state.hint, /重新连接.*继续打字/);
});

test("pending permission or connection stays connecting ahead of work and mute states", () => {
  const state = voiceSessionState(facts({ inputPhase: "requesting", playback: "loading", openingContent: true, busy: true, routing: true, micMuted: true }));
  assert.equal(state.phase, "connecting");
  assert.match(state.hint, /麦克风访问/);
  assert.equal(state.caption, "");
  assert.equal(state.speaker, "");
});

test("visual preparation never claims the content is already open and audio preparation never claims it is speaking", () => {
  const opening = voiceSessionState(facts({ openingContent: true, playback: "loading", busy: true, micMuted: true }));
  assert.equal(opening.phase, "preparing");
  assert.equal(opening.title, "正在打开内容");
  assert.match(opening.hint, /就绪后/);
  assert.doesNotMatch(opening.title + opening.hint, /已打开|已呈现|已保存/);
  assert.equal(opening.caption, "请帮我回顾旅行计划。");
  const audio = voiceSessionState(facts({ playback: "loading", busy: true, spokenContent: "尚未实际发声的文本" }));
  assert.equal(audio.phase, "preparing");
  assert.equal(audio.title, "正在准备讲解");
  assert.equal(audio.caption, "");
});

test("routing and active work stay distinct, and pausing capture does not imply stopping the task", () => {
  const routing = voiceSessionState(facts({ busy: true, routing: true, micMuted: true }));
  assert.equal(routing.phase, "working");
  assert.equal(routing.title, "正在理解你的需求");
  assert.match(routing.hint, /麦克风已暂停.*任务继续/);
  assert.equal(routing.speaker, "你的需求");
  assert.equal(routing.caption, "请帮我回顾旅行计划。");
  const working = voiceSessionState(facts({ busy: true, routing: false }));
  assert.equal(working.title, "正在处理");
  assert.doesNotMatch(working.title + working.hint, /已找到|已打开|已完成/);
});

test("idle muted and listening states preserve the last delivered point without inventing new speech", () => {
  const muted = voiceSessionState(facts({ micMuted: true }));
  assert.equal(muted.phase, "muted");
  assert.equal(muted.caption, "预算已确认，日期还没定。");
  assert.equal(muted.speaker, "刚才的重点");
  assert.match(muted.hint, /键盘/);
  const listening = voiceSessionState(facts());
  assert.equal(listening.phase, "listening");
  assert.equal(listening.caption, muted.caption);
  const empty = voiceSessionState(facts({ deliveredText: "", spokenContent: "已经结束的旧声音", partial: "已经结束的旧转写" }));
  assert.equal(empty.caption, "");
  assert.equal(empty.speaker, "");
});
test("a local pause keeps the pending transcript visible without claiming the agent has received it", () => {
  const state = voiceSessionState(facts({ inputPhase: "recognizing", partial: "打开上次那个方案", deliveredText: "之前的旧讲解", busy: true, routing: true }));
  assert.equal(state.phase, "working");
  assert.equal(state.title, "正在确认这句话");
  assert.equal(state.caption, "打开上次那个方案");
  assert.equal(state.speaker, "你");
  assert.match(state.hint, /继续补充/);
  assert.doesNotMatch(state.title + state.hint, /已收到|正在处理|完成/);
  assert.equal(voiceSessionState(facts({ inputPhase: "recognizing", partial: "" })).caption, "");
});
