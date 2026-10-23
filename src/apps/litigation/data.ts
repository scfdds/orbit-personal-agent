import { Type } from "typebox";
import { Value } from "typebox/value";

export interface CaseParty { id: string; name: string; role: string; contact: string; userEdited: boolean }
export interface CaseEvent { id: string; date: string; title: string; detail: string; evidenceIds: string[]; userEdited: boolean }
export interface CaseEvidence { id: string; title: string; kind: string; source: string; description: string; status: "missing" | "collected" | "checked"; userEdited: boolean }
export interface CaseChecklist { id: string; title: string; detail: string; evidenceIds: string[]; ready: boolean; userEdited: boolean }
export interface LitigationData {
  title: string;
  source: "empty" | "sample" | "user";
  summary: string;
  objective: string;
  userEdited: boolean;
  parties: CaseParty[];
  events: CaseEvent[];
  evidence: CaseEvidence[];
  checklist: CaseChecklist[];
  reviewNotes: string;
}

const text = (maxLength: number, minLength = 0) => Type.String({ minLength, maxLength });
const id = (prefix: string) => Type.String({ pattern: `^${prefix}[0-9]{3,}$`, maxLength: 24, description: "已有条目的编号。新增条目必须省略 id，由系统分配；不要自行指定新编号。" });
const refs = () => Type.Array(id("E"), { uniqueItems: true, maxItems: 100 });
export const partyInput = Type.Object({ id: Type.Optional(id("P")), name: text(120, 1), role: text(100, 1), contact: text(500) }, { additionalProperties: false });
export const eventInput = Type.Object({ id: Type.Optional(id("F")), date: Type.String({ maxLength: 10, pattern: "^(|[0-9]{4}-[0-9]{2}-[0-9]{2})$", description: "有效日期 YYYY-MM-DD；未知日期传空字符串，不要填写待确认等文字。" }), title: text(160, 1), detail: text(5000), evidenceIds: refs() }, { additionalProperties: false });
export const evidenceInput = Type.Object({ id: Type.Optional(id("E")), title: text(160, 1), kind: text(60, 1), source: text(500), description: text(5000), status: Type.Union([Type.Literal("missing"), Type.Literal("collected"), Type.Literal("checked")]) }, { additionalProperties: false });
export const checklistInput = Type.Object({ id: Type.Optional(id("M")), title: text(160, 1), detail: text(2000), evidenceIds: refs(), ready: Type.Boolean() }, { additionalProperties: false });
const withMeta = (input: typeof partyInput | typeof eventInput | typeof evidenceInput | typeof checklistInput, prefix: string) => Type.Object({ ...input.properties, id: id(prefix), userEdited: Type.Boolean() }, { additionalProperties: false });
const schema = Type.Object({
  title: text(160), source: Type.Union([Type.Literal("empty"), Type.Literal("sample"), Type.Literal("user")]),
  summary: text(10000), objective: text(5000), userEdited: Type.Boolean(),
  parties: Type.Array(withMeta(partyInput, "P"), { maxItems: 40 }),
  events: Type.Array(withMeta(eventInput, "F"), { maxItems: 200 }),
  evidence: Type.Array(withMeta(evidenceInput, "E"), { maxItems: 200 }),
  checklist: Type.Array(withMeta(checklistInput, "M"), { maxItems: 100 }), reviewNotes: text(15000),
}, { additionalProperties: false });

export function validateLitigationData(input: Record<string, unknown>): asserts input is Record<string, unknown> & LitigationData {
  if (!Value.Check(schema, input)) throw new Error("案件资料格式不正确，请检查名称、字段长度及材料状态");
  const data = input as unknown as LitigationData;
  if (data.source !== "empty" && !data.title.trim()) throw new Error("请填写案件名称");
  if (data.source === "empty" && (data.parties.length || data.events.length || data.evidence.length || data.checklist.length || data.summary || data.objective || data.reviewNotes)) throw new Error("请先建立案件，再添加资料");
  for (const items of [data.parties, data.events, data.evidence, data.checklist]) {
    if (new Set(items.map((i) => i.id)).size !== items.length) throw new Error("同类资料的编号不能重复");
    if (items.some((item) => !("name" in item ? item.name : item.title).trim())) throw new Error("资料名称不能为空");
  }
  if (data.parties.some((p) => !p.role.trim()) || data.evidence.some((e) => !e.kind.trim())) throw new Error("请填写当事人身份和材料类型");
  for (const event of data.events) {
    if (event.date && (!/^\d{4}-\d{2}-\d{2}$/.test(event.date) || !Number.isFinite(Date.parse(`${event.date}T00:00:00Z`)) || new Date(`${event.date}T00:00:00Z`).toISOString().slice(0, 10) !== event.date)) throw new Error("事实日期应为有效日期，尚未确认时请留空");
  }
  const evidence = new Map(data.evidence.map((item) => [item.id, item]));
  for (const item of [...data.events, ...data.checklist]) {
    if (item.evidenceIds.some((ref) => !evidence.has(ref))) throw new Error("关联的证据不存在，请先添加材料或解除关联");
    if ("ready" in item && item.ready && item.evidenceIds.some((ref) => evidence.get(ref)!.status === "missing")) throw new Error("关联材料仍待补充，不能标记为已准备");
  }
}

