import { createHash } from 'node:crypto';
import type { Conversation, Message } from '../../shared/types.ts';
import { OrbitStore } from '../store.ts';
import { SectionService } from '../sections.ts';

const marker = 'showcase:learning-dialogue:v1';
const introDigest = '32a0398477b3507ed3e210f2e0aa8ef919e6256ed105aeb6691fb2861c82d1c8';
type Turn = [question: string, answer: string];
const sources = {
  memory: '[Micron：HBM](https://www.micron.com/products/memory/hbm)',
  packaging: '[TSMC：CoWoS](https://3dfabric.tsmc.com/english/dedicatedFoundry/technology/cowos.htm)',
  performance: '[NVIDIA：GPU 性能基础](https://docs.nvidia.com/deeplearning/performance/dl-performance-gpu-background/index.html)',
  roofline: '[NVIDIA：Roofline 分析](https://developer.nvidia.com/blog/accelerating-hpc-applications-with-nsight-compute-roofline-analysis/)',
};

const main: Turn[] = [
  ['那就从这里往下讲。先别列学习计划：我买的一张显卡，和晶圆厂生产出来的芯片，是同一个东西吗？',
   '不是同一层东西。晶圆是一整片同时加工许多电路的硅片；切割后得到裸片，也叫 die。裸片经过封装、互连和测试，成为可使用的器件，再和供电、连接器等组成板卡。\n\n所以“造出了裸片”不等于“做好了一张显卡”。你看到的产品，中间还隔着封装和整机集成。'],
  ['那 GPU 和 HBM 是分别制造出来，再放在一起？我之前以为 HBM 是 GPU 里面的一块缓存。',
   `对，在典型的 GPU + HBM 封装中，逻辑裸片与存储裸片分别制造，再通过封装互连组合。\n\nHBM 是高带宽的堆叠 DRAM，不是 GPU 内部的缓存。缓存通常更小、离计算单元更近，用来复用近期数据；HBM 承担更大的工作数据存储。\n\n可以先记住三个角色：GPU 做运算，HBM 存放数据，互连负责传输。${sources.memory}`],
  ['如果 GPU 是厨师、HBM 是冰箱，那我买更大的冰箱，厨师不就更快了吗？',
   '更大的冰箱意味着“装得下”，并不保证“拿得快”。对应到硬件：\n\n- 容量：能保存多少数据。\n- 带宽：每秒能搬多少数据。\n- 延迟：一次访问要等多久。\n\n模型装不下时，扩大容量很有价值；已经装得下、却搬得太慢时，单纯加容量未必能加速。这个比喻只帮助区分三件事，不代表真实硬件是一位厨师串行取菜。'],
  ['明白了。但“带宽大”和“延迟低”我还是会混淆。这个想单独开一段算一算，我们这里先继续产业链。',
   '可以，分支里用数字区分“第一份数据多久到”和“一秒钟能到多少”。\n\n回到产业链，封装并非最后套一个保护壳。它还要提供供电和信号连接，决定多个裸片怎样在有限空间里协作。散热和测试也会影响一个组合能否实际使用。'],
  ['新闻里总把 CoWoS 和 HBM 一起说。CoWoS 是另一种存储芯片吗？',
   `不是。HBM 是存储，CoWoS 是台积电的一类先进封装技术。以典型 CoWoS 集成为例，逻辑芯片和 HBM 通过高密度互连组合在一个封装系统中。\n\n它们共同出现，是因为大量数据需要在处理器和存储之间传输；不能因此把“存储容量”和“封装能力”视为同一个指标。不同 CoWoS 方案的具体结构也有区别。${sources.packaging}`],
  ['所以有 GPU、有 HBM 就能交货？如果缺的只是封装，多找几家封装厂是不是就行？',
   '还不够。把器件组合起来，需要匹配设计、互连、供电、散热、测试和制造工艺。某家厂有封装设备，并不自动等于能交付这款产品。\n\n我们先把“有一个环节的能力”与“整个组合经过验证并能交付”区分开。至于某个时期哪家厂紧缺、能转单多少，需要具体产能与认证资料；这段没有做现实供需判断。'],
  ['我试着复述：设计决定功能，制造做出裸片，封装把 GPU 和 HBM 连起来。HBM 越大越快，CoWoS 越多也就越快。这样对吗？',
   '前半段基本对，后半段把三种指标混在了一起。\n\n1. HBM 容量大，首先表示能装更多数据，不直接等于传得更快。\n2. 单个系统的速度取决于负载和瓶颈：计算、访存、通信都可能限制它。\n3. 更多封装产能影响能生产多少套系统，不等于每一套系统运行得更快。\n\n**单机性能、单机容量、可交付数量，是三个不同的问题。**'],
  ['这次串起来了。帮我留一个能回看的结论，别写“下次要学习什么”。还有一个没想通：算力和带宽到底谁更重要？',
   `现在建立的链条是：设计定义电路，制造得到裸片，封装把器件连接为可使用的组合；GPU 负责计算，HBM 提供工作数据，互连承担传输。\n\n容量、带宽、延迟分别回答“装多少、搬多快、等多久”。先进封装的生产能力回答“能交付多少”，不能拿来替代单机性能。\n\n算力和带宽谁更重要，要看每搬一字节数据能做多少运算，以及数据是否得到复用。下一条分支里的假设算例会具体算清这个问题。${sources.performance}`],
];

