import type { Conversation, ConversationMemory, Message } from "../../shared/types.ts";
import type { OrbitStore } from "../store.ts";

const notice = "知识与项目概念演示，内容为预设案例，不代表用户实际经历或真实项目执行结果。";
const definitions: Array<[string,string,string,string,Array<[string,string]>]> = [
 ["xr-progress","XR 助手","多窗口原型与下一步","多窗口原型已完成。下一步先检查渲染耗时，尚未进行设备性能测量。",[
  ["我想在头显里做一个 AI 助手，先从多个窗口开始。","先保持主对话可用，资料和工具按需展开。第一版采用简单窗口布局，暂不加入复杂的空间动画。"],
  ["多窗口原型已经能打开了，但我怕内容多了会卡。","当前停在多窗口原型：可以打开和排列窗口。还没有设备上的性能测量，不能先判断是 GPU、CPU 或内存瓶颈。下一步记录窗口数量、内容类型与每帧耗时。"]]],
 ["xr-voice","XR 助手","语音与窗口联动","确定短语音配合视觉交付，等待联调。",[["不要把回答整段念出来。","语音只介绍重点，详细内容留在窗口。用户说话时可以打断播报，打开资料后再讲解它的位置和内容。"]]],
 ["gpu-bandwidth","硬件学习","GPU 为什么会等数据","讨论了算力与数据供给的关系；尚未对应到具体设备性能。",[
  ["显卡算力很强，为什么有时还是跑不快？","算力描述计算能力，实际速度还取决于数据能否及时到达。运算单元可能在等待数据，而不是持续满负荷计算。"],
  ["能用一个简单的例子说清楚带宽的影响吗？","可以把运算单元想成厨房，带宽像把食材送进来的通道。计算很快，供给跟不上，厨房仍要等待。但具体瓶颈必须测量：数据复用、访问方式和工作负载都会改变结果。"],
  ["所以性能只是看带宽吗？","也不是。一个简化上界是 min（峰值算力，带宽 × 算术强度）。这是帮助区分计算受限与带宽受限的模型，不能替代真实应用的 profiling。"]]],
 ["memory-latency","硬件学习","带宽、延迟与容量","容量、带宽和延迟是不同约束，不能互相代替。",[
  ["内存大、带宽高、延迟低，是一回事吗？","容量决定能放多少，带宽决定单位时间能搬多少，延迟描述一次访问要等多久。容量足够，不代表访问就快。"],
  ["比如实时应用，应该优先关注哪个？","需要结合访问模式分析。连续传大量数据更关心吞吐，依赖链上的零散访问可能对延迟敏感。先测量真实负载，再决定优化方向。"]]],
 ["gpu-render","硬件学习","一帧画面是怎样生成的","已经梳理 CPU 提交、GPU 渲染与显示之间的关系。",[["点击窗口到看到画面，中间发生了什么？","应用更新状态并提交绘制工作，GPU 执行图形流水线，结果再由显示系统呈现。交互延迟包含多个阶段，帧率只是其中一个观察维度。"]]],
 ["finance-roic","金融学习","ROE 与 ROIC 的区别","讨论了股东回报与经营资本效率的区别。",[["ROE 和 ROIC 分别在看什么？","ROE 关注归属于股东的收益与权益；ROIC 关注经营利润与投入资本。口径和用途不同，讨论中先明确分子分母，不只比较数值高低。"]]],
 ["finance-rates","金融学习","利率如何影响估值","讨论了贴现率与增长预期，保留了适用前提。",[["为什么利率变化经常影响估值？","在其他假设不变时，贴现率变化会影响未来现金流的现值。现实中增长、风险预期也会一起变化，不能只看利率作结论。"]]],
 ["finance-cash","金融学习","利润与现金流","已区分利润确认与现金收付的时间差异。",[["赚钱的公司也可能缺现金吗？","利润确认与实际收款存在时间差，还可能有库存、资本开支等占用。理解具体企业需要同时看利润、资产负债和现金流。"]]],
 ["eng-concurrency","软件工程","并发与并行","讨论了任务交错推进与同时执行的差别。",[["并发就是开多线程吗？","并发是组织多个任务交错推进；并行强调同时执行。线程是实现手段之一，单线程事件循环也能处理并发。"]]],
 ["eng-cache","软件工程","缓存失效与一致性","比较了过期策略与主动失效，尚未绑定具体业务。",[["缓存应该多久刷新？","先明确可以接受的数据陈旧程度，再选择过期或主动失效。不同数据的更新频率和正确性要求不同，不能统一给出一个时间。"]]],
 ["orbit-route","Orbit 开发","主对话与背景组织","主对话承接输入，具体事项保存讨论，计划补齐背景来源的呈现。",[["用户不想每次先找对话。","主对话作为统一入口。按本轮语义选择相关背景，回答留在用户提问的位置；归属和来源以轻量卡片呈现。"]]],
 ["orbit-audio","Orbit 开发","语音响应节奏","短讲解与内容展开需要同步，下一步处理等待反馈。",[["说完之后等太久怎么办？","先呈现可靠的接收状态，工作有结果再简短说明。不能为了快速回应而声称已经完成尚未发生的操作。"]]],
 ["ledger-import","记账 App","账单导入去重","CSV 导入已完成，重复导入的去重规则待检查。",[["CSV 导入通了，但是同一份账单导入两次就重复。","下一步先核对账单标识和现有去重键，再用同一份账单复现。当前没有确认原因，也没有修复记录。"]]],
 ["ledger-ui","记账 App","月度收支概览","已确定按月份和分类展示收支。",[["首页先看每个月花在哪里。","按月份展示收支总览，再展开分类。异常和退款需要明确区分，暂时不做复杂预测。"]]],
 ["site-projects","个人网站","作品展示与发布","首页完成，待补齐作品介绍。",[["网站首页做好了，作品区还没写。","作品区先展示 Orbit、XR 助手与记账 App。每项说明用途、当前状态和可演示的交互，完成文案后再发布。"]]],
];
export function contextDemoData() {
 const conversations: Conversation[] = [], messages: Message[] = [], memories: ConversationMemory[] = [];
 definitions.forEach(([key,group,title,summary,rounds],index) => {
  const id = `context-demo-${key}`, date = new Date(Date.UTC(2026,9,11-index,10)).toISOString();
  conversations.push({id,title,project:group,matterId:`context-demo-group-${group}`,matterTitle:group,summary,goal:"",status:"idle",pinned:false,archived:false,continuous:false,unread:false,createdAt:date,updatedAt:date,panel:null,showcase:{title:"示例",period:"概念演示",notice}});
  rounds.forEach(([q,a],i)=>messages.push({id:`${id}-q-${i}`,conversationId:id,role:"user",content:q,createdAt:date},{id:`${id}-a-${i}`,conversationId:id,role:"assistant",content:a,createdAt:date}));
  memories.push({id,conversationId:id,version:1,status:"ready",summary,coveredMessageId:`${id}-a-${rounds.length-1}`,updatedAt:date,items:rounds.map(([,text],i)=>({id:`${id}-memory-${i}`,kind:"fact",text,sourceIds:[`${id}-a-${i}`]}))});
 });
 return {conversations,messages,memories};
}
export function seedContextDemo(store: OrbitStore) {
 const marker="showcase:context-demo:v1", data=contextDemoData();
 if(store.metadata(marker))return {created:[],skipped:data.conversations.map(c=>c.id)};
 return store.transaction(()=>{
  const created:string[]=[],skipped:string[]=[];
  for(const c of data.conversations){
   if(store.get("conversations",c.id)){skipped.push(c.id);continue;}
   const messages=data.messages.filter(m=>m.conversationId===c.id),memory=data.memories.find(m=>m.id===c.id)!;
   if(messages.some(m=>store.get("messages",m.id))||store.get("memories",c.id))throw new Error("演示记录冲突，未覆盖现有内容");
   store.put("conversations",c);for(const m of messages)store.put("messages",m);store.put("memories",memory);created.push(c.id);
  }
  store.setMetadata(marker,true);return {created,skipped};
 });
}