export function emptyLitigation(): LitigationData {
  return { title: "", source: "empty", summary: "", objective: "", userEdited: false, parties: [], events: [], evidence: [], checklist: [], reviewNotes: "" };
}
export function sampleLitigation(): LitigationData {
  return {
    title: "设计服务尾款 · 材料整理", source: "sample", userEdited: false,
    summary: "虚构示例：青禾设计工作室向星桥商贸公司提供品牌设计服务。约定总费用 30,000 元，已收到预付款 12,000 元。工作室称已交付成果，尚有 18,000 元尾款未收到；对方提出部分交付内容仍需修改。双方对是否完成约定交付存在分歧。",
    objective: "整理尾款争议的事实、对应证据与待补材料，形成一份供后续专业核对的材料包。",
    parties: [
      { id: "P001", name: "青禾设计工作室（虚构）", role: "服务提供方", contact: "经办人及主体信息待补充", userEdited: false },
      { id: "P002", name: "星桥商贸公司（虚构）", role: "服务接受方", contact: "联系人及主体信息待补充", userEdited: false },
    ],
    events: [
      { id: "F001", date: "2026-08-03", title: "双方签订设计服务合同", detail: "示例约定总费用 30,000 元；应进一步核对交付范围及付款条件原文。", evidenceIds: ["E001"], userEdited: false },
      { id: "F002", date: "2026-08-05", title: "收到预付款 12,000 元", detail: "示例付款记录记载预付款到账，付款人与合同主体是否一致待核对。", evidenceIds: ["E002"], userEdited: false },
      { id: "F003", date: "2026-08-28", title: "发送设计成果，对方提出修改意见", detail: "工作室称通过邮件交付文件。完整邮件及附件尚未整理，不能仅据此认定交付或验收完成。", evidenceIds: ["E003"], userEdited: false },
    ],
    evidence: [
      { id: "E001", title: "设计服务合同", kind: "合同 / 约定", source: "示例资料 · 文本摘录", description: "虚构合同摘录：总费用 30,000 元，预付 40%，其余费用与约定交付相关。请补充完整合同及签署页。", status: "collected", userEdited: false },
      { id: "E002", title: "预付款转账记录", kind: "付款记录", source: "示例资料 · 付款信息", description: "虚构记录：2026-08-05 支付 12,000 元；演示只含记录描述，没有原始凭证附件。", status: "collected", userEdited: false },
      { id: "E003", title: "交付邮件与修改反馈", kind: "沟通 / 交付记录", source: "待由经办人补充", description: "需要完整邮件上下文、收件人、发送时间及附件版本，核对交付内容和具体修改意见。", status: "missing", userEdited: false },
    ],
    checklist: [
      { id: "M001", title: "整理完整合同及付款条款", detail: "当前仅有示例摘录；补充完整文本，核对双方约定。", evidenceIds: ["E001"], ready: false, userEdited: false },
      { id: "M002", title: "核对已收款与待收款明细", detail: "当前描述：已收 12,000 元，主张尾款 18,000 元。金额需与原始凭证逐项对应。", evidenceIds: ["E002"], ready: false, userEdited: false },
      { id: "M003", title: "补充交付与反馈往来", detail: "核对实际交付范围、版本及双方沟通，保留不一致的描述。", evidenceIds: ["E003"], ready: false, userEdited: false },
    ], reviewNotes: "",
  };
}
export function nextCaseId(prefix: string, items: { id: string }[]): string {
  return `${prefix}${String(Math.max(0, ...items.map((i) => Number(i.id.slice(1)))) + 1).padStart(3, "0")}`;
}
export const evidenceStatus = { missing: "待补充", collected: "已收集", checked: "已核对" };
export function caseProgress(data: LitigationData) {
  return {
    missing: data.evidence.filter((item) => item.status === "missing").length,
    unlinked: data.events.filter((item) => !item.evidenceIds.length).length,
    ready: data.checklist.filter((item) => item.ready).length,
  };
}
export function preparationMarkdown(data: LitigationData): string {
  const clean = (s: string) => s.replace(/\r/g, "");
  const lines = [
    `# ${clean(data.title)} · 材料准备稿`, "",
    data.source === "sample" ? "> 本文来自虚构示例，不对应真实案件；未附原始凭证。" : "> 本文为已录入事实与材料的整理稿，材料描述不等于原始文件。",
    "> 本应用不判断法律结论或材料的法律效力；此导出不代表向法院提交。", "",
    "## 案件概况", clean(data.summary) || "待补充", "", "## 整理目标", clean(data.objective) || "待补充", "",
    "## 当事人", ...data.parties.map((p) => `- **${p.name}**（${p.role}）\n  ${p.contact || "联系信息待补充"}`), "",
    "## 事实时间线", ...[...data.events].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999")).flatMap((event) => [
      `### ${event.date || "日期待确认"} · ${event.title}（${event.id}）`, event.detail || "说明待补充",
      `对应材料：${event.evidenceIds.length ? event.evidenceIds.map((id) => `${id} ${data.evidence.find((e) => e.id === id)?.title || ""}`).join("；") : "尚未关联材料"}`, "",
    ]),
    "## 材料目录", ...data.evidence.flatMap((e) => [`### ${e.id} · ${e.title}`, `状态：${evidenceStatus[e.status]} ｜ 类型：${e.kind}`, `来源 / 存放位置：${e.source || "待补充"}`, e.description || "内容说明待补充", ""]),
    "## 准备清单", ...data.checklist.map((item) => `- [${item.ready ? "x" : " "}] ${item.title}\n  ${item.detail}${item.evidenceIds.length ? `\n  关联：${item.evidenceIds.join("、")}` : ""}`), "",
    "## 待补与待核对", ...data.evidence.filter((e) => e.status === "missing").map((e) => `- ${e.id} ${e.title}：${e.description || "待补充"}`),
    ...data.events.filter((e) => !e.evidenceIds.length).map((e) => `- ${e.id} ${e.title}：尚未关联材料`), "",
    "## Orbit 整理意见", data.reviewNotes || "尚未生成整理意见。",
  ];
  return lines.join("\n");
}