const hbm: Turn[] = [
  ['接着刚才冰箱的比喻。我还是没抓住容量、带宽和延迟，能给我一组完全假设的数字吗？',
   '假设系统甲容量 80 GB、带宽 2 TB/s，系统乙容量 160 GB、带宽 1 TB/s。模型工作数据占 60 GB，两者都装得下；若某个阶段只是在搬同样的数据，甲的带宽上限更高。\n\n如果工作数据变成 100 GB，甲单机就装不下，乙可能更合适。这里忽略了其他开销，只为说明：容量翻倍不意味着带宽翻倍；这些数字不是任何真实产品的规格。'],
  ['那延迟就是搬 1 TB 数据花多少时间，对吧？',
   '不完全是。访问延迟通常描述一次请求从发出到得到响应的等待时间；传完一个大批次，还受到吞吐能力影响。\n\n在一个极简模型里，“总时间 ≈ 启动等待 + 数据量 ÷ 带宽”。传一小块数据，启动等待可能很明显；传一大批数据，后面的传输项可能更大。真实系统还会有并发请求、排队和缓存，不能直接用这个公式替代测量。'],
  ['所以数据量除以带宽不是延迟，是传输时间的一部分。那堆更多层 DRAM，为什么不一定等比例增加带宽？',
   `因为存储空间与对外接口是两套约束。多放存储单元可以增加容量；每秒能传多少，还取决于接口宽度、传输速率和实际利用率。堆叠层数不能单独决定接口吞吐。\n\nHBM 通过堆叠与宽接口实现高带宽，但“堆得更高”不等于外部数据通道按相同比例增加。${sources.memory}`],
  ['我能记住这三个概念了。但带宽和算力怎么一起决定速度？我们再分出去算一道题。',
   '用一个新的量连接它们：**算术强度 = 运算次数 ÷ 从指定存储层搬动的字节数**。如果读入同一份数据后反复计算，就能减少相对于运算量的数据搬运。\n\n它描述的是这段工作如何使用数据，不是 GPU 的一个固定属性。另一个分支可以用相同硬件、两种算术强度，比较瓶颈为什么改变。'],
  ['最后再确认一下：模型跑得慢，有可能根本不是容量不够，对吗？',
   '对。先分开问：\n\n- 是否装得下？这是容量约束。\n- 已经装下，处理器是否在等数据？这可能是带宽或访问延迟约束。\n- 数据供应够了，运算是否已经达到上限？这可能是计算约束。\n\n这是一组排查概念，不是对某台机器的诊断。要判断实际瓶颈，仍需要测量。'],
];

