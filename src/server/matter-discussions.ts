import { buildMatterGroups, findMatterGroup } from "../shared/matter-groups.ts";
import type { Conversation } from "../shared/types.ts";
import { HttpError } from "./store.ts";
import type { OrbitRuntime } from "./runtime.ts";

/** Open a blank sibling discussion with bounded background, without dispatching work. */
export function createMatterDiscussion(runtime: OrbitRuntime, sourceId: string, title: string): Conversation {
  if (typeof title !== "string" || !title.trim() || title.length > 160 || /[\u0000-\u001f]/.test(title))
    throw new HttpError(400, "讨论标题不能为空且不能超过 160 个字符");
  const source = runtime.store.require("conversations", sourceId);
  if (runtime.assistant.isMain(sourceId)) throw new HttpError(400, "请在具体事项中开启讨论");
  if (source.archived) throw new HttpError(409, "请先恢复该事项，再开启讨论");
  const mainId = runtime.assistant.getState().conversationId;
  const group = findMatterGroup(buildMatterGroups(runtime.store.list("conversations"), mainId), sourceId);
  if (!group) throw new HttpError(404, "找不到对应事项");
  const goalSource = source.goal.trim() ? source : group.conversations.find(item => item.goal.trim());
  const summarySource = source.summary.trim() ? source : group.conversations.find(item => item.summary.trim());
  const backgroundIds = new Set([sourceId, goalSource?.id, summarySource?.id].filter((value): value is string => Boolean(value)));
  const sourceIds = runtime.store.list("messages")
    .filter(message => backgroundIds.has(message.conversationId) && !message.kind)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-24).map(message => message.id);
  const summary = [
    `所属事项：${group.title}`,
    goalSource ? `已有目标：${goalSource.goal.trim().slice(0, 1600)}` : "",
    summarySource ? `相关讨论摘要：${summarySource.summary.trim().slice(0, 2400)}` : "",
  ].filter(Boolean).join("\n");
  const created = runtime.store.transaction(() => {
    // Freeze the membership only when the user explicitly adds a discussion.
    // Preserve progress dates, titles, and all messages while assigning identity.
    for (const member of group.conversations) runtime.store.put("conversations", {
      ...member, matterId: group.id, matterTitle: group.title,
    });
    return runtime.store.createConversation(title.trim(), {
      project: source.project,
      matterId: group.id,
      matterTitle: group.title,
      inheritedContext: JSON.stringify({ summary, items: [], sourceConversationId: sourceId, sourceConversationIds: [...backgroundIds] }),
      inheritedSources: sourceIds,
      ...(source.showcase ? { showcase: { ...source.showcase } } : {}),
    });
  });
  runtime.changed();
  return created;
}
