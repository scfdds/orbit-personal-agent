import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
  AppContext,
  AppDefinition,
  SaveObjectInput,
} from "../shared/plugin.ts";
import type {
  AppObject,
  FeedbackData,
  OpportunityData,
} from "../shared/types.ts";
import feedback from "./feedback/index.ts";
import opportunities from "./opportunities/index.ts";
import { loadApps } from "./registry.ts";

function fixture(readOnly = false) {
  const objects = new Map<string, AppObject>();
  let sequence = 0;
  const context: AppContext = {
    conversationId: "test-work",
    readOnly,
    getObjects: (appId) =>
      structuredClone(
        [...objects.values()].filter(
          (object) => !appId || object.appId === appId,
        ),
      ),
    getObject: (id) => structuredClone(objects.get(id)),
    saveObject(input: SaveObjectInput) {
      if (context.readOnly) throw new Error("read only");
      const current = input.id ? objects.get(input.id) : undefined;
      if (current && current.version !== input.expectedVersion)
        throw new Error("version conflict");
      const app = [feedback, opportunities].find(
        (candidate) => candidate.manifest.id === input.appId,
      );
      app?.validateObject?.(input.data, input.type, context);
      const object: AppObject = {
        id: input.id ?? `object-${++sequence}`,
        conversationId: context.conversationId,
        appId: input.appId,
        type: input.type,
        title: input.title,
        data: structuredClone(input.data),
        version: (current?.version ?? 0) + 1,
        updatedAt: new Date().toISOString(),
      };
      objects.set(object.id, object);
      return structuredClone(object);
    },
    openPanel() {},
    recordActivity() {},
  };
  // Provisioning is performed by the host before a read-only child is created.
  context.readOnly = false;
  for (const app of [feedback, opportunities])
    for (const seed of app.seed()) context.saveObject(seed);
  context.readOnly = readOnly;
  return context;
}

async function invoke(
  app: AppDefinition,
  context: AppContext,
  name: string,
  args: Record<string, unknown>,
) {
  const tool = app.createTools(context).find((tool) => tool.name === name);
  assert(tool, `missing tool ${name}`);
  return tool.execute(
    "test-call",
    args,
    undefined,
    undefined,
    {} as ExtensionContext,
  );
}

test("apps are discovered from the same contract, and all seeded evidence exists", async () => {
  const apps = await loadApps();
  assert.deepEqual(
    apps.map((app) => app.manifest.id),
    ["career", "contracts", "feedback", "litigation", "memory", "opportunities", "portfolio"],
  );
  const context = fixture();
  for (const app of apps)
    assert.deepEqual(
      app.createTools(context).map((tool) => tool.name),
      app.manifest.tools.map((tool) => tool.name),
    );
  const items = (
    context.getObjects("feedback")[0]!.data as unknown as FeedbackData
  ).items;
  assert.equal(items.length, 14);
  const ids = new Set(items.map((item) => item.id));
  for (const opportunity of (
    context.getObjects("opportunities")[0]!.data as unknown as OpportunityData
  ).items) {
    assert(opportunity.feedbackIds.every((id) => ids.has(id)));
  }
});

test("search honors exclusion and user group; optimistic writes cannot overwrite newer GUI edits", async () => {
  const context = fixture();
  const inbox = context.getObjects("feedback")[0]!;
  await invoke(feedback, context, "feedback_update", {
    objectId: inbox.id,
    expectedVersion: 1,
    feedbackId: "F001",
    excluded: true,
  });
  await assert.rejects(
    invoke(feedback, context, "feedback_update", {
      objectId: inbox.id,
      expectedVersion: 1,
      feedbackId: "F001",
      excluded: false,
    }),
    /版本冲突/,
  );
  const found = await invoke(feedback, context, "feedback_search", {
    segment: "new",
  });
  const data = found.details as { items: { id: string; segment: string }[] };
  assert(
    data.items.every((item) => item.segment === "new" && item.id !== "F001"),
  );
  const included = await invoke(feedback, context, "feedback_search", {
    query: "F001",
    includeExcluded: true,
  });
  assert.equal((included.details as { total: number }).total, 1);
});

