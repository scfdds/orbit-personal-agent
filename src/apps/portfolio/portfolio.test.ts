import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AppContext } from "../../shared/plugin.ts";
import { OrbitStore } from "../../server/store.ts";
import { OrbitRuntime } from "../../server/runtime.ts";
import app, { validatePortfolio } from "./index.ts";
import { asRecord, emptyPortfolio, portfolioMarkdown, samplePortfolio, summarizePositions, type PortfolioData } from "./data.ts";

test("portfolio computes actual held exposure by currency and excludes unknown-price cost from P&L", () => {
  const data = samplePortfolio();
  const cny = summarizePositions(data.positions)[0]!;
  assert.equal(cny.count, 3);
  assert.equal(cny.cost, 45560);
  assert.equal(cny.value, 47200);
  assert.equal(cny.profit, 1640);
  data.positions.push({ ...data.positions[0]!, id: "P005", symbol: "USDTEST", currency: "USD", quantity: 10, averageCost: 20, lastPrice: 25 });
  data.positions.push({ ...data.positions[0]!, id: "P006", symbol: "UNKNOWN", quantity: 100, averageCost: 10, lastPrice: null, quoteDate: "", quoteSource: "" });
  const grouped = summarizePositions(data.positions);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0]!.cost, 46560);
  assert.equal(grouped[0]!.profit, 1640);
  assert.equal(grouped[0]!.quotedCount, 3);
  assert.equal(grouped[0]!.count, 4);
  assert.equal(grouped[1]!.profit, 50);
  assert.equal(grouped[1]!.returnPercent, 25);
});

test("portfolio validates all financial inputs, ownership references, source dates and exact fields", () => {
  validatePortfolio(asRecord(emptyPortfolio()), "portfolio-book");
  validatePortfolio(asRecord(samplePortfolio()), "portfolio-book");
  for (const mutate of [
    (d: PortfolioData) => { d.positions[0]!.quantity = -1; },
    (d: PortfolioData) => { d.positions[0]!.lastPrice = Number.NaN; },
    (d: PortfolioData) => { d.positions[0]!.quoteDate = "2026-02-31"; },
    (d: PortfolioData) => { d.positions[0]!.quoteSource = " "; },
    (d: PortfolioData) => { d.positions[0]!.kind = "watching"; },
    (d: PortfolioData) => { d.positions.push({ ...d.positions[0]!, id: "P009" }); },
    (d: PortfolioData) => { d.observations[0]!.positionId = "foreign-id"; },
    (d: PortfolioData) => { d.observations.push({ ...d.observations[0]! }); },
    (d: PortfolioData) => { d.observations[0]!.dueDate = "2026-13-11"; },
    (d: PortfolioData) => { d.title = " "; },
  ]) {
    const data = samplePortfolio(); mutate(data);
    assert.throws(() => validatePortfolio(asRecord(data), "portfolio-book"));
  }
  assert.throws(() => validatePortfolio({ ...asRecord(emptyPortfolio()), arbitrary: true }, "portfolio-book"));
  assert.throws(() => validatePortfolio(asRecord(emptyPortfolio()), "other-app"));
});

const invoke = (context: AppContext, name: string, args: Record<string, unknown>) => {
  const tool = app.createTools(context).find((t) => t.name === name);
  assert(tool);
  return tool.execute("portfolio-test", args, undefined, undefined, {} as ExtensionContext);
};

test("portfolio GUI and tools share persisted versions; patch writes preserve user decisions and reject stale versions", async () => {
  const store = new OrbitStore(":memory:");
  const runtime = new OrbitRuntime(store, [app], "/tmp/orbit-portfolio-test");
  runtime.seed();
  const context = runtime.appContext("work-notes");
  try {
    let object = context.getObjects("portfolio")[0]!;
    object = context.saveObject({ ...object, expectedVersion: object.version, data: asRecord(samplePortfolio()) });
    const oldVersion = object.version;
    await invoke(context, "portfolio_upsert_position", { objectId: object.id, expectedVersion: oldVersion, userRequest: "用户补充观察备注", positionId: "P001", patch: { note: "保留数量和成本，仅补充观察口径" } });
    await assert.rejects(invoke(context, "portfolio_upsert_position", { objectId: object.id, expectedVersion: oldVersion, userRequest: "重复修改", positionId: "P001", patch: { quantity: 900 } }), /版本冲突/);
    object = context.getObject(object.id)!;
    let data = object.data as unknown as PortfolioData;
    assert.equal(data.positions[0]!.quantity, 500);
    assert.equal(data.positions[0]!.averageCost, 42.8);
    assert.equal(data.positions[0]!.note, "保留数量和成本，仅补充观察口径");
    await invoke(context, "portfolio_upsert_observation", { objectId: object.id, expectedVersion: object.version, userRequest: "为已核对事项补充依据", observationId: "T003", patch: { evidence: "这是用户补充的原始记录" } });
    object = context.getObject(object.id)!;
    data = object.data as unknown as PortfolioData;
    assert.equal(data.observations[2]!.status, "done");
    assert.equal(data.observations[2]!.evidence, "这是用户补充的原始记录");
    assert.throws(() => context.saveObject({ ...object, expectedVersion: object.version, data: { ...object.data, positions: [{ ...data.positions[0], quantity: -20 }] } }));
    const read = await invoke(context, "portfolio_read", { objectId: object.id });
    assert.match(read.content[0]!.type === "text" ? read.content[0].text : "", /用户补充的原始记录/);
  } finally { await runtime.close(); store.close(); }
});

