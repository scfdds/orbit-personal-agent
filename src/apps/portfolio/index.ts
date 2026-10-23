import { Type } from "typebox";
import { Value } from "typebox/value";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { AppContext, AppDefinition } from "../../shared/plugin.ts";
import type { AppObject } from "../../shared/types.ts";
import { asRecord, emptyPortfolio, portfolioMarkdown, summarizePositions, type PortfolioData, type Position, type Observation } from "./data.ts";

const text = (maxLength = 2000) => Type.String({ maxLength });
const currency = Type.Union([Type.Literal("CNY"), Type.Literal("USD"), Type.Literal("HKD")]);
const date = Type.String({ pattern: "^(|[0-9]{4}-[0-9]{2}-[0-9]{2})$" });
const positionFields = {
  symbol: Type.String({ minLength: 1, maxLength: 30 }), name: Type.String({ minLength: 1, maxLength: 80 }), currency,
  kind: Type.Union([Type.Literal("holding"), Type.Literal("watching")]),
  quantity: Type.Number({ minimum: 0, maximum: 1e10 }), averageCost: Type.Number({ minimum: 0, maximum: 1e9 }),
  lastPrice: Type.Union([Type.Number({ minimum: 0, maximum: 1e9 }), Type.Null()]),
  quoteDate: date, quoteSource: text(300), note: text(), source: Type.Union([Type.Literal("sample"), Type.Literal("manual")]),
};
const observationFields = {
  positionId: text(50), title: Type.String({ minLength: 1, maxLength: 160 }), detail: text(4000), evidence: text(4000), dueDate: date,
  status: Type.Union([Type.Literal("open"), Type.Literal("done")]),
};
const positionSchema = Type.Object({ id: Type.String({ pattern: "^P[0-9]{3,}$" }), ...positionFields }, { additionalProperties: false });
const observationSchema = Type.Object({ id: Type.String({ pattern: "^T[0-9]{3,}$" }), ...observationFields }, { additionalProperties: false });
const schema = Type.Object({ title: Type.String({ minLength: 1, maxLength: 120 }), focus: text(4000), positions: Type.Array(positionSchema, { maxItems: 200 }), observations: Type.Array(observationSchema, { maxItems: 300 }) }, { additionalProperties: false });

function validDate(value: string): boolean {
  return !value || (!Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value);
}
export function validatePortfolio(data: Record<string, unknown>, type: string) {
  if (type !== "portfolio-book" || !Value.Check(schema, data)) throw new Error("持仓数据格式不正确，请检查金额、日期和字段");
  const d = data as unknown as PortfolioData;
  if (!d.title.trim()) throw new Error("组合名称不能为空");
  const ids = new Set<string>();
  const symbols = new Set<string>();
  for (const p of d.positions) {
    if (ids.has(p.id)) throw new Error("持仓编号重复");
    ids.add(p.id);
    const symbol = `${p.currency}:${p.symbol.trim().toUpperCase()}`;
    if (symbols.has(symbol)) throw new Error("同一币种的资产代码不能重复，请编辑已有资产");
    symbols.add(symbol);
    if (!p.name.trim() || !p.symbol.trim()) throw new Error("名称和代码不能为空");
    if (![p.quantity, p.averageCost, ...(p.lastPrice === null ? [] : [p.lastPrice])].every(Number.isFinite)) throw new Error("金额和数量必须为有限数字");
    if (p.kind === "holding" && p.quantity <= 0) throw new Error("持仓数量必须大于零");
    if (p.kind === "watching" && (p.quantity !== 0 || p.averageCost !== 0)) throw new Error("自选资产不计入持仓，请将数量和成本设为零");
    if (!validDate(p.quoteDate)) throw new Error("价格日期无效");
    if (p.lastPrice !== null && (!p.quoteDate || !p.quoteSource.trim())) throw new Error("录入参考价时需填写价格日期和来源");
    if (p.lastPrice === null && (p.quoteDate || p.quoteSource)) throw new Error("未录入价格时请保持价格日期和来源为空");
  }
  const observationIds = new Set<string>();
  for (const o of d.observations) {
    if (observationIds.has(o.id)) throw new Error("观察编号重复");
    observationIds.add(o.id);
    if (!o.title.trim()) throw new Error("观察事项不能为空");
    if (o.positionId && !ids.has(o.positionId)) throw new Error("关联资产不属于当前组合");
    if (!validDate(o.dueDate)) throw new Error("观察日期无效");
  }
}
function book(context: AppContext, id?: string): AppObject {
  const object = id ? context.getObject(id) : context.getObjects("portfolio")[0];
  if (!object || object.appId !== "portfolio" || object.type !== "portfolio-book" || object.conversationId !== context.conversationId) throw new Error("持仓对象不存在或不属于当前对话");
  return object;
}
function writable(context: AppContext, object: AppObject, expectedVersion: number, userRequest: string) {
  if (context.readOnly) throw new Error("当前子 Agent 为只读，请将建议交给主 Agent");
  if (!Number.isInteger(expectedVersion) || object.version !== expectedVersion) throw new Error(`版本冲突：当前版本 ${object.version}，请重新读取并保留用户修改`);
  if (!userRequest?.trim()) throw new Error("请说明本次修改对应的用户要求");
}
const result = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }], details: data });
function save(context: AppContext, object: AppObject, data: PortfolioData) {
  validatePortfolio(asRecord(data), object.type);
  const saved = context.saveObject({ id: object.id, appId: "portfolio", type: object.type, title: data.title, expectedVersion: object.version, data: asRecord(data) });
  context.recordActivity("持仓追踪已更新", `${data.positions.length} 项资产 · ${data.observations.length} 项观察 · v${saved.version}`);
  context.openPanel({ kind: "app", appId: "portfolio", objectId: saved.id });
  return saved;
}
const common = { objectId: Type.String(), expectedVersion: Type.Integer({ minimum: 1 }), userRequest: Type.String({ minLength: 1, maxLength: 2000 }) };
const positionPatch = Type.Partial(Type.Object(positionFields, { additionalProperties: false }));
const observationPatch = Type.Partial(Type.Object(observationFields, { additionalProperties: false }));
const nextId = (prefix: string, items: { id: string }[]) => `${prefix}${String(Math.max(0, ...items.map((item) => Number(item.id.slice(1)))) + 1).padStart(3, "0")}`;