const bandwidth: Turn[] = [
  ['就按你说的算术强度算。假设 GPU 算力 100 TFLOP/s，内存带宽 2 TB/s；每读一个字节做 10 次浮点运算。是不是就能跑到 100？',
   `在这个假设的 Roofline 简化模型中，带宽允许的运算速度是：\n\n2 TB/s × 10 FLOP/Byte = 20 TFLOP/s。\n\n再和计算上限比较：min(100, 20) = **20 TFLOP/s**。这里按十进制单位，且假设精度一致、忽略其他开销；20 是这个模型的性能上界，不是实测保证。${sources.roofline}`],
  ['如果我把 GPU 换成 200 TFLOP/s，岂不是还是 20？那提升算力完全没意义？',
   '对当前这组假设，上界仍是 min(200, 20) = 20。它说明这段工作先撞到带宽约束，不能推出提升算力对所有工作都没意义。\n\n假设通过数据复用把算术强度提高到 80 FLOP/Byte：带宽侧上界变为 2 × 80 = 160 TFLOP/s。原 GPU 的计算上限是 100，此时计算能力就会成为限制。'],
  ['我刚才漏了“当前这组假设”。怎么算两种瓶颈的分界？',
   '分界算术强度 = 计算上限 ÷ 内存带宽。\n\n100 TFLOP/s ÷ 2 TB/s = **50 FLOP/Byte**。\n\n低于 50 时，这个模型先受带宽限制；高于 50 时，先受计算上限限制。实际还可能更慢，例如启动、同步、通信或利用率不足。算术强度的字节数也必须明确针对哪一级存储，不能把缓存流量和 HBM 流量混着算。'],
  ['这样就不是“GPU 和 HBM 哪个更重要”，而是这段计算需要什么。那同一个模型不同阶段也可能不一样？',
   '是的。即使同一个模型，不同阶段、批量大小和实现方式，也可能改变数据复用与运算量的比例。\n\n这道题得到的是一个判断方法：先明确负载、数据流量和计算精度，再比较计算上限与带宽侧上界。它没有证明任何具体模型或产品当前处于哪一种瓶颈。'],
];

const packaging: Turn[] = [
  ['从产业链那边接着问。封装既然不只是外壳，那晶圆制造和先进封装到底在做不同的什么？',
   '可以按观察尺度区分：制造主要在晶圆上形成器件和电路；封装把裸片连接为可使用的器件或系统。\n\n在多裸片集成中，封装还承担裸片之间的连接。两者都可能使用精密工艺，但目标与对象并不相同。“制造完成”只表示走过了其中一段。'],
  ['我以前觉得封装是低技术的后道，听起来这个理解过时了？',
   `至少不能把所有封装都看成简单装壳。以 CoWoS 为例，它要把逻辑芯片、HBM 和高密度互连组合起来。数据通路和物理集成已经是设计的一部分。\n\n这也不意味着每一种产品都必须用 CoWoS；是否需要某种封装方式，取决于产品设计和约束。${sources.packaging}`],
  ['用一个数说明“一个环节扩产了，整条链却没增加交付”可以吗？',
   '做一道完全假设的配套题：一个系统需要 1 颗逻辑芯片、4 组存储和 1 个封装名额。某月有逻辑芯片 100 颗、存储 240 组、封装名额 80 个。\n\n忽略损耗与库存调配，最多能配成 min(100, 240÷4, 80) = **60 套**。如果只把封装名额从 80 增加到 120，仍只能配 60 套。\n\n这不是实际生产数据，只用于理解配套约束。'],
  ['那我看到“封装产能增长 50%”，就不能直接认为 GPU 出货增长 50%。如果存储也够了呢？',
   '对。仍用这个假设：存储增加到 400 组、封装达到 120，逻辑芯片仍是 100 颗，则配套上限变成 min(100, 400÷4, 120) = **100 套**。约束从存储转到了逻辑芯片。\n\n真实交付还要考虑良率、产品组合、测试、认证与生产周期，所以配套上限也不能直接当作最终出货量。'],
  ['这和前面算力/带宽的题很像，都是最先碰到的限制。能把容易混的地方收在一起吗？',
   '相似处是都需要找约束，但它们回答不同的问题：\n\n- 算力与带宽的算例：一套系统运行某段计算能有多快。\n- 逻辑芯片、存储与封装的配套题：一段时间里最多能组成多少套系统。\n\n前者是性能，后者是数量。封装产能增长，不会自动提高单机速度；单机速度提高，也不代表可以生产更多机器。'],
];

