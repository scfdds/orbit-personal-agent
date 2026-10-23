import test from "node:test";
import assert from "node:assert/strict";
import { buildHomeTimeline, selectHomeTimeline } from "./home-timeline.ts";
import type { Conversation, Message, Run, Snapshot } from "../../shared/types.ts";

const mainId = "orbit-assistant";
const at = "2026-10-12T08:00:00.000Z";
const conversation = (id: string, title = id): Conversation => ({
  id, title, project: id === mainId ? "" : "学习与研究", pinned: false, archived: false,
  goal: "", status: "idle", summary: "", continuous: false, unread: false,
  createdAt: at, updatedAt: at, panel: null,
});
const message = (id: string, conversationId: string, role: Message["role"], content: string, runId?: string): Message =>
  ({ id, conversationId, role, content, createdAt: at, ...(runId ? { runId } : {}) });
const run = (id: string, conversationId: string, status: Run["status"] = "completed"): Run =>
  ({ id, conversationId, status, parentId: null, title: "处理请求", startedAt: at, summary: "" });
const link = (id: string, target: string, runId?: string, content = "已创建事项，转交处理"): Message =>
  ({ ...message(id, mainId, "system", content, runId), kind: "conversation_link", linkedConversationId: target });
const origin = (id: string, target: string, runId: string, sourceMessageId: string, action: "new" | "resume" = "new"): Message =>
  ({ ...message(id, target, "user", "学习 3D", runId), handoff: { sourceConversationId: mainId, sourceMessageId, action } });
const snapshot = (messages: Message[], runs: Run[] = []): Pick<Snapshot, "messages" | "runs" | "conversations"> =>
  ({ messages, runs, conversations: [conversation(mainId), conversation("3d", "理解 3D 表示"), conversation("trip", "周末旅行")] });
const ids = (messages: Message[]) => messages.map(message => message.id);

test("main-origin matter replies retain canonical identity and appear at their original question", () => {
  const q1 = message("q1", mainId, "user", "学习 3D");
  const answer = message("a1", "3d", "assistant", "完整解释各种 3D 表示", "r1");
  const state = snapshot([q1, origin("origin1", "3d", "r1", q1.id), link("l1", "3d", "r1"), answer], [run("r1", "3d")]);
  const before = structuredClone(state);
  const timeline = buildHomeTimeline({ snapshot: state, mainId });
  assert.deepEqual(ids(timeline.messages), ["q1", "a1"]);
  assert.equal(timeline.messages[1], answer);
  assert.equal(timeline.messages[1]?.conversationId, "3d");
  assert.deepEqual(timeline.assignments.a1, { conversationId: "3d", title: "理解 3D 表示", project: "学习与研究", runId: "r1", action: "new" });
  assert.equal(timeline.run?.id, "r1");
  assert.equal(timeline.runGroupId, q1.id);
  assert.deepEqual(state, before);
});

test("resume exchanges each project only their own run and direct matter followups never leak into main", () => {
  const state = snapshot([
    message("q1", mainId, "user", "学习 3D"), origin("origin1", "3d", "r1", "q1"), link("l1", "3d", "r1"),
    message("a1", "3d", "assistant", "3D 总览", "r1"),
    message("local-q", "3d", "user", "本地右侧问题", "local"), message("local-a", "3d", "assistant", "右侧回答", "local"),
    message("q2", mainId, "user", "SDF 是啥"), origin("origin2", "3d", "r2", "q2", "resume"), link("l2", "3d", "r2"),
    message("a2", "3d", "assistant", "SDF 解释", "r2"),
    message("q3", mainId, "user", "谢谢", "r3"), message("a3", mainId, "assistant", "不客气", "r3"),
  ], [run("r1", "3d"), run("local", "3d"), run("r2", "3d"), run("r3", mainId)]);
  const timeline = buildHomeTimeline({ snapshot: state, mainId, preferredRunId: "local" });
  assert.deepEqual(ids(timeline.messages), ["q1", "a1", "q2", "a2", "q3", "a3"]);
  assert.equal(timeline.assignments.a2?.action, "resume");
  assert.equal(timeline.assignments["local-a"], undefined);
  assert.equal(timeline.run?.id, "r3");
});

