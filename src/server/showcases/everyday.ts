import type { OrbitStore } from '../store.ts';
import { SectionService } from '../sections.ts';
import type { Conversation } from '../../shared/types.ts';
import { everydaySummaries } from './reader-summaries.ts';

const marker='showcase:everyday:v1';
/** Authored sample conversations. No external actions, invented headlines or live market data. */
export function seedEverydayShowcase(store:OrbitStore) {
  if(store.metadata(marker)) return false;
  if (store.list('conversations').some(c => c.id.startsWith('daily-'))) throw new Error('日常示例 ID 已存在，未覆盖已有对话');
  const sections=new SectionService(store);
  store.transaction(()=>{
    // Keep previous conversations and all their artifacts; reduce sidebar clutter without deleting history.
    for(const c of store.list('conversations')) store.updateConversation(c.id,{project:'之前的对话',pinned:false});
    const names=['AI 动态','学习与研究','投资观察','国庆旅行','日常随问','之前的对话'];
    names.forEach((name,order)=>{const s=sections.ensure(name);store.put('sections',{...s,order,pinned:order<2});});
    for(const s of store.list('sections')) if(!names.includes(s.name)) store.db.prepare('DELETE FROM sections WHERE id=?').run(s.id);
    let sequence=0;
    function chat(key:string,title:string,project:string,turns:[string,string][],notes:string[],parent?:Conversation) {
      const id=`daily-${key}`;
      const date=new Date(Date.UTC(2026,8,24,2,sequence*9)).toISOString();
      const parentMemory=parent ? store.require('memories',parent.id) : undefined;
      const parentSources=parentMemory?.items.flatMap(item=>item.sourceIds) ?? [];
      const c=store.createConversation(title,{id,project,order:sequence++,pinned:false,status:'idle',createdAt:date,updatedAt:date,panel:{kind:'app',appId:'memory'},showcase:{title:'日常使用示例',period:'',notice:'预置的示例对话，用于展示日常使用方式；没有真实新闻抓取、行情接入或已预订行程。继续提问会调用真实模型。'},...(parent?{parentId:parent.id,forkMessageId:parentMemory!.coveredMessageId,inheritedContext:JSON.stringify({summary:parentMemory!.summary,items:[]}),inheritedSources:[...new Set(parentSources)]}:{})});
      turns.forEach(([user,assistant],i)=>{for(const [role,content,suffix] of [['user',user,'u'],['assistant',assistant,'a']] as const) store.put('messages',{id:`${id}-${suffix}${i+1}`,conversationId:id,role,content,createdAt:new Date(Date.parse(date)+i*180000+(role==='assistant'?45000:0)).toISOString()});});
      const summary=everydaySummaries[id] || notes.slice(0,2).join('；');
      store.put('memories',{id,conversationId:id,version:1,status:'ready',summary,items:notes.map((text,i)=>({id:`${id}-note-${i}`,kind:'fact' as const,text,sourceIds:[`${id}-u${Math.min(i+1,turns.length)}`,`${id}-a${Math.min(i+1,turns.length)}`]})),coveredMessageId:`${id}-a${turns.length}`,updatedAt:date});
      store.updateConversation(id,{summary,unread:false});
      return c;
    }
    const ai=chat('ai-radar','每天十分钟，跟上 AI 进展','AI 动态',[
      ['我想每天花十分钟了解 AI 行业。只关心模型发布、Agent 产品和开发者工具，别把融资传闻和重复转载塞进来。','可以把每日简报控制在三条。每条保留：发生了什么、原始发布链接、为什么值得关注，以及是否需要你亲自试用。\n\n先建立关注范围；接入可靠来源后再开始定时抓取。当前这份示例没有实时新闻数据。'],
      ['优先看官方博客、发布说明和 GitHub。相同发布合并成一条，没有重要变化就不用提醒。','记录好了：优先一手来源，合并同一事件，没有重要变化就保持安静。模型基准分数和实际产品体验分开记录，避免只看排行榜。\n\n我们还可以把“值得体验的产品”单独展开，和每日简报分开讨论。']
    ],['关注模型发布、Agent 产品与开发者工具，简报控制在三条。','优先官方博客、发布说明与 GitHub；合并重复事件，无重要变化不提醒。']);
    const agent=chat('agent-products','哪些 Agent 产品值得亲自试用','AI 动态',[
      ['从新闻跟踪里单独开一段，比较 Agent 产品。别只做功能表，我更想知道什么能力能在真实任务里用起来。','可以用同一组任务体验：整理一批资料、接着上次工作继续、执行中修改要求，以及检查产物能否手动编辑。\n\n每次记录任务输入、实际结果、人工接管的地方和复现步骤。先确定比较方法，下一步再选具体产品和版本。'],
      ['重点看上下文延续、GUI 和 Agent 是否共用状态，还有长时间执行后能不能恢复。','这三个维度作为固定观察项。我们也会记录测试日期和产品版本，避免把旧体验当成当前能力。暂时不预填任何产品评分。']
    ],['用相同真实任务比较 Agent 产品，保留输入、结果与复现步骤。','重点观察上下文延续、GUI 与 Agent 共用状态、长时间执行恢复。'],ai);
    chat('semi','从零理解半导体产业链','学习与研究',[
      ['我想系统学习半导体产业，但不想一下子被术语淹没。先帮我建立芯片设计、制造、封装和设备材料之间的关系。','我们可以沿着一颗芯片的生产过程学习：先决定它要做什么，再把设计变成晶圆上的电路，最后封装并测试。设备与材料为这些环节提供生产条件。\n\n先画产业链，再挑一个环节深入。每次留下你已经理解的概念，以及还想追问的问题。'],
      ['下一步想看 AI 服务器里，GPU、HBM 和先进封装为什么经常一起出现。','可以围绕一个问题展开：计算单元怎样持续拿到数据？先认识计算、存储和互连的分工，再阅读厂商技术资料。\n\n这段先建立产业地图；具体供应约束和公司经营情况，放在独立讨论里核对资料。']
    ],['按芯片设计、制造、封装测试、设备材料建立半导体产业地图。','下一步学习 AI 服务器中 GPU、HBM 和先进封装的关系。']);
    const macro=chat('macro','宏观经济：先把几条主线串起来','学习与研究',[
      ['我也想学习宏观经济和金融知识。经常看到通胀、利率、就业、汇率这些词，但不知道怎么联系起来。','先从“谁在支出、资金从哪里来、价格怎样变化”这几个问题建立框架，再把通胀、就业和利率放进去。\n\n学习时把概念解释和对市场的预测分开。每周挑一份公开数据，先读口径与时间范围，再讨论可能的解释。'],
      ['别直接给我预测，先用简单例子讲清楚。下一次从利率开始。','记住了：先解释概念，再看资料，不把单一指标机械地解释成市场涨跌。下一次从名义利率、实际利率，以及借贷成本的变化开始。']
    ],['学习宏观经济时先解释概念，再读数据口径；暂不进行市场预测。','下一次从名义利率、实际利率与借贷成本开始。']);
    chat('rates','利率变化怎样传到企业和家庭','学习与研究',[
      ['从宏观学习里分出来：利率下降为什么不一定马上带来更多消费和投资？','我们可以分别看家庭和企业：已有债务是否重定价，收入预期是否稳定，有没有愿意购买的东西或值得投入的项目。\n\n先用这些问题比较不同情境，再结合具体时期的数据判断。需要避免把“融资更便宜”直接等同于“大家立刻增加支出”。']
    ],['通过家庭与企业两个视角理解利率传导，关注债务重定价、预期与需求。'],macro);
    const portfolio=chat('portfolio','我的持仓，先搭一个跟踪框架','投资观察',[
      ['想让你持续帮我跟踪持仓。先用美光和标普 500 ETF 做示例，实际数量、成本和交易记录我后面再补。','先建立观察框架：持仓信息、当初买入的理由、需要持续核对的事实，以及下一次回顾时间。\n\n当前只使用示例观察对象，不计算真实收益，不展示实时价格。你补充实际持仓后，再关联对应记录。'],
      ['不要每天盯着涨跌给我建议。重要财报、业务变化或者原来的判断有问题时再告诉我。','跟踪重点放在理由是否仍然成立。每次更新区分新事实、对原判断的影响、还缺什么证据；保留原始来源。\n\n自动跟踪尚未开启，需要先接入资料来源和你的实际持仓信息。']
    ],['美光与标普 500 ETF 仅为示例观察对象；实际数量、成本尚未录入。','重点跟踪财报、业务变化与原判断的变化，不因每日涨跌反复提醒。']);
    chat('portfolio-review','本周复盘：哪些判断需要重新检查','投资观察',[
      ['持仓复盘能不能固定一张表？我想区分原来怎么想的、现在出现了什么变化。','每次用四栏：原判断、新证据、影响、下一步核对。没有新证据时保留空白，不为了输出报告编造变化。\n\n下一次可以把实际财报或公告放进来，我们逐条比较。']
    ],['复盘保留原判断、新证据、影响和下一步核对；没有证据时不编造变化。'],portfolio);
    const travel=chat('holiday','国庆旅行：云南还是柬埔寨','国庆旅行',[
      ['国庆想出去一趟，在云南和柬埔寨之间犹豫。大概七天，想轻松一点，不要每天换酒店。','先保留两条候选路线，用相同维度比较：出发地与交通时间、移动次数、住宿预算和你最想体验的内容。\n\n目前先整理偏好，不填未经核实的机票、酒店价格或入境要求。你确定出发城市后，再查实际可选日期。'],
      ['云南想看看大理和沙溪，柬埔寨主要想去暹粒看吴哥。分别开一段聊，最后再决定。','可以，两个方向分别保留讨论。共同偏好是七天左右、减少移动、留出休息时间；每个方向形成一份草案，再放在一起比较。']
    ],['国庆计划约七天，偏好慢节奏、少换酒店；云南与柬埔寨仍是候选。','云南方向关注大理与沙溪，柬埔寨方向关注暹粒与吴哥，尚未预订。']);
    chat('yunnan','云南七天，留时间给大理和沙溪','国庆旅行',[
      ['云南这边先围绕大理和沙溪想想，最多住两个地方。我不想每天一大早赶景点。','草案先只设两个住宿据点，把抵达和返程单独留出来，中间安排可调整的空白时间。\n\n下一步需要你的出发城市、具体日期和住宿预算，再核对交通衔接。当前还不是已订行程。'],
      ['喜欢逛街、咖啡馆和拍拍照片，暂时不安排高强度徒步。','旅行偏好已保留：散步、咖啡馆、摄影，减少早起和高强度活动。后续选住宿与路线时，以这些偏好为依据。']
    ],['云南草案最多两个住宿据点，尚待出发城市、具体日期和预算。','偏好散步、咖啡馆与摄影，不安排高强度徒步。'],travel);
    chat('cambodia','暹粒与吴哥，怎么安排不太累','国庆旅行',[
      ['柬埔寨这条线主要看吴哥，不想为了打卡把寺庙排满。先帮我列出做行程前需要确定的事。','先确认出行日期、出发城市、预算，以及想花多少时间看建筑和历史。行程里保留休息时段和机动空间。\n\n交通、门票、天气和入境要求都需要按实际出发时间查官方信息，这份草案先不替你做确定判断。']
    ],['暹粒方向以吴哥建筑与历史为主，避免密集打卡。','交通、门票、天气及入境要求尚待出行前核实。'],travel);
    chat('sse','SSE 和 WebSocket 到底怎么选','日常随问',[
      ['做 Agent 对话流式输出，SSE 和 WebSocket 怎么选？我现在是浏览器前端加 Node 后端。','先看通信方向：如果主要是服务端不断推送回复，客户端另发 HTTP 请求提交消息，可以先用 SSE。需要持续双向消息时再比较 WebSocket。\n\n不管选哪种，都要考虑重连、事件标识和重复消息处理。'],
      ['那先用 SSE。页面切到后台再回来，怎么避免漏掉输出？','可以给事件编号，客户端重连时带上最后收到的事件位置；服务端保留一段可回放记录，并提供当前执行状态作为兜底。\n\n恢复时对齐 runId 和事件编号，避免把旧流和新执行混在一起。']
    ],['当前浏览器与 Node 的流式对话先用 SSE。','重连通过事件编号、有限回放与当前执行状态恢复，区分不同 runId。']);
    chat('git','Git worktree 和新开一个分支的区别','日常随问',[
      ['Git worktree 和创建一个分支到底有什么区别？我想同时改两个互不相关的功能。','分支记录一条开发线，worktree 给你另一份工作目录。可以让两个目录分别检出不同分支，各自编辑和运行。\n\n对你的场景，可以把两个功能放在不同目录，避免来回切换时处理未提交改动。合并时仍然需要检查它们是否修改了同一处逻辑。']
    ],['想同时开发两个独立功能；用不同 worktree 分别检出分支。']);
    chat('packing','出门前，帮我记一份随身清单','日常随问',[
      ['顺手记一下：国庆旅行要带相机、备用电池、转换插头。证件和充电设备也别落下。','已整理成一份待核对清单：证件、相机、备用电池、充电设备和转换插头。\n\n等目的地和航班确定后，再核对插头规格、行李及电池携带规则；现在不把候选目的地当成已确认行程。']
    ],['旅行随身清单包含证件、相机、备用电池、充电设备与转换插头，具体规则待核对。']);
    for(const [c,key,title,goal] of [
      [ai,'news','AI 行业简报','每天整理模型发布、Agent 产品与开发者工具的重要变化，优先一手来源，无重要变化不提醒。'],
      [portfolio,'holdings','持仓观察与每周复盘','围绕实际持仓记录重要财报、业务变化与原判断的变化，附来源，避免日常涨跌噪声。'],
      [macro,'learning','建立宏观经济知识框架','围绕通胀、利率、就业与汇率逐步学习，保留每次理解和待追问的问题。'],
    ] as const){store.createWork(c.id,title,goal,{id:`daily-goal-${key}`,status:'needs_input',summary:key==='news'?'关注范围已确定，待接入新闻来源与执行时间':key==='holdings'?'跟踪框架已建立，待补充真实持仓与资料来源':'从利率传导开始，等待下一次学习'});}
    // The dot represents a sample unread reply, never a newly generated memory.
    store.updateConversation(agent.id,{unread:true});
    store.setMetadata('sections:migrated',true);
    store.setMetadata(marker,true);
  });
  return true;
}