test("analysis upserts preserve saved GUI decisions and require valid non-excluded evidence", async () => {
  const context = fixture();
  const original = context.getObjects("opportunities")[0]!;
  const data = original.data as unknown as OpportunityData;
  data.focus = "这版先减少通知干扰";
  data.items[0]!.priority = "P2";
  data.items[0]!.status = "watching";
  const gui = context.saveObject({
    ...original,
    data: data as unknown as Record<string, unknown>,
    expectedVersion: original.version,
  });
  const args = {
    objectId: gui.id,
    expectedVersion: gui.version,
    items: [
      {
        id: "O001",
        title: "改进入口",
        description: "新的分析结论",
        category: "功能发现",
        feedbackIds: ["F001", "F004"],
        priority: "P0",
        status: "planned",
      },
    ],
  };
  await assert.rejects(
    invoke(opportunities, context, "opportunities_upsert", {
      ...args,
      expectedVersion: 1,
    }),
    /版本冲突/,
  );
  await invoke(opportunities, context, "opportunities_upsert", args);
  const saved = context.getObject(gui.id)!;
  const latest = saved.data as unknown as OpportunityData;
  assert.equal(latest.focus, data.focus);
  assert.equal(latest.items[0]!.priority, "P2");
  assert.equal(latest.items[0]!.status, "watching");
  assert.equal(latest.items[0]!.description, "新的分析结论");
  assert.equal(latest.items.length, 4);
  await assert.rejects(
    invoke(opportunities, context, "opportunities_upsert", {
      ...args,
      expectedVersion: saved.version,
      items: [{ ...args.items[0], feedbackIds: ["F999"] }],
    }),
    /不存在/,
  );
  const inbox = context.getObjects("feedback")[0]!;
  await invoke(feedback, context, "feedback_update", {
    objectId: inbox.id,
    expectedVersion: inbox.version,
    feedbackId: "F001",
    excluded: true,
  });
  await assert.rejects(
    invoke(opportunities, context, "opportunities_upsert", {
      ...args,
      expectedVersion: saved.version,
    }),
    /已被用户排除/,
  );
});

test("explicit decisions and merging preserve target state and unify evidence", async () => {
  const context = fixture();
  const original = context.getObjects("opportunities")[0]!;
  await invoke(opportunities, context, "opportunities_update", {
    objectId: original.id,
    expectedVersion: 1,
    opportunityId: "O001",
    priority: "P0",
    status: "planned",
    focus: "先改善已有功能",
    userRequest: "优先解决入口发现问题",
  });
  await invoke(opportunities, context, "opportunities_merge", {
    objectId: original.id,
    expectedVersion: 2,
    targetId: "O001",
    sourceIds: ["O003"],
    title: "完善新用户的功能发现路径",
    userRequest: "把首次使用和功能发现合并",
  });
  const saved = context.getObject(original.id)!;
  const data = saved.data as unknown as OpportunityData;
  assert.equal(saved.version, 3);
  assert.equal(data.items.length, 3);
  assert.equal(data.focus, "先改善已有功能");
  const merged = data.items.find((item) => item.id === "O001")!;
  assert.equal(merged.priority, "P0");
  assert.equal(merged.status, "planned");
  assert(merged.feedbackIds.includes("F002"));
  assert.equal(new Set(merged.feedbackIds).size, merged.feedbackIds.length);
});

test("read-only child contexts receive no mutation tools and reject demo mutations", () => {
  const context = fixture(true);
  assert.deepEqual(
    feedback.createTools(context).map((tool) => tool.name),
    ["feedback_search", "feedback_read"],
  );
  assert.deepEqual(
    opportunities.createTools(context).map((tool) => tool.name),
    ["opportunities_read"],
  );
  assert.throws(() => feedback.onDemoEvent!(context), /只读/);
});

test("demo event appends uniquely numbered source evidence to the existing object", () => {
  const context = fixture();
  const first = feedback.onDemoEvent!(context);
  const second = feedback.onDemoEvent!(context);
  assert.equal(first.eventName, "feedback.added");
  assert.match(first.detail, /F015/);
  assert.match(first.detail, /上次做到哪一步/);
  assert.match(second.detail, /F016/);
  const saved = context.getObjects("feedback")[0]!;
  const data = saved.data as unknown as FeedbackData;
  assert.equal(saved.version, 3);
  assert.equal(data.items.length, 16);
  assert.equal(data.items.at(-1)!.source, "示例事件");
});

