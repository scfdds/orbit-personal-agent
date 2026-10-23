export interface ContractClause {
  id: string;
  text: string;
}
export interface ContractSuggestion {
  id: string;
  clauseId: string;
  original: string;
  proposed: string;
  reason: string;
  status: "pending" | "accepted" | "rejected";
  editedByUser?: boolean;
}
export interface ContractData {
  documentId: string;
  title: string;
  source: "empty" | "sample" | "upload" | "paste";
  requirements: string;
  clauses: ContractClause[];
  suggestions: ContractSuggestion[];
}
export const defaultRequirements =
  "我方为甲方。请核对：总价固定，不接受单方涨价；验收通过且收到发票后 30 日内付款；交付延迟超过 15 天可解除合同。只按这些商业约定检查原文，修改其他条款前先说明原因。";
export const sampleContract = `品牌设计服务合同（演示样本）

甲方：星野生活用品有限公司（虚构）
乙方：南山设计工作室（虚构）

第一条 服务范围
乙方向甲方提供一套品牌视觉规范、三张新品海报及对应的可编辑源文件。双方确认的设计需求附件为交付依据。

第二条 交付时间
乙方应于 2026 年 10 月 30 日前完成全部交付。甲方应在收到材料后 5 个工作日内提出书面意见。

第三条 服务费用
服务费用为人民币 30,000 元。乙方可因工作量或成本变化单方面调整费用，甲方应在收到通知后 3 日内补足差额。

第四条 付款安排
甲方应在乙方提交初稿后 90 日内支付全部费用。发票由乙方在收款后另行提供。

第五条 验收与修改
甲方有权提出两轮范围内的修改意见。全部成果经甲方书面确认后视为验收通过。

第六条 延迟交付
如乙方延迟交付，双方应另行协商新的交付时间，甲方不得因此解除合同。

第七条 保密
双方对履约过程中获得的未公开商业信息承担保密义务。

第八条 生效
本合同经双方签署后生效。甲方签署：________ 乙方签署：________`;

export function emptyContract(): ContractData {
  return {
    documentId: "",
    title: "",
    source: "empty",
    requirements: "",
    clauses: [],
    suggestions: [],
  };
}

export function importContract(
  text: string,
  title: string,
  source: Exclude<ContractData["source"], "empty">,
): ContractData {
  const cleaned = text
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .trim();
  if (!cleaned) throw new Error("没有识别到合同正文，请导入含文字的文档。");
  if (cleaned.length > 50000) throw new Error("首版支持 5 万字以内的合同。");
  // Keep paragraph order and contents; IDs refer to stable source paragraphs.
  const paragraphs = cleaned
    .split(/\n[\t ]*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length > 400) throw new Error("合同段落过多，请拆分后导入。");
  return {
    documentId: crypto.randomUUID(),
    title: title.slice(0, 160),
    source,
    requirements: source === "sample" ? defaultRequirements : "",
    clauses: paragraphs.map((text, i) => ({
      id: `C${String(i + 1).padStart(3, "0")}`,
      text,
    })),
    suggestions: [],
  };
}

export function revisedClauses(data: ContractData): ContractClause[] {
  return data.clauses.map((clause) => {
    const accepted = data.suggestions.find(
      (s) => s.clauseId === clause.id && s.status === "accepted",
    );
    return { ...clause, text: accepted?.proposed ?? clause.text };
  });
}

export function changeLog(data: ContractData): string {
  const labels = {
    pending: "待确认（保留原文）",
    accepted: "已采用",
    rejected: "已忽略（保留原文）",
  };
  return (
    `# ${data.title} · 变更清单\n\n审阅要求：${data.requirements || "未填写"}\n\n` +
    data.suggestions
      .map(
        (s) =>
          `## ${s.clauseId} · ${labels[s.status]}${s.editedByUser ? " · 用户编辑" : ""}\n\n原文：\n${s.original}\n\n建议稿：\n${s.proposed}\n\n修改理由：${s.reason}\n`,
      )
      .join("\n") +
    "\n修订稿仅合并已采用的修改，其余段落保留原文。\n"
  );
}

export async function contractDocx(data: ContractData): Promise<Blob> {
  const { Document, Paragraph, TextRun, Packer } = await import("docx");
  return Packer.toBlob(
    new Document({
      sections: [
        {
          children: revisedClauses(data).flatMap((clause) =>
            clause.text.split("\n").map(
              (line) =>
                new Paragraph({
                  children: [
                    new TextRun({ text: line, font: "宋体", size: 24 }),
                  ],
                  spacing: { after: 160 },
                }),
            ),
          ),
        },
      ],
    }),
  );
}
