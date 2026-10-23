import { Type } from "typebox";
import { Value } from "typebox/value";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { AppContext, AppDefinition } from "../../shared/plugin.ts";
import type {
  AppObject,
  FeedbackData,
  Opportunity,
  OpportunityData,
} from "../../shared/types.ts";

const Priority = Type.Union([
  Type.Literal("P0"),
  Type.Literal("P1"),
  Type.Literal("P2"),
]);
const Status = Type.Union([
  Type.Literal("proposed"),
  Type.Literal("planned"),
  Type.Literal("watching"),
]);
const OpportunitySchema = Type.Object(
  {
    focus: Type.String({ minLength: 1 }),
    items: Type.Array(
      Type.Object(
        {
          id: Type.String({ pattern: "^O[0-9]{3,}$" }),
          title: Type.String({ minLength: 1 }),
          description: Type.String({ minLength: 1 }),
          priority: Priority,
          status: Status,
          category: Type.String({ minLength: 1 }),
          feedbackIds: Type.Array(Type.String({ pattern: "^F[0-9]{3,}$" }), {
            uniqueItems: true,
          }),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export function validateOpportunityObject(
  data: Record<string, unknown>,
  type: string,
  context: AppContext,
) {
  if (type !== "opportunity-board") throw new Error("机会看板不支持此对象类型");
  if (!Value.Check(OpportunitySchema, data))
    throw new Error(
      "机会数据格式不正确：需要合法的机会数组、优先级、状态和证据编号",
    );
  if (!data.focus.trim()) throw new Error("改进方向不能为空");
  const ids = new Set<string>();
  // Existing evidence remains addressable after GUI exclusion. New analysis writes
  // separately reject excluded evidence, while simple priority edits remain valid.
  const evidenceIds = new Set(
    context
      .getObjects("feedback")
      .filter(
        (object) =>
          object.conversationId === context.conversationId &&
          object.type === "feedback-inbox",
      )
      .flatMap((object) =>
        ((object.data as unknown as FeedbackData).items ?? []).map(
          (item) => item.id,
        ),
      ),
  );
  for (const item of data.items) {
    if (ids.has(item.id)) throw new Error(`机会编号重复：${item.id}`);
    ids.add(item.id);
    if (
      ![item.title, item.description, item.category].every((value) =>
        value.trim(),
      )
    )
      throw new Error("机会的标题、描述和分类不能为空");
    for (const id of item.feedbackIds)
      if (!evidenceIds.has(id))
        throw new Error(`反馈证据 ${id} 不存在于当前工作`);
  }
}

export function initialOpportunities(): OpportunityData {
  return {
    focus: "先理解问题，再决定下个版本的改进重点",
    items: [
      {
        id: "O001",
        title: "让已有能力更容易被发现",
        description:
          "模板、文件搜索和纪要转待办的入口不明显。先核对发现路径，避免把入口问题直接当成新增功能需求。",
        priority: "P1",
        status: "proposed",
        feedbackIds: ["F001", "F004", "F006", "F011", "F014"],
        category: "功能发现",
      },
      {
        id: "O002",
        title: "减少重复通知，突出需要行动的消息",
        description:
          "多渠道重复和高频更新挤占注意力，可探索通知分级、渠道设置和摘要。",
        priority: "P1",
        status: "proposed",
        feedbackIds: ["F003", "F005", "F008", "F012"],
        category: "通知体验",
      },
      {
        id: "O003",
        title: "缩短首次使用的路径",
        description:
          "新用户在首页选择和邀请同事时遇到阻碍，需要更明确的首次任务入口。",
        priority: "P2",
        status: "watching",
        feedbackIds: ["F002", "F009"],
        category: "首次使用",
      },
      {
        id: "O004",
        title: "收集进阶能力需求",
        description:
          "甘特图、保存筛选和离线编辑属于不同需求，当前各一条证据，继续验证适用人群与频次。",
        priority: "P2",
        status: "watching",
        feedbackIds: ["F007", "F010", "F013"],
        category: "新能力",
      },
    ],
  };
}

function board(context: AppContext, id?: string): AppObject | undefined {
  const object = id
    ? context.getObject(id)
    : context.getObjects("opportunities")[0];
  if (!object) return undefined;
  if (
    object.conversationId !== context.conversationId ||
    object.appId !== "opportunities" ||
    object.type !== "opportunity-board"
  )
    throw new Error("机会看板不属于当前工作");
  return object;
}
function boardData(object: AppObject): OpportunityData {
  return object.data as unknown as OpportunityData;
}
function result(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    details: data,
  };
}
function writable(
  context: AppContext,
  object: AppObject | undefined,
  expectedVersion: number,
) {
  if (context.readOnly)
    throw new Error("子任务为只读，请将建议交给主 Agent 保存");
  if ((object?.version ?? 0) !== expectedVersion)
    throw new Error(
      `对象版本冲突：当前版本 ${object?.version ?? 0}，请重新读取并保留用户修改后重试`,
    );
}
function validateEvidence(context: AppContext, ids: string[]) {
  const feedbackObjects = context
    .getObjects("feedback")
    .filter((object) => object.conversationId === context.conversationId);
  const evidence = new Map(
    feedbackObjects.flatMap((object) =>
      ((object.data as unknown as FeedbackData).items ?? []).map(
        (item) => [item.id, item] as const,
      ),
    ),
  );
  for (const id of ids) {
    if (!evidence.has(id))
      throw new Error(
        `反馈证据 ${id} 不存在，请先读取反馈台，不要编造证据编号`,
      );
    if (evidence.get(id)!.excluded)
      throw new Error(`反馈 ${id} 已被用户排除，请移除该证据后重试`);
  }
}
function saveBoard(
  context: AppContext,
  object: AppObject | undefined,
  data: OpportunityData,
  expectedVersion: number,
) {
  const saved = context.saveObject({
    id: object?.id,
    appId: "opportunities",
    type: "opportunity-board",
    title: object?.title ?? "产品机会看板",
    expectedVersion,
    data: { ...(object?.data ?? {}), ...data },
  });
  context.openPanel({
    kind: "app",
    appId: "opportunities",
    objectId: saved.id,
  });
  return saved;
}

const app: AppDefinition = {
  manifest: {
    id: "opportunities",
    name: "机会看板",
    category: "productivity",
    publisher: "Orbit Labs",
    starterPrompts: ["读取最新看板和反馈，帮我核对每个产品机会的证据。", "保留我设置的优先级，整理本轮最值得推进的三个问题。"],
    version: "1.0.0",
    icon: "columns",
    description:
      "把反馈证据组织为产品机会，维护改进方向、优先级和处理状态。用户和 Agent 共享同一份版本化看板；初始卡片为示例基线。",
    capabilities: [
      "组织产品机会",
      "关联原始证据",
      "维护优先级与状态",
      "合并相关问题",
    ],
    permissions: [
      "读取当前工作中的机会与证据",
      "创建和更新机会",
      "按用户要求调整优先级与方向",
      "打开机会面板",
    ],
    panel: { entry: "opportunities/Panel.tsx" },
    tools: [
      {
        name: "opportunities_read",
        description: "读取最新看板、用户决策及版本。",
      },
      {
        name: "opportunities_upsert",
        description: "创建机会或更新分析与证据，保留已有优先级、状态与方向。",
      },
      {
        name: "opportunities_update",
        description: "按用户明确要求调整优先级、状态或改进方向。",
      },
      {
        name: "opportunities_merge",
        description: "按用户要求合并问题，汇集证据并保留目标项决策。",
      },
    ],
  },
  seed: () => [
    {
      appId: "opportunities",
      type: "opportunity-board",
      title: "产品机会看板",
      data: initialOpportunities() as unknown as Record<string, unknown>,
    },
  ],
  validateObject: validateOpportunityObject,
  createTools(context) {
    const read = defineTool({
      name: "opportunities_read",
      label: "读取机会看板",
      description:
        "读取看板的最新版本、改进方向、优先级和状态。用户可在 GUI 直接修改，每次写入前必须重新读取。初始卡片为人工预置的示例基线，不是已经完成的 Agent 分析。",
      parameters: Type.Object({ objectId: Type.Optional(Type.String()) }),
      async execute(_id, params) {
        const object = board(context, params.objectId);
        return result({
          object: object ?? null,
          note: object
            ? "保留现有 priority/status/focus，除非用户明确要求修改。反馈证据来自虚构示例资料。"
            : "尚无看板，可使用 expectedVersion=0 创建。",
        });
      },
    });
    if (context.readOnly) return [read];
    const upsert = defineTool({
      name: "opportunities_upsert",
      label: "更新机会与证据",
      description:
        "创建或更新产品机会。items 仅需传要变化的项；未提及项保留。提供已有 id 更新标题、分析、分类与证据；不提供 id 自动创建。已有项 priority/status 与看板 focus 始终保留。调整这些用户决策请用 opportunities_update。必须先读最新版本；新建看板版本为 0。",
      parameters: Type.Object({
        objectId: Type.Optional(Type.String()),
        expectedVersion: Type.Integer({ minimum: 0 }),
        items: Type.Array(
          Type.Object({
            id: Type.Optional(Type.String()),
            title: Type.String({ minLength: 1 }),
            description: Type.String({ minLength: 1 }),
            category: Type.String({ minLength: 1 }),
            feedbackIds: Type.Array(Type.String(), { minItems: 1 }),
            priority: Type.Optional(Priority),
            status: Type.Optional(Status),
          }),
          { minItems: 1, maxItems: 20 },
        ),
      }),
      async execute(_id, params) {
        const object = board(context, params.objectId);
        if (params.objectId && !object) throw new Error("指定的看板不存在");
        writable(context, object, params.expectedVersion);
        const old = object
          ? boardData(object)
          : { items: [], focus: "根据用户反馈持续改进产品体验" };
        const items = old.items.map((item) => ({
          ...item,
          feedbackIds: [...item.feedbackIds],
        }));
        const receivedIds = new Set<string>();
        for (const incoming of params.items) {
          validateEvidence(context, incoming.feedbackIds);
          if (incoming.id && receivedIds.has(incoming.id))
            throw new Error(`同一批更新不能重复指定 ${incoming.id}`);
          if (incoming.id) receivedIds.add(incoming.id);
          const existing = incoming.id
            ? items.find((item) => item.id === incoming.id)
            : undefined;
          if (incoming.id && !existing)
            throw new Error(`未找到机会 ${incoming.id}；新增机会时请省略 id`);
          if (existing) {
            Object.assign(existing, {
              title: incoming.title,
              description: incoming.description,
              category: incoming.category,
              feedbackIds: [...new Set(incoming.feedbackIds)],
            });
          } else {
            const next =
              Math.max(
                0,
                ...items.map((item) => Number(item.id.replace(/^O/, "")) || 0),
              ) + 1;
            items.push({
              id: `O${String(next).padStart(3, "0")}`,
              title: incoming.title,
              description: incoming.description,
              category: incoming.category,
              feedbackIds: [...new Set(incoming.feedbackIds)],
              priority: incoming.priority ?? "P1",
              status: incoming.status ?? "proposed",
            });
          }
        }
        const saved = saveBoard(
          context,
          object,
          { ...old, items },
          params.expectedVersion,
        );
        context.recordActivity(
          "机会分析已更新",
          `更新 ${params.items.length} 项 · 保留已有优先级、状态和方向 · 版本 ${saved.version}`,
        );
        return result(saved);
      },
    });
    const update = defineTool({
      name: "opportunities_update",
      label: "调整产品决策",
      description:
        "仅按用户明确要求调整改进方向 focus、某项机会 priority/status。必须传 userRequest 说明具体用户要求。无用户要求时保留 GUI 已保存的决策；不得为了重做分析而重置。",
      parameters: Type.Object({
        objectId: Type.String(),
        expectedVersion: Type.Integer({ minimum: 1 }),
        userRequest: Type.String({ minLength: 1 }),
        opportunityId: Type.Optional(Type.String()),
        priority: Type.Optional(Priority),
        status: Type.Optional(Status),
        focus: Type.Optional(Type.String({ minLength: 1 })),
      }),
      async execute(_id, params) {
        const object = board(context, params.objectId);
        if (!object) throw new Error("未找到机会看板");
        writable(context, object, params.expectedVersion);
        if (!params.userRequest.trim())
          throw new Error("请说明需要执行的用户要求");
        const data = boardData(object);
        if (
          params.priority === undefined &&
          params.status === undefined &&
          params.focus === undefined
        )
          throw new Error("没有需要调整的字段");
        if (
          (params.priority !== undefined || params.status !== undefined) &&
          !params.opportunityId
        )
          throw new Error("调整优先级或状态需要指定 opportunityId");
        if (
          params.opportunityId &&
          !data.items.some((item) => item.id === params.opportunityId)
        )
          throw new Error(`未找到机会 ${params.opportunityId}`);
        const items = data.items.map((item) =>
          item.id === params.opportunityId
            ? {
                ...item,
                ...(params.priority !== undefined
                  ? { priority: params.priority }
                  : {}),
                ...(params.status !== undefined
                  ? { status: params.status }
                  : {}),
              }
            : item,
        );
        const saved = saveBoard(
          context,
          object,
          { items, focus: params.focus ?? data.focus },
          params.expectedVersion,
        );
        context.recordActivity("工作要求已更新", params.userRequest);
        return result(saved);
      },
    });
    const merge = defineTool({
      name: "opportunities_merge",
      label: "合并相关问题",
      description:
        "按用户要求将 sourceIds 合并到 targetId，合并原始证据并删除来源卡片，保留目标项的优先级和状态。必须读取最新版本并说明 userRequest；不会自动更改其他卡片。",
      parameters: Type.Object({
        objectId: Type.String(),
        expectedVersion: Type.Integer({ minimum: 1 }),
        targetId: Type.String(),
        sourceIds: Type.Array(Type.String(), { minItems: 1 }),
        userRequest: Type.String({ minLength: 1 }),
        title: Type.Optional(Type.String({ minLength: 1 })),
        description: Type.Optional(Type.String({ minLength: 1 })),
      }),
      async execute(_id, params) {
        const object = board(context, params.objectId);
        if (!object) throw new Error("未找到机会看板");
        writable(context, object, params.expectedVersion);
        if (!params.userRequest.trim())
          throw new Error("请说明需要执行的用户要求");
        const data = boardData(object);
        const target = data.items.find((item) => item.id === params.targetId);
        if (!target) throw new Error(`未找到目标机会 ${params.targetId}`);
        if (params.sourceIds.includes(params.targetId))
          throw new Error("来源项不能包含目标项");
        const sources = [...new Set(params.sourceIds)].map((id) => {
          const item = data.items.find((candidate) => candidate.id === id);
          if (!item) throw new Error(`未找到来源机会 ${id}`);
          return item;
        });
        const validIds = new Set(
          context
            .getObjects("feedback")
            .flatMap((object) =>
              ((object.data as unknown as FeedbackData).items ?? [])
                .filter((item) => !item.excluded)
                .map((item) => item.id),
            ),
        );
        const feedbackIds = [
          ...new Set([target, ...sources].flatMap((item) => item.feedbackIds)),
        ].filter((id) => validIds.has(id));
        const items = data.items
          .filter((item) => !params.sourceIds.includes(item.id))
          .map((item) =>
            item.id === target.id
              ? {
                  ...item,
                  title: params.title ?? item.title,
                  description:
                    params.description ??
                    [
                      item.description,
                      ...sources.map((source) => source.description),
                    ].join("\n"),
                  feedbackIds,
                }
              : item,
          );
        const saved = saveBoard(
          context,
          object,
          { ...data, items },
          params.expectedVersion,
        );
        context.recordActivity(
          "相关问题已合并",
          `${params.sourceIds.join("、")} → ${params.targetId} · ${params.userRequest}`,
        );
        return result(saved);
      },
    });
    return [read, upsert, update, merge];
  },
};

export default app;
