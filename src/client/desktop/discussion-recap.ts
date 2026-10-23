import type { Conversation, Snapshot } from "../../shared/types.ts";
import { plainSummary } from "./workspace-state.ts";

export interface DiscussionRecap { text: string; sourceKey: string; sourceMessageId?: string }
/** A compact view of existing evidence; opening a discussion never starts a model run. */
export function discussionRecap(state: Snapshot, conversation: Conversation): DiscussionRecap {
  const messages=state.messages.filter(item=>item.conversationId===conversation.id&&item.role!=="system"&&item.kind!=="conversation_link");
  const question=messages.findLast(item=>item.role==="user"), answer=messages.findLast(item=>item.role==="assistant");
  const summary=plainSummary(conversation.summary||"",150).replace(/^(最近回复|最新要求)[：:]\s*/,"");
  let text=summary;
  if(!text&&question)text=`上次的问题是：${plainSummary(question.content,95)}`;
  if(!text&&answer)text=plainSummary(answer.content,150);
  if(!text)text=conversation.inheritedContext?"这是这件事下的新讨论，相关背景已保留。可以直接从想深入的问题开始。":"这段讨论还没有内容，可以从一个具体问题开始。";
  return {text,sourceKey:`${question?.id||""}:${answer?.id||""}:${summary}`,sourceMessageId:question?.id||answer?.id};
}
const key=(id:string)=>`orbit.desktop.recap.v1.${id}`;
export function shouldIntroduceDiscussion(id:string,sourceKey:string,now=Date.now()):boolean {
  try { const seen=JSON.parse(sessionStorage.getItem(key(id))||"null");return !seen||now-seen.at>30*60_000||seen.sourceKey!==sourceKey; } catch{return true;}
}
export function markDiscussionIntroduced(id:string,sourceKey:string){try{sessionStorage.setItem(key(id),JSON.stringify({at:Date.now(),sourceKey}));}catch{}}