const summaries = {
  main: '半导体产业链从设计、晶圆制造走到封装与系统集成。GPU 做运算，HBM 是独立的堆叠 DRAM，封装与互连让它们协作。\n\n• 晶圆切割得到裸片；裸片做出来，不代表显卡已经可以交付。\n• 容量、带宽、延迟分别表示装多少、搬多快、一次访问等多久；HBM 更大不等于更快。\n• CoWoS 是先进封装技术，不是存储芯片。更多封装产能影响交付数量，不直接提高单机速度。\n\n反复澄清的是：单机容量、运行性能、可交付数量是三种不同指标。算力与带宽如何形成瓶颈，在后续算例分支中继续解释。',
  hbm: '容量回答“装得下吗”，带宽回答“每秒搬多少”，延迟回答“一次访问等多久”。容量翻倍不会自动让传输更快。\n\n• 假设 80 GB / 2 TB/s 与 160 GB / 1 TB/s 两个系统：60 GB 的数据都装得下，前者带宽更高；100 GB 的数据则超出前者容量。\n• 数据量 ÷ 带宽是传输时间的一部分，不等于一次请求的全部延迟。\n• 堆叠层数与接口宽度、速率是不同约束，增加 DRAM 层数不保证带宽等比例增加。\n\n“容量不够”和“处理器等数据”被区分开。算术强度进一步把运算量与数据搬运量联系起来。所有硬件数字均为假设。',
  bandwidth: '假设计算上限 100 TFLOP/s、带宽 2 TB/s，算术强度为 10 FLOP/Byte，带宽侧上界是 20 TFLOP/s，因此只提升计算上限没有改变这道题的瓶颈。\n\n• 数据复用使算术强度提高到 80 时，带宽侧上界升至 160，原来的 100 TFLOP/s 计算上限成为限制。\n• 分界点为 100 ÷ 2 = 50 FLOP/Byte，单位与计算精度必须一致。\n• 这些是简化模型的上界，不是实测速度；还可能受到启动、同步、通信和利用率影响。\n\n结论从“算力与带宽谁更重要”修正为“这段负载最先遇到哪种约束”。',
  packaging: '先进封装承担裸片之间的互连和集成，不能理解成简单装壳。制造完成、封装可用与最终交付是不同环节。\n\n• 假设一套系统需要 1 颗逻辑芯片、4 组存储和 1 个封装名额：100 颗芯片、240 组存储、80 个名额最多配 60 套。\n• 封装名额增至 120，仍受存储限制；存储增至 400 组后，上限变成 100 套，约束转到逻辑芯片。\n• 现实还需考虑良率、测试、认证与周期，配套上限不等于出货预测。\n\n封装产能影响“能交付多少”，计算和访存瓶颈影响“单机跑多快”，两种指标不能混用。',
};

