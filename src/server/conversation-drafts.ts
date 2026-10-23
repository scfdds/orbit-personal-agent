import type { Snapshot } from "../shared/types.ts";

/** Keep app drafts addressable, but omit them from conversation history until used. */
export function markConversationDrafts(state: Snapshot) {
  const content = new Set<string>();
  for (const message of state.messages) {
    if (message.content.trim() || message.kind) content.add(message.conversationId);
    if (message.linkedConversationId) content.add(message.linkedConversationId);
  }
  for (const records of [state.works, state.runs, state.artifacts, state.triggers,
    state.subagents, state.subagentEvents, state.activities]) {
    for (const record of records) content.add(record.conversationId);
  }
  for (const object of state.objects) {
    // Unknown legacy objects are preserved; only explicitly seeded defaults are empty.
    if (!object.seed || object.version > 1) content.add(object.conversationId);
  }
  for (const memory of state.memories || []) {
    if (memory.summary.trim() || memory.items.some(item => !item.deleted && item.text.trim()) ||
      memory.discussion?.turns?.length) content.add(memory.conversationId);
  }
  for (const conversation of state.conversations) {
    if (conversation.parentId) content.add(conversation.parentId);
  }
  return state.conversations.map(conversation => ({
    ...conversation,
    draft: !content.has(conversation.id) && !conversation.parentId &&
      !conversation.inheritedContext?.trim() && !conversation.goal.trim() &&
      !conversation.summary.trim() && conversation.status === "idle" && !conversation.continuous,
  }));
}
