import test from "node:test";
import assert from "node:assert/strict";
import { OrbitStore, now } from "../store.ts";
import { OrbitRuntime } from "../runtime.ts";
import { seedEverydayShowcase } from "./everyday.ts";
import { seedInvestmentGoal } from "./investment-goal.ts";
import { filterTimeline, goalTimeline, timelineDay } from "../../client/goal-timeline.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

test("investment replay preserves history, is idempotent and never schedules example actions", () => {
  const store = new OrbitStore(":memory:");
  try {
    seedEverydayShowcase(store);
    const messages = store.list("messages");
    const other = store.require("works", "daily-goal-news");
    assert.equal(seedInvestmentGoal(store), true);
    const work = store.require("works", "daily-goal-holdings");
    assert.equal(work.showcase?.entries.length, 10);
    assert.deepEqual(store.list("messages"), messages);
    assert.deepEqual(store.require("works", other.id), other);
    assert.equal(store.list("triggers").length, 0);
    assert.equal(store.list("runs").length, 0);
    assert.equal(store.pending().length, 0);
    store.updateWork(work.id, { status: "paused", goal: "我已修改的要求" });
    assert.equal(seedInvestmentGoal(store), false);
    assert.equal(store.require("works", work.id).goal, "我已修改的要求");
    assert.equal(store.require("works", work.id).status, "paused");
  } finally { store.close(); }
});

test("investment replay does not overwrite customized goals", () => {
  const store = new OrbitStore(":memory:");
  try {
    seedEverydayShowcase(store);
    const original = store.updateWork("daily-goal-holdings", { goal: "我的真实跟踪要求" });
    seedInvestmentGoal(store);
    assert.deepEqual(store.require("works", original.id), original);
    assert.ok(store.require("works", "investment-goal-demo").showcase);
    assert.equal(store.require("works", "investment-goal-demo").conversationId, "investment-goal-demo");
  } finally { store.close(); }
});

test("timeline shows scoped real runs in order and schedules separately from replay", () => {
  const store = new OrbitStore(":memory:");
  try {
    seedEverydayShowcase(store); seedInvestmentGoal(store);
    const w = store.require("works", "daily-goal-holdings");
    const base = { conversationId: w.conversationId, workId: w.id, parentId: null, title: "核验", summary: "结果", status: "completed" as const };
    const runs = [
      { ...base, id: "second", startedAt: "2026-09-25T04:00:00Z" },
      { ...base, id: "first", startedAt: "2026-09-25T03:00:00Z", status: "failed" as const, error: "资料缺失" },
      { ...base, id: "child", parentId: "first", startedAt: "2026-09-25T03:01:00Z" },
      { ...base, id: "other-goal", workId: "other", startedAt: "2026-09-25T04:00:00Z" },
    ];
    const trigger = { id: "daily", workId: w.id, conversationId: w.conversationId, kind: "interval" as const, intervalMinutes: 1440, enabled: true, nextRunAt: "2026-09-26T00:30:00Z", instructions: "每日自检。核对遗漏", createdAt: now() };
    const result = goalTimeline(w, { runs, triggers: [trigger, { ...trigger, id: "disabled", enabled: false }] });
    assert.deepEqual(result.map(i => i.id), ["first", "second", "daily"]);
    assert.equal(result[0]!.summary, "资料缺失");
    assert.equal(result[2]!.future, true);
    assert.equal(result[2]!.cadence, "每天");
    assert.equal(result[2]!.status, "planned");
    assert.equal(goalTimeline(w, { runs: [], triggers: [] }).length, 0);
  } finally { store.close(); }
});

test("agent can update a goal from the composer without changing scheduling or another conversation", async () => {
  const store = new OrbitStore(":memory:");
  const runtime = new OrbitRuntime(store, [], "/tmp/orbit-goal-update-test");
  try {
    const c = store.createConversation("本对话");
    const work = store.createWork(c.id, "跟踪", "旧要求");
    const other = store.createConversation("其他对话");
    const otherWork = store.createWork(other.id, "另一目标", "不要修改");
    const active = { run: { id: "r", conversationId: c.id, parentId: null, title: "修改要求", status: "running" as const, startedAt: now(), summary: "" }, cancelled: false, pendingSteers: [], children: new Set<never>(), childSlots: 0, text: "" };
    const tool = runtime.hostTools(c.id, active, () => undefined).find(t => t.name === "update_work")!;
    const call = (args: object) => tool.execute("call", args, undefined, undefined, {} as ExtensionContext);
    await call({ workId: work.id, goal: "新的跟踪范围", completionCriteria: "用户要求时停止" });
    assert.equal(store.require("works", work.id).goal, "新的跟踪范围");
    assert.equal(store.require("works", work.id).status, work.status);
    assert.equal(store.list("triggers").length, 0);
    await assert.rejects(call({ workId: otherWork.id, goal: "越权改写" }), /不属于当前对话/);
    await assert.rejects(call({ workId: work.id, title: "  " }), /不能为空/);
    assert.equal(store.require("works", otherWork.id).goal, "不要修改");
  } finally { await runtime.close(); store.close(); }
});


test("timeline date ranges are inclusive in the displayed timezone and omit undated events", () => {
  const base = { title: "检查", summary: "", status: "completed" as const, future: false };
  const items = [
    { ...base, id: "before", at: "2026-09-23T15:59:59Z" },
    { ...base, id: "start", at: "2026-09-23T16:00:00Z" },
    { ...base, id: "end", at: "2026-09-25T15:59:59Z" },
    { ...base, id: "after", at: "2026-09-25T16:00:00Z" },
    { ...base, id: "event", at: undefined },
  ];
  assert.equal(timelineDay(items[1]!.at!), "2026-09-24");
  assert.deepEqual(filterTimeline(items, { from: "2026-09-24", to: "2026-09-25" }).map(i => i.id), ["start", "end"]);
  assert.equal(filterTimeline(items, {}).length, 5);
  assert.deepEqual(filterTimeline(items, { from: "2026-09-26" }).map(i => i.id), ["after"]);
  assert.deepEqual(filterTimeline(items, { to: "2026-09-23" }).map(i => i.id), ["before"]);
  assert.equal(filterTimeline(items, { from: "2026-09-26", to: "2026-09-25" }).length, 0);
});

test("history enrichment preserves customized goals and never creates real executions", () => {
  const store = new OrbitStore(":memory:");
  try {
    seedEverydayShowcase(store); seedInvestmentGoal(store);
    const work = store.require("works", "daily-goal-holdings");
    store.updateWork(work.id, { goal: "用户修改的要求", status: "paused", showcase: { ...work.showcase!, entries: work.showcase!.entries.filter(e => e.at >= "2026-09-25").map(({ steps, finishedAt, ...rest }) => rest) } });
    store.setMetadata("showcase:investment-history:v2", false);
    assert.equal(seedInvestmentGoal(store), true);
    const enriched = store.require("works", work.id);
    assert.equal(enriched.goal, "用户修改的要求");
    assert.equal(enriched.status, "paused");
    assert.equal(enriched.showcase!.entries.length, 10);
    assert.equal(enriched.showcase!.entries.find(e => e.id === "health")!.steps!.length, 4);
    assert.equal(seedInvestmentGoal(store), false);
    assert.equal(store.list("runs").length, 0);
    assert.equal(store.list("triggers").length, 0);
  } finally { store.close(); }
});