test("read/open references stay links and do not replay the entire related conversation", () => {
  const readLink = link("read-link", "3d", "read", "理解 3D 表示");
  const orphanLink = link("orphan-link", "trip", undefined, "周末旅行");
  const state = snapshot([
    message("history-a", "3d", "assistant", "旧解释", "old"),
    message("read-q", mainId, "user", "之前讨论了什么", "read"), readLink,
    message("read-a", mainId, "assistant", "上次对比了几种表示", "read"), orphanLink,
  ], [run("old", "3d"), run("read", mainId)]);
  const timeline = buildHomeTimeline({ snapshot: state, mainId });
  assert.deepEqual(ids(timeline.messages), ["read-q", "read-link", "read-a", "orphan-link"]);
  assert.equal(timeline.messages[1], readLink);
  assert.equal(timeline.messages[3], orphanLink);
  assert.deepEqual(timeline.assignments, {});
});

test("provenance restores streaming before the main link arrives and after a restart", () => {
  const state = snapshot([message("q", mainId, "user", "学习 3D"), origin("origin", "3d", "r", "q")], [run("r", "3d", "running")]);
  const timeline = buildHomeTimeline({ snapshot: state, mainId, streams: { "3d": { runId: "r", text: "先理解表面" } } });
  assert.deepEqual(ids(timeline.messages), ["q"]);
  assert.equal(timeline.stream, "先理解表面");
  assert.equal(timeline.streamGroupId, "q");
  assert.equal(timeline.streamAssignment?.conversationId, "3d");
  assert.equal(timeline.run?.status, "running");
  assert.equal(buildHomeTimeline({ snapshot: state, mainId }).run?.id, "r");
});

test("a completed canonical answer wins over a still-live stream while delivery is finishing", () => {
  const answer = message("answer", "3d", "assistant", "完整答案", "r");
  const state = snapshot([message("q", mainId, "user", "学习 3D"), origin("origin", "3d", "r", "q"), answer], [run("r", "3d", "running")]);
  const timeline = buildHomeTimeline({ snapshot: state, mainId, streams: { "3d": { runId: "r", text: "准备查询工具\n完整答案" } } });
  assert.equal(timeline.stream, undefined);
  assert.deepEqual(ids(timeline.messages), ["q", "answer"]);
  assert.equal(timeline.messages[1], answer);
});

test("stale or sidepane streams cannot masquerade as the main request", () => {
  const state = snapshot([message("q", mainId, "user", "学习 3D"), origin("origin", "3d", "r", "q")], [run("r", "3d", "running"), run("side", "trip", "running")]);
  const timeline = buildHomeTimeline({ snapshot: state, mainId, preferredRunId: "side", streams: {
    "3d": { runId: "previous", text: "旧流" }, trip: { runId: "side", text: "右侧流" },
  } });
  assert.equal(timeline.run?.id, "r");
  assert.equal(timeline.stream, undefined);
});

test("failed and interrupted matter requests keep their status and partial canonical answer without fabricating a result", () => {
  for (const status of ["queued", "failed", "interrupted", "cancelled"] as const) {
    const task = { ...run("r", "3d", status), error: status === "failed" ? "模型暂时不可用" : undefined };
    const state = snapshot([message("q", mainId, "user", "学习 3D"), origin("origin", "3d", "r", "q"), link("l", "3d", "r")], [task]);
    const timeline = buildHomeTimeline({ snapshot: state, mainId });
    assert.deepEqual(ids(timeline.messages), ["q"]);
    assert.equal(timeline.run, task);
    assert.equal(timeline.stream, undefined);
  }
  const partial = message("partial", "3d", "assistant", "已经完成的部分", "r");
  const timeline = buildHomeTimeline({ snapshot: snapshot([
    message("q", mainId, "user", "学习 3D"), origin("origin", "3d", "r", "q"), partial,
  ], [run("r", "3d", "failed")]), mainId });
  assert.equal(timeline.messages[1], partial);
});

