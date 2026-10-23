import type { Conversation, ConversationMemory, Message, TurnSummary } from './types.ts';

export interface DiscussionRound {
  id: string;
  conversationId: string;
  ordinal: number;
  questions: Message[];
  answers: Message[];
  messages: Message[];
  sourceKey: string;
}
export interface DiscussionNode {
  takeaway?: string;
  collapseId?: string;
  id: string;
  conversationId: string;
  rounds: DiscussionRound[];
  question: string;
  answer: string;
  summarized: boolean;
  edited: boolean;
}
export function sourceKey(messages: Message[]) {
  let hash=2166136261;
  for(const ch of JSON.stringify(messages.map(m=>[m.id,m.role,m.content]))) hash=Math.imul(hash^ch.charCodeAt(0),16777619);
  return (hash>>>0).toString(36);
}
export function conversationRounds(conversationId: string, messages: Message[]): DiscussionRound[] {
  const rounds: DiscussionRound[]=[];
  for(const message of messages) {
    if(message.conversationId!==conversationId||message.kind||message.role==='system')continue;
    let round=rounds.at(-1);
    if(message.role==='user') {
      if(!round||round.answers.length) {
        round={id:message.id,conversationId,ordinal:rounds.length+1,questions:[],answers:[],messages:[],sourceKey:''};
        rounds.push(round);
      }
      round.questions.push(message);
    } else {
      // Proactive replies without a preceding question remain independently readable.
      if(!round) {round={id:message.id,conversationId,ordinal:1,questions:[],answers:[],messages:[],sourceKey:''};rounds.push(round);}
      round.answers.push(message);
    }
    round!.messages.push(message);
  }
  for(const round of rounds) round.sourceKey=sourceKey(round.messages);
  return rounds;
}
export function plainExcerpt(text: string) {
  return text.replace(/```[\s\S]*?```/g,' [代码] ').replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/(^|\n)\s{0,3}#{1,6}\s+/g,'$1').replace(/[*_`]/g,'').replace(/\s+/g,' ').trim();
}
export function validTurn(round: DiscussionRound, turns: TurnSummary[] = []) {
  return turns.find(t=>t.id===round.id&&(t.sourceKey===round.sourceKey||t.edited));
}
export function discussionNodes(conversation: Conversation, messages: Message[], memory: ConversationMemory|undefined, conversations: Conversation[], expanded: Set<string>): DiscussionNode[] {
  const rounds=conversationRounds(conversation.id,messages);
  const anchors=new Set(conversations.filter(c=>c.parentId===conversation.id).map(c=>c.forkMessageId));
  const nodes: DiscussionNode[]=[];
  for(const round of rounds) {
    const summary=validTurn(round,memory?.discussion?.turns);
    const previous=nodes.at(-1);
    const protectedRound=(r:DiscussionRound)=>expanded.has(`round:${r.id}`)||r.messages.some(m=>anchors.has(m.id))||[...expanded].some(id=>id.startsWith(`group:${r.id}:`)||id.endsWith(`:${r.id}`));
    const previousSummary=previous&&validTurn(previous.rounds[0]!,memory?.discussion?.turns);
    const groupId=previous?`group:${previous.rounds[0]!.id}:${round.id}`:'';
    if(summary?.merge&&previous?.rounds.length===1&&previousSummary&&!previousSummary.edited&&!summary.edited&&!protectedRound(round)&&!protectedRound(previous.rounds[0]!)&&!expanded.has(groupId)) {
      nodes[nodes.length-1]={id:groupId,conversationId:conversation.id,rounds:[previous.rounds[0]!,round],question:summary.merge.question,answer:summary.merge.answer,summarized:true,edited:false};
    } else nodes.push({id:round.id,conversationId:conversation.id,rounds:[round],question:summary?.question||plainExcerpt(round.questions.map(m=>m.content).join('\n'))||'Orbit 的更新',answer:summary?.answer||plainExcerpt(round.answers.map(m=>m.content).join('\n'))||(conversation.status==='running'?'正在回答…':'尚未回答'),summarized:!!summary,edited:!!summary?.edited});
  }
  return nodes;
}
