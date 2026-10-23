import { Type } from "typebox";
import { Value } from "typebox/value";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { AppContext, AppDefinition } from "../../shared/plugin.ts";
import type {
  AppObject,
  FeedbackData,
  FeedbackItem,
} from "../../shared/types.ts";

const FeedbackSchema = Type.Object(
  {
    items: Type.Array(
      Type.Object(
        {
          id: Type.String({ pattern: "^F[0-9]{3,}$" }),
          source: Type.String({ minLength: 1 }),
          segment: Type.Union([Type.Literal("new"), Type.Literal("active")]),
          customer: Type.String({ minLength: 1 }),
          text: Type.String({ minLength: 1 }),
          topic: Type.String({ minLength: 1 }),
          excluded: Type.Boolean(),
          createdAt: Type.String({ minLength: 1 }),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export function validateFeedbackObject(
  data: Record<string, unknown>,
  type: string,
) {
  if (type !== "feedback-inbox") throw new Error("反馈台不支持此对象类型");
  if (!Value.Check(FeedbackSchema, data))
    throw new Error("反馈数据格式不正确：需要合法的反馈数组、用户群和排除状态");
  const ids = new Set<string>();
  for (const item of data.items) {
    if (ids.has(item.id)) throw new Error(`反馈编号重复：${item.id}`);
    ids.add(item.id);
    if (
      ![item.source, item.customer, item.text, item.topic].every((value) =>
        value.trim(),
      )
    )
      throw new Error("反馈的来源、用户、原文和主题不能为空");
    if (
      !/^\d{4}-\d{2}-\d{2}T/.test(item.createdAt) ||
      !Number.isFinite(Date.parse(item.createdAt))
    )
      throw new Error(`反馈 ${item.id} 的时间无效`);
  }
}

const sampleRows: [string, FeedbackItem["segment"], string, string, string][] =
  [
    [
      "应用内反馈",
      "new",
      "新用户 01",
      "想给项目建一个模板，找了很久，以为没有这个功能，后来同事告诉我在项目菜单里。",
      "功能发现",
    ],
    [
      "客服对话",
      "new",
      "新用户 02",
      "第一次进来不知道从哪开始。我只是想把会议记录变成待办，首页入口太多了。",
      "首次使用",
    ],
    [
      "应用内反馈",
      "active",
      "活跃用户 01",
      "同一条任务评论，桌面、邮件和应用内都提醒了一遍，希望能按项目选择通知。",
      "通知噪声",
    ],
    [
      "用户访谈",
      "new",
      "新用户 03",
      "搜索只搜到任务标题。我以为不能搜附件，直到有人教我切到文件标签。",
      "功能发现",
    ],
    [
      "客服对话",
      "active",
      "活跃用户 02",
      "关注了几个项目以后每天通知很多，真正 @ 我的消息经常被淹没。",
      "通知噪声",
    ],
    [
      "应用内反馈",
      "new",
      "新用户 04",
      "希望增加任务模板，不然每周都要重新录入相同的清单。",
      "功能发现",
    ],
    [
      "用户访谈",
      "active",
      "活跃用户 03",
      "希望有甘特图，跨项目排期时现在还得导出到其他工具。",
      "新能力",
    ],
    [
      "应用内反馈",
      "active",
      "活跃用户 04",
      "文档修改很及时，但每次小改动都推送，开会时一直弹，很打断思路。",
      "通知噪声",
    ],
    [
      "客服对话",
      "new",
      "新用户 05",
      "邀请同事按钮只在项目设置里，第一次找不到，最后把截图发到群里了。",
      "首次使用",
    ],
    [
      "应用内反馈",
      "active",
      "活跃用户 05",
      "任务搜索挺好用，如果能保存常用的筛选条件会省事。",
      "新能力",
    ],
    [
      "用户访谈",
      "new",
      "新用户 06",
      "导入完会议记录后，看不到下一步可以自动提取待办，试了两次才发现右上角按钮。",
      "功能发现",
    ],
    [
      "应用内反馈",
      "active",
      "活跃用户 06",
      "能不能做每日上午一条摘要？不紧急的项目更新就不必逐条提醒。",
      "通知噪声",
    ],
    [
      "客服对话",
      "active",
      "活跃用户 07",
      "希望支持离线编辑文档，出差高铁上网络不稳定。",
      "新能力",
    ],
    [
      "应用内反馈",
      "new",
      "新用户 07",
      "用了三天才知道可以用快捷键创建任务，新手提示里没有这些常用操作。",
      "功能发现",
    ],
  ];

export function initialFeedback(): FeedbackData {
  return {
    items: sampleRows.map(
      ([source, segment, customer, text, topic], index) => ({
        id: `F${String(index + 1).padStart(3, "0")}`,
        source,
        segment,
        customer,
        text,
        topic,
        excluded: false,
        createdAt: `2026-09-${String(18 + Math.floor(index / 2)).padStart(2, "0")}T09:00:00+08:00`,
      }),
    ),
  };
}

function getInbox(context: AppContext, id?: string): AppObject | undefined {
  const object = id ? context.getObject(id) : context.getObjects("feedback")[0];
  if (!object) return undefined;
  if (
    object.conversationId !== context.conversationId ||
    object.appId !== "feedback" ||
    object.type !== "feedback-inbox"
  )
    throw new Error("反馈对象不属于当前工作");
  return object;
}
function dataOf(object: AppObject): FeedbackData {
  return object.data as unknown as FeedbackData;
}
function result(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    details: data,
  };
}
function requireWrite(
  context: AppContext,
  object: AppObject | undefined,
  expectedVersion: number,
): AppObject {
  if (context.readOnly)
    throw new Error("子任务为只读，请将建议返回主 Agent 保存");
  if (!object) throw new Error("未找到反馈对象");
  if (object.version !== expectedVersion)
    throw new Error(
      `对象版本冲突：当前版本 ${object.version}，请重新读取并保留用户修改后重试`,
    );
  return object;
}

const app: AppDefinition = {
  manifest: {
    id: "feedback",
    name: "反馈台",
    category: "productivity",
    publisher: "Orbit Labs",
    starterPrompts: ["读取当前反馈，按用户问题归类并列出原始证据。", "比较新用户与活跃用户的反馈，指出需要进一步验证的问题。"],
    version: "1.0.0",
    icon: "inbox",
    description:
      "从用户反馈中查找原始证据，按用户群筛选，标记主题并排除噪声。内置内容均为虚构的协作产品示例反馈。",
    capabilities: ["检索原始反馈", "按用户群分析", "标记与排除", "新反馈事件"],
    permissions: [
      "读取当前工作中的反馈",
      "修改反馈标签与排除状态",
      "打开反馈面板",
      "产生反馈新增事件",
    ],
    panel: { entry: "feedback/Panel.tsx" },
    tools: [
      {
        name: "feedback_search",
        description: "按关键词、用户群检索反馈，默认排除用户已忽略的内容。",
      },
      {
        name: "feedback_read",
        description: "读取最新反馈对象、版本和指定证据。",
      },
      {
        name: "feedback_update",
        description: "按用户要求修改一条反馈的主题或排除状态，必须带最新版本。",
      },
    ],
  },
  seed: () => [
    {
      appId: "feedback",
      type: "feedback-inbox",
      title: "团队协作产品 · 用户反馈",
      data: initialFeedback() as unknown as Record<string, unknown>,
    },
  ],
  validateObject: validateFeedbackObject,
  createTools(context) {
    const search = defineTool({
      name: "feedback_search",
      label: "检索用户反馈",
      description:
        "查询当前工作的反馈。内置数据为虚构示例；segment=new 表示新用户，active 表示活跃用户。默认不返回已排除反馈。保留原始 F 编号作为证据引用。",
      parameters: Type.Object({
        query: Type.Optional(Type.String()),
        segment: Type.Optional(
          Type.Union([Type.Literal("new"), Type.Literal("active")]),
        ),
        includeExcluded: Type.Optional(Type.Boolean()),
      }),
      async execute(_id, params) {
        const object = getInbox(context);
        if (!object)
          return result({
            items: [],
            total: 0,
            note: "当前工作没有反馈数据，请让用户打开包含反馈的工作。",
          });
        const query = (params.query ?? "").trim().toLowerCase();
        const items = dataOf(object).items.filter(
          (item) =>
            (!item.excluded || params.includeExcluded) &&
            (!params.segment || item.segment === params.segment) &&
            (!query ||
              `${item.text} ${item.topic} ${item.source} ${item.id}`
                .toLowerCase()
                .includes(query)),
        );
        return result({
          objectId: object.id,
          version: object.version,
          sampleData: true,
          items,
          total: items.length,
          totalInInbox: dataOf(object).items.length,
        });
      },
    });
    const read = defineTool({
      name: "feedback_read",
      label: "读取最新反馈",
      description:
        "读取反馈对象的最新版本；更新或引用前重新读取。ids 可指定 F001 等证据编号；不传返回完整对象，包括排除状态。",
      parameters: Type.Object({
        objectId: Type.Optional(Type.String()),
        ids: Type.Optional(Type.Array(Type.String())),
      }),
      async execute(_id, params) {
        const object = getInbox(context, params.objectId);
        if (!object)
          return result({ object: null, note: "当前工作没有反馈对象" });
        const items = dataOf(object).items.filter(
          (item) => !params.ids || params.ids.includes(item.id),
        );
        return result({ ...object, data: { items }, sampleData: true });
      },
    });
    if (context.readOnly) return [search, read];
    const update = defineTool({
      name: "feedback_update",
      label: "更新反馈标记",
      description:
        "仅在用户要求时更新反馈主题或排除状态。先读取最新对象，必须传 expectedVersion；保留其他反馈及原文。",
      parameters: Type.Object({
        objectId: Type.String(),
        expectedVersion: Type.Integer({ minimum: 1 }),
        feedbackId: Type.String(),
        excluded: Type.Optional(Type.Boolean()),
        topic: Type.Optional(Type.String({ minLength: 1 })),
      }),
      async execute(_id, params) {
        const object = requireWrite(
          context,
          getInbox(context, params.objectId),
          params.expectedVersion,
        );
        const data = dataOf(object);
        if (!data.items.some((item) => item.id === params.feedbackId))
          throw new Error(`未找到反馈 ${params.feedbackId}`);
        if (params.excluded === undefined && params.topic === undefined)
          throw new Error("请提供要修改的主题或排除状态");
        const items = data.items.map((item) =>
          item.id === params.feedbackId
            ? {
                ...item,
                ...(params.excluded !== undefined
                  ? { excluded: params.excluded }
                  : {}),
                ...(params.topic !== undefined ? { topic: params.topic } : {}),
              }
            : item,
        );
        const saved = context.saveObject({
          id: object.id,
          appId: "feedback",
          type: object.type,
          title: object.title,
          expectedVersion: params.expectedVersion,
          data: { ...object.data, items },
        });
        context.recordActivity(
          "反馈标记已更新",
          `${params.feedbackId} · 版本 ${saved.version}`,
        );
        return result(saved);
      },
    });
    return [search, read, update];
  },
  onDemoEvent(context) {
    const object = getInbox(context);
    if (!object) throw new Error("请先选择包含示例反馈的工作");
    requireWrite(context, object, object.version);
    const data = dataOf(object);
    const n =
      Math.max(
        0,
        ...data.items.map((item) => Number(item.id.replace(/^F/, "")) || 0),
      ) + 1;
    const id = `F${String(n).padStart(3, "0")}`;
    const variants = [
      [
        "new",
        "终于搜到上周的任务，但打开后不知道上次做到哪一步，只能重新翻聊天，希望能直接看到当前进展和下一步。",
        "进度恢复",
      ],
      [
        "active",
        "关闭所有通知后又漏掉了 @ 我的任务，希望把需要我行动的提醒和普通更新分开。",
        "通知噪声",
      ],
      [
        "new",
        "我想把会议纪要转成待办，找不到入口就又手动录入了一遍。",
        "功能发现",
      ],
    ] as const;
    const [segment, text, topic] =
      variants[(n - 15 + variants.length) % variants.length]!;
    const item: FeedbackItem = {
      id,
      source: "示例事件",
      segment,
      customer: `新增示例用户 ${n - 14}`,
      text,
      topic,
      excluded: false,
      createdAt: new Date().toISOString(),
    };
    context.saveObject({
      id: object.id,
      appId: "feedback",
      type: object.type,
      title: object.title,
      expectedVersion: object.version,
      data: { ...object.data, items: [...data.items, item] },
    });
    context.recordActivity(
      "收到新增示例反馈",
      `${id} · ${topic}。此数据源为演示，后续接续由真实 Agent 执行。`,
    );
    return {
      eventName: "feedback.added",
      detail: `新增示例反馈 ${id}：${text}`,
    };
  },
};

export default app;
