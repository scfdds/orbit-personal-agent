import test from "node:test";
import assert from "node:assert/strict";
import { OrbitStore } from "./store.ts";
import { buildAssistantOverview } from "./assistant-overview.ts";
import type { Conversation, Run } from "../shared/types.ts";

const at = (day: number) => `2026-10-${String(day).padStart(2, "0")}T10:00:00.000Z`;
function conversation(store: OrbitStore, id: string, patch: Partial<Conversation> = {}) {
  return store.createConversation(id, { id, goal: "需要持续讨论的事项", createdAt: at(1), updatedAt: at(1), ...patch });
}
function run(store: OrbitStore, conversationId: string, id: string, status: Run["status"], day: number, patch: Partial<Run> = {}) {
  return store.put("runs", { id, conversationId, parentId: null, title: "一次请求", status, startedAt: at(day),
    ...(status === "running" || status === "queued" ? {} : { finishedAt: at(day) }), summary: `本轮 ${id}`, ...patch });
}
const overview = (store: OrbitStore) => buildAssistantOverview(store.snapshot([], "", false), "main");

test("secretary overview excludes main, archived and empty drafts, but retains saved work without messages", () => {
  const store = new OrbitStore(":memory:");
  try {
    conversation(store, "main");
    conversation(store, "archived", { archived: true });
    store.createConversation("空草稿", { id: "draft" });
    const empty = overview(store);
    assert.deepEqual(empty.items, []);
    assert.equal(empty.briefing?.conversationIds.length, 0);
    assert.match(empty.briefing!.text, /还没有独立事项/);
    const saved = store.createConversation("只有长期目标", { id: "saved" });
    store.createWork(saved.id, "持续跟进", "等后续资料");
    assert.deepEqual(overview(store).items.map(item => item.conversationId), ["saved"]);
  } finally { store.close(); }
});

test("attention and active work stay visible before recent idle and unread conversations", () => {
  const store = new OrbitStore(":memory:");
  try {
    for (let i = 0; i < 10; i++) conversation(store, `recent-${i}`, { updatedAt: at(12) });
    conversation(store, "needs-confirmation", { status: "needs_input", updatedAt: at(2) });
    conversation(store, "active", { status: "running", updatedAt: at(3) });
    run(store, "active", "active-run", "running", 3);
    conversation(store, "unread", { unread: true, updatedAt: at(4) });
    const result = overview(store);
    assert.equal(result.items.length, 8);
    assert.deepEqual(result.items.slice(0, 3).map(item => item.conversationId), ["needs-confirmation", "active", "unread"]);
    assert.equal(result.items[0]!.attentionReason, "等待你补充或确认");
    assert.match(result.briefing!.text, /正等你补充或确认.*正在处理/);
    assert.deepEqual(result.briefing!.conversationIds, ["needs-confirmation", "active"]);
  } finally { store.close(); }
});

test("latest root run determines state regardless of insertion order, old failures or failed subagents", () => {
  const store = new OrbitStore(":memory:");
  try {
    conversation(store, "proposal", { status: "failed", updatedAt: at(9) });
    run(store, "proposal", "new-success", "completed", 8);
    run(store, "proposal", "older-failure", "failed", 2, { finishedAt: at(10) });
    run(store, "proposal", "child-failure", "failed", 11, { parentId: "new-success", subagentId: "researcher" });
    let item = overview(store).items[0]!;
    assert.equal(item.status, "completed");
    assert.equal(item.lastRun?.id, "new-success");
    assert.equal(item.attentionReason, undefined);
    assert.doesNotMatch(overview(store).briefing!.text, /未成功|全部完成|工作已完成/);
    // A later explicit workflow state is meaningful, even after a successful turn.
    store.put("conversations", { ...store.require("conversations", "proposal"), status: "needs_input", updatedAt: at(12) });
    item = overview(store).items[0]!;
    assert.equal(item.status, "needs_input");
    run(store, "proposal", "new-request", "queued", 12);
    assert.equal(overview(store).items[0]!.status, "running");
  } finally { store.close(); }
});

test("failed and interrupted turns surface grounded reasons, cancellation does not request attention", () => {
  const store = new OrbitStore(":memory:");
  try {
    conversation(store, "failed"); run(store, "failed", "failed-run", "failed", 2);
    conversation(store, "interrupted"); run(store, "interrupted", "interrupted-run", "interrupted", 3);
    conversation(store, "stopped"); run(store, "stopped", "cancelled-run", "cancelled", 4);
    const items = overview(store).items;
    assert.equal(items.find(item => item.conversationId === "failed")!.attentionReason, "最近一次执行未成功");
    assert.equal(items.find(item => item.conversationId === "interrupted")!.attentionReason, "上次执行中断，可继续处理");
    assert.equal(items.find(item => item.conversationId === "stopped")!.attentionReason, undefined);
    assert.equal(items.find(item => item.conversationId === "stopped")!.status, "paused");
  } finally { store.close(); }
});

