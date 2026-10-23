import type { Conversation, ConversationMemory, Message } from "../../shared/types.ts";
import type { OrbitStore } from "../store.ts";

/** One familiar product, three independent topics. No fictional execution receipts. */
export function ledgerDemoData() {
 const definitions: Array<[string,string,string,Array<[string,string]>]> = [
  ["categories","记账分类","已讨论 8 个支出分类，下一步简化选择。",[
   ["我想做个自己用的记账 App，先只记支出，不做预算和账户管理。","第一版先把记一笔支出做好：输入金额、选择分类、保存。预算和账户管理留到后面。"],
   ["支出先分餐饮、交通、日用、服饰、娱乐、医疗、住房和其他。","先保留这 8 类。分类太细会增加每次记账的操作，之后可以根据使用情况合并。"]]],
  ["home","首页布局","首页先展示本月支出，记一笔的入口保持明显。",[
   ["首页想看这个月花了多少，也要方便记下一笔。","本月支出放在上方，下方是最近记录。保留一个明显的“记一笔”按钮，第一版先不放复杂图表。"]]],
  ["save","重复保存","连续点两次保存会重复记账，待修复。",[
   ["现在可以记账和看月度统计了，但连续点两次保存会多出一笔。","先检查保存中的状态，避免重复提交；还要确认服务端能否识别同一次请求。目前只记录了问题，没有修复和验证结果。"]]],
 ];
 const conversations:Conversation[]=[],messages:Message[]=[],memories:ConversationMemory[]=[];
 definitions.forEach(([key,title,summary,rounds],i)=>{
  const id=`ledger-demo-${key}`,date=new Date(Date.UTC(2026,9,10,8+i)).toISOString();
  conversations.push({id,title,project:"记账 App",matterId:"ledger-demo-app",matterTitle:"记账 App",summary,goal:"",status:"idle",pinned:false,archived:false,continuous:false,unread:false,createdAt:date,updatedAt:date,panel:null,showcase:{title:"示例",period:"记账 App",notice:"预设产品案例，不代表用户的真实项目或实际代码执行结果。"}});
  rounds.forEach(([q,a],n)=>messages.push({id:`${id}-q-${n}`,conversationId:id,role:"user",content:q,createdAt:date},{id:`${id}-a-${n}`,conversationId:id,role:"assistant",content:a,createdAt:date}));
  memories.push({id,conversationId:id,version:1,status:"ready",summary,coveredMessageId:`${id}-a-${rounds.length-1}`,updatedAt:date,items:rounds.map(([,text],n)=>({id:`${id}-memory-${n}`,kind:"fact",text,sourceIds:[`${id}-a-${n}`]}))});
 });return {conversations,messages,memories};
}
export function seedLedgerDemo(store:OrbitStore){
 const data=ledgerDemoData(),marker="showcase:ledger-demo:v1";
 if(store.metadata(marker))return {created:[],skipped:data.conversations.map(c=>c.id)};
 return store.transaction(()=>{const created:string[]=[],skipped:string[]=[];
  for(const c of data.conversations){if(store.get("conversations",c.id)){skipped.push(c.id);continue;}
   const messages=data.messages.filter(m=>m.conversationId===c.id),memory=data.memories.find(m=>m.id===c.id)!;
   if(store.get("memories",c.id)||messages.some(m=>store.get("messages",m.id)))throw new Error("示例记录冲突，未修改已有内容");
   store.put("conversations",c);for(const m of messages)store.put("messages",m);store.put("memories",memory);created.push(c.id);
  }store.setMetadata(marker,true);return {created,skipped};
 });
}
