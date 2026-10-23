import { HttpError, type OrbitStore } from "./store.ts";
import type { ContextSource } from "../shared/types.ts";

type Selection = Pick<ContextSource, "conversationId" | "messageId" | "kind" | "reason">;
/** Selection follows a real read, never a catalog hit or an inferred keyword link. */
export function selectContextSources(store: OrbitStore, runId: string, selections: Selection[]) {
  const run = store.require("runs", runId);
  if (!["running", "queued"].includes(run.status)) throw new HttpError(409, "本轮已结束，不能修改使用的背景");
  if (!Array.isArray(selections) || !selections.length || selections.length > 6) throw new HttpError(400, "请选择 1–6 段相关背景");
  const evidence = store.metadata<{ conversations: string[]; messages: string[] }>(`delivery-evidence:${runId}`);
  const sources: ContextSource[] = selections.map(selection => {
    const conversation = store.require("conversations", selection.conversationId);
    const message = store.require("messages", selection.messageId);
    if (conversation.archived || message.conversationId !== conversation.id || message.role === "system") throw new HttpError(400, "来源原文不属于有效讨论");
    if (!evidence?.conversations.includes(conversation.id) || !evidence.messages.includes(message.id)) throw new HttpError(409, "先读取这段原文，再选择为本轮背景");
    if (!["project", "knowledge"].includes(selection.kind) || typeof selection.reason !== "string" || !selection.reason.trim() || selection.reason.length > 160) throw new HttpError(400, "请简短说明背景与本轮问题的关系");
    return { conversationId: conversation.id, messageId: message.id, title: conversation.title, project: conversation.matterTitle || conversation.project,
      kind: selection.kind, reason: selection.reason.trim(), excerpt: message.content.slice(0, 260) };
  });
  const merged = new Map((run.contextSources || []).map(source => [source.conversationId, source]));
  for (const source of sources) merged.set(source.conversationId, source);
  if (merged.size > 6) throw new HttpError(400, "本轮背景最多保留 6 段，请只选择直接相关的讨论");
  return store.put("runs", { ...run, contextSources: [...merged.values()] });
}
