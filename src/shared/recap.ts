import type { Conversation, ConversationMemory, ConversationRecap, Message } from './types.ts';
import { conversationRounds, discussionNodes, sourceKey, type DiscussionNode } from './discussion.ts';

export function recapSource(id: string, messages: Message[], conversations: Conversation[]) {
  const rounds = conversationRounds(id, messages).filter(r => r.answers.length);
  const forks = conversations.filter(c => c.parentId === id).map(c => c.forkMessageId || '').sort();
  return { rounds, forks, key: `recap-v1:${sourceKey(rounds.flatMap(r => r.messages))}:${forks.join(',')}` };
}

export function recapNodes(conversation: Conversation, messages: Message[], memory: ConversationMemory | undefined, conversations: Conversation[], expanded: Set<string>): DiscussionNode[] {
  const source = recapSource(conversation.id, messages, conversations), recap = memory?.recap;
  const fallback = discussionNodes(conversation, messages, memory, conversations, new Set(source.rounds.map(r=>`round:${r.id}`)));
  if (!recap || recap.sourceKey !== source.key) return fallback;
  const result: DiscussionNode[] = recap.nodes.flatMap(n => {
    const rounds = n.roundIds.flatMap(id => source.rounds.filter(r => r.id === id));
    if (rounds.length !== n.roundIds.length) return [];
    if (expanded.has(n.id)) return fallback.filter(node => node.rounds.some(r => n.roundIds.includes(r.id))).map((node, i) => i === 0 ? {...node, collapseId:n.id} : node);
    return [{ id: n.id, conversationId: conversation.id, rounds, question: n.title, answer: n.summary, takeaway: n.takeaway, summarized: true, edited: false }];
  });
  return [...result, ...fallback.filter(n => n.rounds.every(r => !r.answers.length))];
}

/** Every distilled point maps to a contiguous, non-overlapping range in one original conversation. */
export function validateRecap(value: unknown, source: ReturnType<typeof recapSource>): ConversationRecap {
  const raw = (value as { nodes?: unknown })?.nodes;
  if (!Array.isArray(raw) || !raw.length) throw new Error('讨论整理缺少节点');
  let cursor = 0;
  const nodes = raw.map(n => {
    if (!Array.isArray(n?.roundIds) || !n.roundIds.length || typeof n.title !== 'string' || !n.title.trim() || n.title.length > 80 || typeof n.summary !== 'string' || !n.summary.trim() || n.summary.length > 600) throw new Error('讨论整理格式不正确');
    const rounds = source.rounds.slice(cursor, cursor + n.roundIds.length);
    if (rounds.length !== n.roundIds.length || rounds.some((r, i) => r.id !== n.roundIds[i])) throw new Error('讨论整理的来源不连续或不完整');
    // A branch must leave before subsequent conclusions in its parent conversation.
    if (rounds.slice(0, -1).some(r => r.messages.some(m => source.forks.includes(m.id)))) throw new Error('讨论整理跨过了原始分叉位置');
    cursor += rounds.length;
    if (n.takeaway !== undefined && (typeof n.takeaway !== 'string' || !n.takeaway.trim() || n.takeaway.length > 100)) throw new Error('节点结论格式不正确');
    return { id: `recap:${rounds[0]!.id}:${rounds.at(-1)!.id}`, roundIds: rounds.map(r => r.id), title: n.title.trim(), summary: n.summary.trim(), ...(n.takeaway ? {takeaway:n.takeaway.trim()} : {}) };
  });
  if (cursor !== source.rounds.length) throw new Error('讨论整理遗漏了原始问答');
  return { sourceKey: source.key, nodes };
}