test("legacy main links project only the linked run, even without newer handoff metadata", () => {
  const state = snapshot([
    message("q", mainId, "user", "学习 3D"), link("legacy-link", "3d", "legacy"),
    message("legacy-user", "3d", "user", "学习 3D", "legacy"), message("a", "3d", "assistant", "解释", "legacy"),
    message("other", "3d", "assistant", "另一个任务", "other"),
  ], [run("legacy", "3d"), run("other", "3d")]);
  const timeline = buildHomeTimeline({ snapshot: state, mainId });
  assert.deepEqual(ids(timeline.messages), ["q", "a"]);
  assert.equal(timeline.assignments.a?.runId, "legacy");
});

test("duplicate links do not duplicate answers and delayed links retain the correct original exchange", () => {
  const state = snapshot([
    message("q1", mainId, "user", "学习 3D"), origin("origin1", "3d", "r1", "q1"),
    message("q2", mainId, "user", "另一个简单问题", "r2"), message("a2", mainId, "assistant", "简单答案", "r2"),
    link("delayed-link", "3d", "r1"), link("duplicate-link", "3d", "r1"), message("a1", "3d", "assistant", "学习答案", "r1"),
  ], [run("r1", "3d"), run("r2", mainId)]);
  const timeline = buildHomeTimeline({ snapshot: state, mainId });
  assert.deepEqual(ids(timeline.messages), ["q1", "a1", "q2", "a2"]);
  assert.deepEqual(timeline.groups.map(group => group.id), ["q1", "q2"]);
});

test("whole-exchange cropping keeps active work plus the latest exchanges without dropping the original question", () => {
  const state = snapshot([
    message("q0", mainId, "user", "早先完成的问题", "r0"), message("a0", mainId, "assistant", "早先答案", "r0"),
    message("q1", mainId, "user", "学习 3D"), origin("origin1", "3d", "r1", "q1"), link("link1", "3d", "r1"),
    message("q2", mainId, "user", "简单问题", "r2"), message("a2", mainId, "assistant", "答案", "r2"),
    message("q3", mainId, "user", "再问一个", "r3"), message("a3", mainId, "assistant", "最新答案", "r3"),
  ], [run("r0", mainId), run("r1", "3d", "running"), run("r2", mainId), run("r3", mainId)]);
  const full = buildHomeTimeline({ snapshot: state, mainId, preferredRunId: "r3", streams: { "3d": { runId: "r1", text: "正在解释" } } });
  const recent = selectHomeTimeline(full, { maxGroups: 1 });
  assert.deepEqual(ids(recent.messages), ["q1", "q3", "a3"]);
  assert.equal(recent.run?.id, "r1");
  assert.equal(recent.stream, "正在解释");
  assert.equal(selectHomeTimeline(full), full);
  assert.equal(full.groups.length, 4);
});

test("a mismatched or missing main source does not expose a different conversation's answers", () => {
  const invalid = origin("invalid", "3d", "r", "missing");
  const state = snapshot([message("q", mainId, "user", "你好"), invalid, message("answer", "3d", "assistant", "不能出现", "r")], [run("r", "3d")]);
  assert.deepEqual(ids(buildHomeTimeline({ snapshot: state, mainId }).messages), ["q"]);
  invalid.handoff!.sourceMessageId = "q";
  state.runs[0] = run("r", "trip");
  assert.deepEqual(ids(buildHomeTimeline({ snapshot: state, mainId }).messages), ["q"]);
});

test("empty timelines are stable and parent/subagent runs are never substituted for the user's answer", () => {
  assert.deepEqual(buildHomeTimeline({ snapshot: snapshot([]), mainId }), { groups: [], messages: [], assignments: {} });
  const state = snapshot([
    message("q", mainId, "user", "学习 3D"), link("child-link", "3d", "child"), message("child-answer", "3d", "assistant", "子任务结果", "child"),
  ], [{ ...run("child", "3d"), parentId: "parent" }]);
  assert.deepEqual(ids(buildHomeTimeline({ snapshot: state, mainId }).messages), ["q", "child-link"]);
});