const app: AppDefinition = {
  manifest: {
    id: "portfolio", name: "持仓追踪", version: "1.0.0", icon: "ChartNoAxesCombined", category: "finance", publisher: "Orbit Labs",
    description: "整理持仓与自选，把价格、观察依据和复盘清单放在一起。",
    capabilities: ["持仓与自选", "盈亏与分布", "观察清单", "导出复盘"],
    permissions: ["读取当前对话中的持仓", "按用户要求更新资产和观察事项", "导出持仓复盘 Markdown"],
    panel: { entry: "portfolio/Panel.tsx" },
    starterPrompts: ["读取我的持仓追踪，梳理当前组合的集中度和需要补充的信息。不要给出买卖建议。", "按我记录的持仓依据整理一份观察清单，保留已完成事项。"],
    tools: [
      { name: "portfolio_read", description: "读取最新持仓、价格来源、用户备注、观察清单及版本。" },
      { name: "portfolio_upsert_position", description: "按用户要求新增或局部更新资产，保留未指定字段。" },
      { name: "portfolio_upsert_observation", description: "新增或局部更新观察事项、依据和复核状态。" },
      { name: "portfolio_remove", description: "按明确用户要求移除资产或观察事项。" },
    ],
  },
  seed: () => [{ appId: "portfolio", type: "portfolio-book", title: "我的持仓与观察", data: asRecord(emptyPortfolio()) }],
  validateObject: validatePortfolio,
  async exportFile(context, format) {
    if (format !== "md") throw new Error("持仓追踪目前支持 Markdown 导出");
    const object = book(context);
    return { content: portfolioMarkdown(object.data as unknown as PortfolioData), contentType: "text/markdown; charset=utf-8", filename: "持仓与观察复盘.md" };
  },
  createTools(context) {
    const read = defineTool({
      name: "portfolio_read", label: "读取持仓与观察", description: "每次写入前先读取最新版本。quoteDate/quoteSource 表示手工录入价格的时间和来源，不是实时行情；sample 资产及价格均虚构，不可据此生成真实市场结论。不同币种分别计算。保留用户持仓数量、成本、备注和观察状态，不做未经要求的投资决策。",
      parameters: Type.Object({ objectId: Type.Optional(Type.String()) }),
      async execute(_id, params) { const object = book(context, params.objectId); return result({ object, summary: summarizePositions((object.data as unknown as PortfolioData).positions), note: "价格为带日期的参考记录，非实时行情；盈亏未包含税费、分红。" }); },
    });
    if (context.readOnly) return [read];
    const position = defineTool({
      name: "portfolio_upsert_position", label: "更新资产记录", description: "仅按用户要求新增或修改资产。已有 positionId 的 patch 只更改指定字段，其余字段保留。新建至少提供 name/symbol/currency/kind；持仓还需 quantity/averageCost。参考价格必须同时提供 quoteDate 和 quoteSource；未知价格用 null。不可编造行情或用户持仓。修改来源不改变 sample 属性以免把示例当成真实资产。",
      parameters: Type.Object({ ...common, positionId: Type.Optional(Type.String()), patch: positionPatch }),
      async execute(_id, params) {
        const object = book(context, params.objectId);
        writable(context, object, params.expectedVersion, params.userRequest);
        if (!Value.Check(positionPatch, params.patch) || !Object.keys(params.patch).length) throw new Error("资产更新字段不正确或为空");
        const data = object.data as unknown as PortfolioData;
        const old = params.positionId ? data.positions.find((p) => p.id === params.positionId) : undefined;
        if (params.positionId && !old) throw new Error("未找到指定资产");
        if (!old && (!params.patch.name || !params.patch.symbol || !params.patch.currency || !params.patch.kind)) throw new Error("新增资产需要名称、代码、币种和类型");
        if (!old && params.patch.kind === "holding" && (params.patch.quantity === undefined || params.patch.averageCost === undefined)) throw new Error("新增持仓需要用户提供数量和成本价");
        if (old && params.patch.source !== undefined && params.patch.source !== old.source) throw new Error("已有资产的示例来源标记不能修改；请新增真实资产记录");
        const next: Position = { id: nextId("P", data.positions), symbol: "", name: "", currency: "CNY", kind: "watching", quantity: 0, averageCost: 0, lastPrice: null, quoteDate: "", quoteSource: "", note: "", source: "manual", ...old, ...params.patch };
        if (next.source === "sample" && next.lastPrice !== null && !next.quoteSource.includes("示例")) throw new Error("示例资产的价格来源必须标注示例");
        const positions = old ? data.positions.map((p) => p.id === old.id ? next : p) : [...data.positions, next];
        return result(save(context, object, { ...data, positions }));
      },
    });
    const observation = defineTool({
      name: "portfolio_upsert_observation", label: "更新观察清单", description: "新增或局部更新观察事项。保留未提及的内容和用户的完成状态。positionId 可为空表示组合级观察。evidence 保存实际资料或原文来源，不要伪造检索结果。dueDate 只记录复核日期，不代表已创建定时执行；需要持续跟踪时使用宿主的目标与触发工具。",
      parameters: Type.Object({ ...common, observationId: Type.Optional(Type.String()), patch: observationPatch }),
      async execute(_id, params) {
        const object = book(context, params.objectId);
        writable(context, object, params.expectedVersion, params.userRequest);
        if (!Value.Check(observationPatch, params.patch) || !Object.keys(params.patch).length) throw new Error("观察更新字段不正确或为空");
        const data = object.data as unknown as PortfolioData;
        const old = params.observationId ? data.observations.find((o) => o.id === params.observationId) : undefined;
        if (params.observationId && !old) throw new Error("未找到指定观察事项");
        if (!old && !params.patch.title) throw new Error("新增观察事项需要标题");
        const next: Observation = { id: nextId("T", data.observations), positionId: "", title: "", detail: "", evidence: "", dueDate: "", status: "open", ...old, ...params.patch };
        return result(save(context, object, { ...data, observations: old ? data.observations.map((o) => o.id === old.id ? next : o) : [...data.observations, next] }));
      },
    });
    const remove = defineTool({
      name: "portfolio_remove", label: "移除持仓记录", description: "按用户明确要求移除一项资产或观察事项。移除资产时保留观察事项，仅清除关联资产引用。该工具不会进行交易。",
      parameters: Type.Object({ ...common, kind: Type.Union([Type.Literal("position"), Type.Literal("observation")]), id: Type.String() }),
      async execute(_id, params) {
        const object = book(context, params.objectId);
        writable(context, object, params.expectedVersion, params.userRequest);
        const data = object.data as unknown as PortfolioData;
        if (params.kind === "position") {
          if (!data.positions.some((p) => p.id === params.id)) throw new Error("未找到指定资产");
          return result(save(context, object, { ...data, positions: data.positions.filter((p) => p.id !== params.id), observations: data.observations.map((o) => o.positionId === params.id ? { ...o, positionId: "" } : o) }));
        }
        if (!data.observations.some((o) => o.id === params.id)) throw new Error("未找到指定观察事项");
        return result(save(context, object, { ...data, observations: data.observations.filter((o) => o.id !== params.id) }));
      },
    });
    return [read, position, observation, remove];
  },
};
export default app;