test("GUI data validation rejects malformed arrays, enum values, dates, duplicate IDs and fabricated evidence", () => {
  const context = fixture();
  const inbox = context.getObjects("feedback")[0]!;
  const board = context.getObjects("opportunities")[0]!;
  assert.throws(
    () => feedback.validateObject!({ items: {} }, inbox.type, context),
    /格式/,
  );
  assert.throws(
    () =>
      opportunities.validateObject!(
        { focus: "体验", items: null },
        board.type,
        context,
      ),
    /格式/,
  );
  const invalidSegment = structuredClone(inbox.data) as unknown as FeedbackData;
  (invalidSegment.items[0] as unknown as Record<string, unknown>).segment =
    "unknown";
  assert.throws(
    () =>
      feedback.validateObject!(
        invalidSegment as unknown as Record<string, unknown>,
        inbox.type,
        context,
      ),
    /格式/,
  );
  const invalidExcluded = structuredClone(
    inbox.data,
  ) as unknown as FeedbackData;
  (invalidExcluded.items[0] as unknown as Record<string, unknown>).excluded =
    "false";
  assert.throws(
    () =>
      feedback.validateObject!(
        invalidExcluded as unknown as Record<string, unknown>,
        inbox.type,
        context,
      ),
    /格式/,
  );
  const invalidDate = structuredClone(inbox.data) as unknown as FeedbackData;
  invalidDate.items[0]!.createdAt = "tomorrow";
  assert.throws(
    () =>
      feedback.validateObject!(
        invalidDate as unknown as Record<string, unknown>,
        inbox.type,
        context,
      ),
    /时间无效/,
  );
  const duplicate = structuredClone(inbox.data) as unknown as FeedbackData;
  duplicate.items.push(duplicate.items[0]!);
  assert.throws(
    () =>
      feedback.validateObject!(
        duplicate as unknown as Record<string, unknown>,
        inbox.type,
        context,
      ),
    /编号重复/,
  );
  for (const [field, value] of [
    ["priority", "P9"],
    ["status", "done"],
    ["feedbackIds", ["F999"]],
  ] as const) {
    const invalid = structuredClone(board.data) as unknown as OpportunityData;
    (invalid.items[0] as unknown as Record<string, unknown>)[field] = value;
    assert.throws(
      () =>
        opportunities.validateObject!(
          invalid as unknown as Record<string, unknown>,
          board.type,
          context,
        ),
      /格式|不存在/,
    );
  }
  assert.throws(
    () => feedback.validateObject!(inbox.data, "other-type", context),
    /对象类型/,
  );
  assert.throws(
    () => opportunities.validateObject!(board.data, "other-type", context),
    /对象类型/,
  );
});

test("valid GUI exclusions and decisions are accepted without invalidating existing evidence links", () => {
  const context = fixture();
  const inbox = context.getObjects("feedback")[0]!;
  const feedbackData = inbox.data as unknown as FeedbackData;
  feedbackData.items[0]!.excluded = true;
  feedbackData.items[0]!.topic = "已识别的入口问题";
  context.saveObject({
    ...inbox,
    expectedVersion: inbox.version,
    data: feedbackData as unknown as Record<string, unknown>,
  });
  const board = context.getObjects("opportunities")[0]!;
  const boardData = board.data as unknown as OpportunityData;
  boardData.focus = "先改善已有功能";
  boardData.items[0]!.priority = "P0";
  boardData.items[0]!.status = "planned";
  const updated = context.saveObject({
    ...board,
    expectedVersion: board.version,
    data: boardData as unknown as Record<string, unknown>,
  });
  assert.equal(updated.version, 2);
  assert.equal(
    (updated.data as unknown as OpportunityData).items[0]!.priority,
    "P0",
  );
  assert(
    (updated.data as unknown as OpportunityData).items[0]!.feedbackIds.includes(
      "F001",
    ),
  );
});

test("previously obtained write tools still enforce read-only guards at execution time", async () => {
  const context = fixture();
  const tool = opportunities
    .createTools(context)
    .find((tool) => tool.name === "opportunities_update")!;
  const board = context.getObjects("opportunities")[0]!;
  context.readOnly = true;
  await assert.rejects(
    tool.execute(
      "test-call",
      {
        objectId: board.id,
        expectedVersion: board.version,
        focus: "不应写入",
        userRequest: "test",
      },
      undefined,
      undefined,
      {} as ExtensionContext,
    ),
    /只读/,
  );
  assert.equal(context.getObject(board.id)!.version, board.version);
});
