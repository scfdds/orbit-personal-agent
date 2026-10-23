import type { AssistantOverview, AssistantOverviewItem } from "../shared/assistant.ts";
import type { Conversation, Run, Snapshot } from "../shared/types.ts";

function excerpt(value: string, limit = 110): string {
  const plain = value
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ").trim();
  if (plain.length <= limit) return plain;
  // This is visibly an excerpt, never a newly asserted task outcome.
  return `${plain.slice(0, limit - 1).trimEnd()}…`;
}

function statusFor(conversation: Conversation, latest?: Run): string {
  if (!latest) return conversation.status;
  if (latest.status === "running" || latest.status === "queued") return "running";
  // Waiting/paused/input are explicit workflow states, not deductions from prose.
  if (["needs_input", "waiting", "paused"].includes(conversation.status) &&
      conversation.updatedAt >= (latest.finishedAt || latest.startedAt)) return conversation.status;
  if (latest.status === "failed") return "failed";
  if (latest.status === "interrupted" || latest.status === "cancelled") return "paused";
  // A prior failed run, even inserted later, cannot override a newer completed turn.
  return "completed";
}

function priority(item: AssistantOverviewItem): number {
  if (item.attentionReason) return 0;
  if (item.status === "running") return 1;
  if (item.unread) return 2;
  return 3;
}

function briefing(items: AssistantOverviewItem[]): NonNullable<AssistantOverview["briefing"]> {
  const real = items.filter(item => !item.example);
  if (!real.length) return {
    text: items.length
      ? `这里有 ${items.length} 个体验示例，可以打开查看对话和资料。`
      : "还没有独立事项。可以先在这里聊，有需要持续跟进的工作时再展开。",
    conversationIds: items.map(item => item.conversationId),
    ...(items.length ? { updatedAt: items.map(item => item.updatedAt).sort().at(-1)! } : {}),
  };
  const selected = real.slice(0, 2);
  const title = (item: AssistantOverviewItem) => `「${excerpt(item.title, 28)}」`;
  const lines = selected.map(item => {
    const source = item.progress || item.summary;
    const attributed = source && !/^(?:打开原对话|已保存资料)/.test(source)
      ? /^(?:最近回复|最新要求)[：:]/.test(source) ? excerpt(source, 76) : `记录摘要：${excerpt(source, 70)}` : "";
    const record = attributed ? `${attributed}${/[。！？…]$/.test(attributed) ? "" : "。"}` : "";
    if (item.status === "needs_input") return `${title(item)}正等你补充或确认。`;
    if (item.status === "failed") return `${title(item)}最近一次执行未成功，可以打开查看。`;
    if (item.attentionReason) return `${title(item)}上次执行中断，可以接着处理。`;
    if (item.status === "running") return `${title(item)}正在处理，进展会保留在原对话里。`;
    if (item.unread) return `${title(item)}有未读进展${record ? `，${record}` : "，可以先看一眼。"}`;
    if (item.status === "waiting") return `${title(item)}正在等待后续条件。`;
    if (item.status === "paused") return `${title(item)}已暂停，原有讨论仍保留。`;
    if (record) return `${title(item)}${record}`;
    return `${title(item)}的背景已保留，可以打开继续讨论。`;
  });
  return { text: lines.join(""), conversationIds: selected.map(item => item.conversationId),
    updatedAt: selected.map(item => item.updatedAt).sort().at(-1)! };
}

/** Read-only overview: no model call, timers, writes or interpretation of task success. */
export function buildAssistantOverview(state: Snapshot, mainId: string): AssistantOverview {
  const items = state.conversations.filter(c => c.id !== mainId && !c.archived && !c.draft).map(c => {
    const messages = state.messages.filter(m => m.conversationId === c.id && m.role !== "system")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    // Subagent failures belong to their parent execution and must not change the matter's status.
    const runs = state.runs.filter(r => r.conversationId === c.id && !r.parentId && !r.subagentId)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || (a.finishedAt || "").localeCompare(b.finishedAt || ""));
    const artifacts = state.artifacts.filter(a => a.conversationId === c.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const lastRun = runs.at(-1), lastMessage = messages.at(-1);
    const memory = state.memories?.find(m => m.conversationId === c.id);
    const freshMemory = memory && (!lastMessage || (memory.coveredMessageId
      ? memory.coveredMessageId === lastMessage.id : memory.updatedAt >= lastMessage.createdAt));
    const summary = (freshMemory ? memory.summary : "") || c.summary || lastMessage?.content || c.goal || "";
    const status = statusFor(c, lastRun);
    const attentionReason = status === "needs_input" ? "等待你补充或确认"
      : status === "failed" ? "最近一次执行未成功"
      : lastRun?.status === "interrupted" && status === "paused" ? "上次执行中断，可继续处理" : undefined;
    const recentResponse = [...messages].reverse().find(message => message.role === "assistant");
    let progress: string;
    if (status === "running") progress = "正在处理这次请求，已有讨论和资料仍可查看。";
    else if (status === "failed") progress = "最近一次执行未成功，原对话和已有资料已保留。";
    else if (lastRun?.status === "interrupted") progress = "上次执行中断，打开原对话可查看已经保留的内容。";
    else if (lastRun?.status === "cancelled") progress = "上次执行已停止，原有讨论仍保留。";
    else if (lastMessage?.role === "user") progress = `最新要求：${excerpt(lastMessage.content, 100)}`;
    else {
      // Authored memory carries useful next steps. Prefer the explicit next-step clause
      // only when this summary covers the latest exchange; otherwise show the source reply.
      const next = freshMemory && summary.match(/(?:下一步|待确认|待补充)\s*[：:]\s*([^\n]+)/)?.[0];
      progress = next ? excerpt(next) : recentResponse ? `最近回复：${excerpt(recentResponse.content, 100)}` : excerpt(summary);
      if (!progress) progress = artifacts.length ? `已保存资料：${excerpt(artifacts[0]!.title, 90)}` : "打开原对话，查看已有背景。";
    }
    const updatedAt = [c.updatedAt, lastMessage?.createdAt || "", lastRun?.finishedAt || lastRun?.startedAt || "", artifacts[0]?.updatedAt || ""].sort().at(-1)!;
    return { conversationId: c.id, title: c.title, project: c.project, summary: summary.slice(0, 500), progress,
      ...(attentionReason ? { attentionReason } : {}), status, updatedAt,
      ...(lastMessage ? { lastMessageId: lastMessage.id } : {}),
      ...(lastRun ? { lastRun: { id: lastRun.id, status: lastRun.status, summary: lastRun.summary } } : {}),
      artifacts: artifacts.slice(0, 4).map(({ id, title, updatedAt }) => ({ id, title, updatedAt })),
      unread: c.unread, example: Boolean(c.showcase),
    } satisfies AssistantOverviewItem;
  }).sort((a, b) => Number(a.example) - Number(b.example) || priority(a) - priority(b) ||
    b.updatedAt.localeCompare(a.updatedAt) || a.conversationId.localeCompare(b.conversationId)).slice(0, 8);
  return { items, briefing: briefing(items) };
}
