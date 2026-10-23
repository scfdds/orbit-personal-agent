import type { Conversation } from "./types.ts";

export interface MatterGroup {
  id: string;
  title: string;
  conversations: Conversation[];
  updatedAt: string;
  example: boolean;
}

// Legacy project names sometimes represent navigation buckets, not real matters.
const genericProjects = new Set([
  "", "未分区", "未分类", "默认", "日常随问", "之前的对话", "应用示例",
  "体验示例", "示例", "个人空间", "个人工作空间", "工作空间", "其他", "其它",
  "orbit", "default", "uncategorized", "general", "personal",
]);
const projectName = (value: string) => value.trim().replace(/\s+/g, " ");

/** A stable, read-only grouping over legacy projects and explicit matter IDs. */
export function buildMatterGroups(conversations: Conversation[], mainId: string): MatterGroup[] {
  const byId = new Map(conversations.map(conversation => [conversation.id, conversation]));
  const groups = new Map<string, MatterGroup>();

  function identity(conversation: Conversation): { id: string; title: string } {
    const lineage: Conversation[] = [];
    const seen = new Set<string>();
    let current: Conversation | undefined = conversation;
    while (current && current.id !== mainId && !seen.has(current.id)) {
      lineage.push(current);
      seen.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    // A malformed legacy cycle still gets one deterministic group.
    const root = current && seen.has(current.id)
      ? [...lineage].sort((a, b) => a.id.localeCompare(b.id))[0]!
      : lineage.at(-1)!;
    const explicit = lineage.find(item => item.matterId?.trim());
    if (explicit) return {
      id: explicit.matterId!,
      title: explicit.matterTitle?.trim() || root.title,
    };
    const project = projectName(root.project);
    return genericProjects.has(project.toLocaleLowerCase())
      ? { id: `thread:${root.id}`, title: root.title }
      : { id: `topic:${encodeURIComponent(project.toLocaleLowerCase())}`, title: project };
  }

  for (const conversation of conversations) {
    if (conversation.id === mainId || conversation.archived ||
        (conversation.draft && !conversation.matterId && !conversation.parentId)) continue;
    const key = identity(conversation);
    let group = groups.get(key.id);
    if (!group) {
      group = { ...key, conversations: [], updatedAt: conversation.updatedAt, example: true };
      groups.set(key.id, group);
    }
    group.conversations.push(conversation);
    if (conversation.updatedAt > group.updatedAt) group.updatedAt = conversation.updatedAt;
    group.example &&= Boolean(conversation.showcase);
  }
  for (const group of groups.values()) {
    group.conversations.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }
  return [...groups.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

export function findMatterGroup(groups: MatterGroup[], conversationId: string): MatterGroup | undefined {
  return groups.find(group => group.conversations.some(conversation => conversation.id === conversationId));
}