/** Upgrade only an untouched short sample; otherwise add an independent case. No real user messages are changed. */
export function seedLearningShowcase(store: OrbitStore) {
  if (store.metadata(marker)) return { inserted: false, ids: [] as string[] };
  const existing = store.get('conversations', 'daily-semi');
  const original = store.list('messages').filter(m => m.conversationId === existing?.id);
  const memory = existing && store.get('memories', existing.id);
  const digest = createHash('sha256').update(JSON.stringify(original.map(({id, role, content}) => ({id, role, content})))).digest('hex');
  const reuse = Boolean(existing?.showcase && !existing.archived && digest === introDigest && memory && memory.version <= 2 && !memory.summaryEdited && !memory.items.some(i => i.edited || i.deleted));
  const rootId = reuse ? existing!.id : 'learning-chip-chain';
  const childIds = ['learning-hbm-concepts', 'learning-roofline-example', 'learning-packaging-chain'];
  for (const id of [...(!reuse ? [rootId] : []), ...childIds]) {
    if (store.get('conversations', id) || store.get('memories', id) || store.list('messages').some(m => m.conversationId === id)) throw new Error('学习示例 ID 已存在，未覆盖已有内容');
  }
  store.transaction(() => {
    const project = reuse ? existing!.project : '学习与研究';
    new SectionService(store).ensure(project);
    const start = Date.parse(original.at(-1)?.createdAt || '2026-09-24T04:00:00.000Z') + 180000;
    const root = reuse ? existing! : store.createConversation('从零理解半导体：一颗 AI 芯片怎样工作', {id: rootId, project, order: 2,createdAt:new Date(start).toISOString()});
    function append(c: Conversation, turns: Turn[], startAt: number, prefix: string) {
      const messages: Message[] = [];
      for (const [index, [question, answer]] of turns.entries()) {
        for (const [role, content, suffix] of [['user',question,'u'], ['assistant',answer,'a']] as const) {
          const message: Message = {id:`${prefix}-${suffix}${index+1}`,conversationId:c.id,role,content,createdAt:new Date(startAt+index*180000+(role==='assistant'?45000:0)).toISOString()};
          if (store.get('messages', message.id)) throw new Error('学习示例消息 ID 冲突，未覆盖已有内容');
          messages.push(store.put('messages', message));
        }
      }
      return messages;
    }
    function overview(c: Conversation, summary: string, messages: Message[]) {
      const before = store.get('memories',c.id);
      const last = messages.at(-1)!;
      store.put('memories',{id:c.id,conversationId:c.id,version:(before?.version||0)+1,status:'ready',summary,items:[],coveredMessageId:last.id,updatedAt:last.createdAt});
      store.updateConversation(c.id,{summary,unread:false,updatedAt:last.createdAt,showcase:{title:'半导体学习对话',period:'',notice:'人工编写的多轮学习示例，展示追问、概念澄清和真实分支关系。文中算例均为假设，不是实测性能或现实产能。技术参考来自 NVIDIA、Micron 与 TSMC 官方资料；继续提问使用真实模型。'}});
    }
    function branch(id: string, title: string, parent: Conversation, cutoff: Message, turns: Turn[], summary: string, inheritedSummary: string, order: number) {
      const parentMessages = store.list('messages').filter(m => m.conversationId===parent.id);
      const throughFork = parentMessages.slice(0,parentMessages.findIndex(m=>m.id===cutoff.id)+1);
      const inheritedSources = [...new Set([...(parent.inheritedSources||[]),...throughFork.map(m=>m.id)])];
      const c=store.createConversation(title,{id,project,order,parentId:parent.id,forkMessageId:cutoff.id,inheritedSources,inheritedContext:JSON.stringify({summary:inheritedSummary,items:[]}),createdAt:new Date(Date.parse(cutoff.createdAt)+60000).toISOString()});
      const messages=append(c,turns,Date.parse(c.createdAt),id);
      overview(c,summary,messages);
      return {c,messages};
    }
    const introduction: Turn[] = [
      ['想从零理解半导体产业。设计、制造、封装，是不是几个公司对同一件事的不同叫法？','它们是不同环节：设计定义电路及其功能，制造把电路做在晶圆上，封装和测试把裸片变成可以使用的器件。设备与材料为这些环节提供生产条件。同一家公司可以覆盖多个环节，不能仅凭公司数量划分产业链。'],
      ['那用 AI 服务器作例子吧，为什么 GPU、HBM 和先进封装总是一起出现？','这三个词涉及计算、存储与连接。GPU 执行运算，HBM 存放工作数据，封装互连把它们组合起来。它们不是同一种产品，也不能用同一个指标衡量。我们从你能看到的板卡，往里面拆开。'],
    ];
    const rootMessages=append(root,reuse?main:[...introduction,...main],start,'learning-main');
    const mainMessages=rootMessages.slice(reuse?0:4);
    overview(root,summaries.main,rootMessages);
    const hb=branch(childIds[0]!,'HBM：容量、带宽和延迟差在哪',root,mainMessages[7]!,hbm,summaries.hbm,'已区分裸片与显卡、GPU 与 HBM，并初步区分容量、带宽和延迟。用户希望用数字继续澄清这三个概念。',2.1);
    branch(childIds[1]!,'算一遍：GPU 为什么会等数据',hb.c,hb.messages[7]!,bandwidth,summaries.bandwidth,'容量、带宽与延迟已用假设数字区分。算术强度表示运算次数与指定存储层数据流量之比；本分支开始计算性能上界。',2.2);
    branch(childIds[2]!,'先进封装：为什么芯片造好还不够',root,mainMessages[11]!,packaging,summaries.packaging,'已解释 CoWoS 是先进封装技术，不是存储芯片。拥有 GPU 和 HBM 还不等于能交付可使用的组合；尚未进行产能算例。',2.3);
    store.setMetadata(marker,{rootId,ids:[rootId,...childIds]});
  });
  return {inserted:true,ids:[rootId,...childIds]};
}
