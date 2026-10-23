/** Stable destinations shared by the guide and the curated submission fixtures. */
export const demoCases = [
  { id: "contracts", conversationId: "conversation-0d430304-ded", title: "合同审阅", subtitle: "提出建议，保留你的决定", description: "查看三条修改建议，以及接受、拒绝、手动编辑后，Agent 如何再次读取合同。", action: "查看合同示例" },
  { id: "litigation", conversationId: "conversation-e0c55d20-5aa", title: "诉讼材料", subtitle: "把事实与证据对应起来", description: "查看事件、证据和待补材料；人工写下的核对说明在后续整理中保留。", action: "查看法律示例" },
  { id: "portfolio", conversationId: "conversation-cd258c3d-360", title: "持仓追踪", subtitle: "记录依据，逐项核对", description: "查看自选资产和观察清单，区分已核对与待验证事项。资产及价格为虚构样本。", action: "查看投资示例" },
  { id: "career", conversationId: "conversation-4b6e3e4c-379", title: "求职准备", subtitle: "围绕岗位准备面试", description: "查看示例简历、岗位和面试问题；Agent 追加问题时保留个人笔记和完成状态。", action: "查看求职示例" },
] as const;
export const subagentExampleId = "conversation-ee13d8ec-c5c";
