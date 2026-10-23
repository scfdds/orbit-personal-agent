import type { Conversation } from "./types.ts";
export function rootOf(id: string, conversations: Conversation[]): string {
  const seen = new Set<string>();
  let current = conversations.find((c) => c.id === id);
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = conversations.find((c) => c.id === current!.parentId);
    if (!parent) break;
    current = parent;
  }
  return current?.id || id;
}
export function conversationTree(conversations: Conversation[]) {
  const ids = new Set(conversations.map((c) => c.id));
  return {
    roots: conversations.filter((c) => !c.parentId || !ids.has(c.parentId)),
    children: (id: string) =>
      conversations
        .filter((c) => c.parentId === id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  };
}