test("example-only and mixed overviews never frame authored examples as the user's real work", () => {
  const store = new OrbitStore(":memory:");
  try {
    const showcase = { title: "体验示例", period: "演示", notice: "不是用户真实经历" };
    conversation(store, "example-failed", { showcase, status: "failed", updatedAt: at(12) });
    conversation(store, "example-travel", { showcase, updatedAt: at(11) });
    const examples = overview(store);
    assert.equal(examples.items.every(item => item.example), true);
    assert.equal(examples.briefing!.text, "这里有 2 个体验示例，可以打开查看对话和资料。");
    conversation(store, "real-work", { updatedAt: at(1) });
    const mixed = overview(store);
    assert.equal(mixed.items[0]!.conversationId, "real-work");
    assert.deepEqual(mixed.briefing!.conversationIds, ["real-work"]);
    assert.doesNotMatch(mixed.briefing!.text, /example|未成功/);
  } finally { store.close(); }
});

test("progress is a bounded current source excerpt; reading overview is deterministic and read-only", () => {
  const store = new OrbitStore(":memory:");
  try {
    conversation(store, "proposal", { summary: "旧背景", updatedAt: at(2) });
    store.put("messages", { id: "old-answer", conversationId: "proposal", role: "assistant", content: "第一版完成。", createdAt: at(2) });
    store.put("memories", { id: "proposal", conversationId: "proposal", version: 1, status: "ready", summary: "下一步：直接发给客户。", updatedAt: at(2), coveredMessageId: "old-answer", items: [] });
    store.put("messages", { id: "latest-answer", conversationId: "proposal", role: "assistant", content: "**还没确认价格，也没有发给客户。**\n\n" + "保留长文细节。".repeat(40), createdAt: at(5) });
    const before = store.snapshot([], "", false);
    const a = overview(store), b = overview(store);
    assert.deepEqual(a, b);
    assert.deepEqual(store.snapshot([], "", false), before);
    assert.match(a.items[0]!.progress!, /^最近回复：还没确认价格，也没有发给客户/);
    assert.doesNotMatch(a.items[0]!.progress!, /直接发给客户|\*\*/);
    assert.ok(a.items[0]!.progress!.length <= 110);
    store.put("messages", { id: "latest-user", conversationId: "proposal", role: "user", content: "先把预算改到两万，还不要发送。", createdAt: at(6) });
    assert.equal(overview(store).items[0]!.progress, "最新要求：先把预算改到两万，还不要发送。");
    store.put("memories", { ...store.require("memories", "proposal"), summary: "背景：客户预算变了。下一步：等用户确认预算；尚未发送。", updatedAt: at(7), coveredMessageId: "new-answer" });
    store.put("messages", { id: "new-answer", conversationId: "proposal", role: "assistant", content: "已记录。", createdAt: at(7) });
    assert.equal(overview(store).items[0]!.progress, "下一步：等用户确认预算；尚未发送。");
  } finally { store.close(); }
});

test("ordinary recent-work briefing attributes actual discussion and user requests instead of generic resumption copy", () => {
  const store = new OrbitStore(":memory:");
  try {
    conversation(store, "产品评审", { updatedAt: at(9) });
    store.put("messages", { id: "review-answer", conversationId: "产品评审", role: "assistant", content: "访谈依据已整理，首页交互还需要确认；演示脚本尚未开始。", createdAt: at(9) });
    conversation(store, "客户方案", { updatedAt: at(8) });
    store.put("messages", { id: "client-request", conversationId: "客户方案", role: "user", content: "先调整预算，不要发送给客户。", createdAt: at(8) });
    const result = overview(store);
    assert.match(result.briefing!.text, /「产品评审」最近回复：访谈依据已整理，首页交互还需要确认；演示脚本尚未开始/);
    assert.match(result.briefing!.text, /「客户方案」最新要求：先调整预算，不要发送给客户/);
    assert.doesNotMatch(result.briefing!.text, /保留了最近的讨论|全部完成|已经发送/);
    assert.deepEqual(result.briefing!.conversationIds, ["产品评审", "客户方案"]);
    store.put("conversations", { ...store.require("conversations", "产品评审"), unread: true });
    assert.match(overview(store).briefing!.text, /有未读进展，最近回复：访谈依据已整理/);
  } finally { store.close(); }
});