test("portfolio enforces read-only tools and conversation ownership on reads and writes", async () => {
  const store = new OrbitStore(":memory:");
  const runtime = new OrbitRuntime(store, [app], "/tmp/orbit-portfolio-readonly-test");
  runtime.seed();
  const context = runtime.appContext("work-notes");
  try {
    const object = context.getObjects("portfolio")[0]!;
    assert.deepEqual(app.createTools(runtime.appContext("work-notes", true)).map((t) => t.name), ["portfolio_read"]);
    const cached = app.createTools(context).find((t) => t.name === "portfolio_upsert_position")!;
    context.readOnly = true;
    await assert.rejects(cached.execute("cached", { objectId: object.id, expectedVersion: object.version, userRequest: "添加资产", patch: { name: "测试资产", symbol: "TEST", kind: "watching", currency: "CNY" } }, undefined, undefined, {} as ExtensionContext), /只读/);
    context.readOnly = false;
    const outside = runtime.appContext("work-feedback");
    await assert.rejects(invoke(outside, "portfolio_read", { objectId: object.id }), /不属于当前对话/);
    await assert.rejects(invoke(outside, "portfolio_upsert_observation", { objectId: object.id, expectedVersion: object.version, userRequest: "添加", patch: { title: "越界" } }), /不属于当前对话/);
    await assert.rejects(invoke(context, "portfolio_upsert_position", { objectId: object.id, expectedVersion: object.version, userRequest: " ", patch: { name: "测试资产" } }), /用户要求/);
    await assert.rejects(invoke(context, "portfolio_upsert_position", { objectId: object.id, expectedVersion: object.version, userRequest: "添加", patch: { name: "测试资产", symbol: "TEST", kind: "holding", currency: "CNY" } }), /数量和成本/);
    await assert.rejects(invoke(context, "portfolio_upsert_position", { objectId: object.id, expectedVersion: object.version, userRequest: "添加", patch: { name: "测试资产", symbol: "TEST", currency: "CNY", kind: "watching", lastPrice: 22 } }), /日期和来源/);
  } finally { await runtime.close(); store.close(); }
});

test("removing an asset retains the observation history and exports its actual saved state", async () => {
  const store = new OrbitStore(":memory:");
  const runtime = new OrbitRuntime(store, [app], "/tmp/orbit-portfolio-remove-test");
  runtime.seed();
  const context = runtime.appContext("work-notes");
  try {
    let object = context.getObjects("portfolio")[0]!;
    object = context.saveObject({ ...object, expectedVersion: object.version, data: asRecord(samplePortfolio()) });
    await invoke(context, "portfolio_remove", { objectId: object.id, expectedVersion: object.version, userRequest: "用户移除星河科技", kind: "position", id: "P001" });
    object = context.getObject(object.id)!;
    const data = object.data as unknown as PortfolioData;
    assert.equal(data.positions.length, 3);
    assert.equal(data.observations.length, 3);
    assert.equal(data.observations[0]!.positionId, "");
    const exported = await app.exportFile!(context, "md");
    assert.match(String(exported.content), /虚构示例/);
    assert.match(String(exported.content), /核对新产品收入/);
    assert.doesNotMatch(String(exported.content), /星河科技/);
    assert.match(exported.contentType, /text\/markdown/);
    await assert.rejects(app.exportFile!(context, "pdf"), /Markdown/);
    const escaped = portfolioMarkdown({ ...data, positions: [{ ...data.positions[0]!, note: "含有|表格\n换行" }] });
    assert.match(escaped, /含有\\\|表格<br>换行/);
  } finally { await runtime.close(); store.close(); }
});
