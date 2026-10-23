import type {
  Artifact,
  Conversation,
  ConversationMemory,
  MemoryItem,
  Message,
} from "../../shared/types.ts";
import type { OrbitStore } from "../store.ts";

export const SEMICONDUCTOR_SHOWCASE_ID = "demo-micron-learning";
const marker = "showcase:micron-learning:v1";
const prefix = SEMICONDUCTOR_SHOWCASE_ID;
const q3 =
  "https://investors.micron.com/news/press-release/2025/Micron-Technology-Inc--Reports-Results-for-the-Third-Quarter-of-Fiscal-2025-06-25-2025/default.aspx";
const q4 =
  "https://investors.micron.com/news/press-release/2025/Micron-Technology-Inc--Reports-Results-for-the-Fourth-Quarter-and-Full-Year-of-Fiscal-2025-09-23-2025/default.aspx";
const hbm =
  "https://www.micron.com/content/dam/micron/global/public/products/white-paper/the-emerging-memory-centric-data-center.pdf";
const cowos =
  "https://3dfabric.tsmc.com/english/dedicatedFoundry/technology/cowos.htm";
export const semiconductorSources = [
  {
    title: "美光 FY2025 Q3 业绩公告",
    publishedAt: "2025-06-25",
    periodEnd: "2025-05-29",
    url: q3,
  },
  {
    title: "美光 FY2025 Q4 业绩公告",
    publishedAt: "2025-09-23",
    periodEnd: "2025-08-28",
    url: q4,
  },
  {
    title: "Micron · The Emerging Memory-Centric Data Center",
    publishedAt: "2024-10-14",
    url: hbm,
  },
  { title: "TSMC · CoWoS 技术说明", publishedAt: null, url: cowos },
];

/** Authored demonstration history, never presented as model executions. No live jobs. */
export function createSemiconductorShowcase() {
  const conversations: Conversation[] = [];
  const messages: Message[] = [];
  const memories: ConversationMemory[] = [];
  const artifacts: Artifact[] = [];
  const conversation = (suffix: string, title: string, createdAt: string) => {
    const value: Conversation = {
      id: suffix ? `${prefix}-${suffix}` : prefix,
      title,
      project: "半导体研究",
      pinned: !suffix,
      archived: false,
      goal: "",
      status: "idle",
      summary: "",
      continuous: false,
      unread: false,
      createdAt,
      updatedAt: createdAt,
      panel: { kind: "app", appId: "memory" },
      showcase: {
        title: "半导体学习案例",
        period: "2025.06—09",
        notice:
          "预置的演示对话与记忆；财报为历史公开资料，未接入实时行情。继续发送会调用真实模型。",
      },
    };
    conversations.push(value);
    return value;
  };
  const turn = (
    c: Conversation,
    n: number,
    date: string,
    user: string,
    assistant: string,
  ) => {
    const time = new Date(date).getTime();
    const pair: Message[] = [
      {
        id: `${c.id}-u${n}`,
        conversationId: c.id,
        role: "user",
        content: user,
        createdAt: new Date(time).toISOString(),
      },
      {
        id: `${c.id}-a${n}`,
        conversationId: c.id,
        role: "assistant",
        content: assistant,
        createdAt: new Date(time + 45_000).toISOString(),
      },
    ];
    messages.push(...pair);
    c.updatedAt = pair[1].createdAt;
    return pair;
  };
  const remember = (
    c: Conversation,
    summary: string,
    items: [MemoryItem["kind"], string, string[], boolean?][],
  ) => {
    c.summary = summary;
    memories.push({
      id: c.id,
      conversationId: c.id,
      version: 1,
      status: "ready",
      summary,
      items: items.map(([kind, text, sourceIds, edited], n) => ({
        id: `${c.id}-memory-${n + 1}`,
        kind,
        text,
        sourceIds,
        ...(edited ? { edited } : {}),
      })),
      coveredMessageId: messages
        .filter((m) => m.conversationId === c.id)
        .at(-1)!.id,
      updatedAt: c.updatedAt,
    });
  };
  const branch = (
    c: Conversation,
    parent: Conversation,
    cutoff: number,
    summary: string,
  ) => {
    c.parentId = parent.id;
    c.forkMessageId = `${parent.id}-a${cutoff}`;
    const history = messages.filter((m) => m.conversationId === parent.id);
    c.inheritedSources = history
      .slice(0, history.findIndex((m) => m.id === c.forkMessageId) + 1)
      .map((m) => m.id);
    // Freeze only knowledge available at the fork, never the parent's later Q4 summary.
    c.inheritedContext = JSON.stringify({
      summary,
      items: [],
      sourceIds: c.inheritedSources,
    });
  };
  const document = (
    c: Conversation,
    suffix: string,
    title: string,
    content: string,
  ) =>
    artifacts.push({
      id: `${c.id}-doc-${suffix}`,
      conversationId: c.id,
      title,
      content,
      format: "markdown",
      updatedAt: c.updatedAt,
    });
  const root = conversation("", "看懂美光与存储周期", "2025-06-26T11:30:00Z");
  turn(
    root,
    1,
    "2025-06-26T11:30:00Z",
    "最近总刷到美光和 HBM。我会看 PE 和利润，但不懂芯片。美光到底算 AI 成长股还是周期股？先帮我搭个框架，别直接给股票推荐。",
    `可以把它看成三个需要分别验证的问题：**需求有没有结构性增长、企业能不能把增长变成利润、股价已经反映了多少增长**。\n\n美光做存储芯片，研究它既要看 AI 带来的新需求，也要看价格、供给和资本开支的周期。给它贴上“AI”或“周期”的标签，都替代不了这几项分析。\n\n我们先从内存和存储的区别开始，再用已经发布的 [FY2025 Q3 公告](${q3}) 练习读财报。这个案例按 2025 年的资料顺序回放，不使用后来的行情倒推当时结论。`,
  );
  turn(
    root,
    2,
    "2025-06-26T11:34:00Z",
    "HBM、DRAM、NAND 我就分不清。是不是分别对应 GPU、电脑内存和硬盘？",
    `这个对应能帮助入门，但分类层级需要改一下：**HBM 本身就是一种 DRAM**。\n\n| 名词 | 先理解成什么 | 不能直接推出什么 |\n| --- | --- | --- |\n| DRAM | 运行中的工作内存，DDR、HBM 都在这一类里 | DRAM 不等于电脑内存条 |\n| HBM | 多层 DRAM 堆叠，提供高带宽，服务于需要快速搬运数据的计算 | GPU 的所有显存都必须是 HBM |\n| NAND | 非易失性存储，SSD 的重要基础 | AI 需求强，所有 NAND 都会同步涨价 |\n\n你可以用“工作台”和“仓库”记住内存与存储的区别；HBM 更像为高吞吐工作专门设计的工作台。技术依据：[Micron 数据中心白皮书，2024-10-14](${hbm})。`,
  );
  turn(
    root,
    3,
    "2025-06-26T11:40:00Z",
    "那为什么 HBM 缺货会影响普通内存？还有 CoWoS，它跟 HBM 是同一个东西吗？这个技术问题可以单独聊，不要把主线冲散了。",
    `HBM 是存储器；**CoWoS 是把计算芯片和 HBM 等集成到一起的先进封装技术**，不是另一种内存。[TSMC 技术说明](${cowos})\n\n可以沿着“DRAM 制造 → HBM 堆叠与测试 → 和计算芯片集成 → 系统交付”看约束。某一环节紧张，不等于所有环节都有同样的定价能力。\n\n至于 HBM 对普通 DRAM 供给的影响，我们先把它列为待验证机制：产能配置、良率、位元密度都会影响结果，不能仅凭“都属于 DRAM”就断言普通内存一定涨价。这个问题在「HBM、CoWoS 与供给约束」分支展开；主线继续看财报。`,
  );
  turn(
    root,
    4,
    "2025-06-27T11:20:00Z",
    "回到财报。Q3 看着增长挺好，我应该先读哪几行？不要一下给我塞十几个指标。",
    `先读三层，每层只回答一个问题：\n\n1. **收入：卖得更多，还是卖得更贵？** 总收入只能看到结果，还要用产品结构、出货量和价格补解释。\n2. **毛利率：收入增长有没有留下更多毛利？** 产品组合、制造成本、利用率都可能影响它。\n3. **现金：赚到的利润能留下多少现金？** 经营现金流之后，还要考虑建设产能的投入。\n\n先固定来源和口径：[FY2025 Q3 公告，2025-06-25 发布](${q3})，财季截至 5 月 29 日。这里的 Q3 不是自然年的第三季度；后面比较利润率统一先用 GAAP。详细数字放进「拆财报：增长与现金流」分支，避免把主线变成一张大表。`,
  );
  turn(
    root,
    5,
    "2025-06-27T11:25:00Z",
    "我理解是 HBM 越卖越多，利润率越高，所以周期性会越来越弱，可以给更高估值？",
    "这里其实连续跳了三步。HBM 占比提高可能改善产品组合；这还不等于整个公司的利润率持续上升，更不等于周期性已经消失。\n\n再往估值走，还需要知道这种利润能维持多久、需要投入多少资本，以及市场已经给了什么价格。可以先保留这个**研究假设**：AI 相关产品可能改变盈利结构；用后续几个季度检验它，而不是现在把它写成事实。\n\n比较有用的追问是：如果普通 DRAM 或 NAND 转弱，HBM 的增长能抵消多少？目前我们还没有完成这个拆分。",
  );
  turn(
    root,
    6,
    "2025-06-27T11:31:00Z",
    "对，别把“周期消失”记成我认可的结论。我想同时保留正反两面。另开一条聊怎么证伪：如果我看好 AI，但股价还是不涨，可能哪里想错了？",
    "记住的应该是你的**研究方法**：区分已披露事实、解释性假设和未解决问题；不预设看多结论。\n\n“看好 AI”到“美光股价上涨”之间，至少隔着客户投入、实际采购、产品交付、盈利、自由现金流和估值几道关。需求判断正确，回报判断仍可能不成立。\n\n「反方推演：看好 AI 也可能不赚钱」分支逐条找反证。主线暂时保留两个问号：盈利改善能否跨越周期？市场价格隐含了多乐观的假设？没有当时的股价和一致预期数据，我们先不回答第二个。",
  );
  turn(
    root,
    7,
    "2025-09-24T11:05:00Z",
    "过了一个季度，我回来了。昨天 Q4 财报出了。还记得我们之前担心什么吗？按同一套框架看，哪些判断可以更新，哪些还不能下结论？",
    `记得。之前保留了两条线：**AI 相关产品是否改善盈利结构**，以及**更好的利润是否真正留下更多现金**；你还明确纠正过，不能把“周期消失”当成你的观点。\n\n[Q4 公告，2025-09-23](${q4}) 提供了一个有意思的反差：收入和毛利率继续改善，但公司披露的调整后自由现金流低于 Q3，因为净资本开支明显上升。详细同口径对照在财报分支和右侧资料中。\n\n这让“当期盈利改善”有了更多证据，却不能确认“现金回报同步改善”，更不能据此断言周期结束。现金流减少也不自动等于坏投资：需要继续区分投入时点与未来项目回报。`,
  );
  turn(
    root,
    8,
    "2025-09-24T11:12:00Z",
    "明白。把记忆里“资本开支上升是利空”也改掉，我没有这么说。应该是：短期占用现金，长期回报待验证。下次就从这个问号继续，不用每次重新给我科普 DRAM。",
    "已按这个意思整理：**资本开支上升会占用当期现金；长期回报取决于后续需求、产能利用和投入回报，仍待验证。** 不把它简化成利多或利空。\n\n现在这段研究留下三样东西：\n\n- 一张产业基础图：DRAM、HBM、NAND、先进封装各自在哪个环节。\n- 一套读财报顺序：收入与结构 → 毛利率 → 经营现金流与资本开支。\n- 一个下次继续的问题：新增投入何时变成有回报的产能，什么证据会推翻我们的判断？\n\n右侧导图保留三个讨论分支。点记忆可以查原话，也可以在对应分支继续聊；基础概念不必从头复述。",
  );

  const supply = conversation(
    "supply",
    "HBM、CoWoS 与供给约束",
    "2025-06-26T11:45:00Z",
  );
  branch(
    supply,
    root,
    3,
    "用户从美光研究进入技术支线。已区分 DRAM、HBM、NAND；HBM 是堆叠 DRAM，CoWoS 是先进封装。待解释供给约束，不认定普通 DRAM 一定涨价。背景截止主线第 3 轮。演示资料回放至 2025 年 6 月。",
  );
  turn(
    supply,
    1,
    "2025-06-26T11:45:00Z",
    "接刚才那段。我总把做晶圆、做 HBM 和做封装混在一起。能不能沿着一颗 AI 芯片的交付链讲？",
    `用两条支线汇合更好理解：\n\n- 计算支线：设计计算芯片 → 制造逻辑晶圆 → 测试。\n- 内存支线：制造 DRAM → 堆叠、互连与测试 → 得到可用的 HBM。\n\n两条线之后还要在封装和系统层面集成。CoWoS 位于先进封装这一层，可把逻辑芯片与 HBM 集成在一起。[TSMC CoWoS 说明](${cowos})\n\n这是简化的学习路径，不是所有产品都采用相同封装，也不表示一家厂商包办全部环节。`,
  );
  turn(
    supply,
    2,
    "2025-06-26T11:51:00Z",
    "所以 GPU 卖不出去，也可能不是美光产得不够，而是最后封装卡住了？",
    "对，可以把它当作一种可能原因，但要拿交付和产能证据核对。\n\n**系统供给受瓶颈制约，利润分配却不只由瓶颈决定。** 客户认证、合约、替代方案和库存都会影响企业收益。封装约束缓解可能帮助更多 HBM 交付，也可能让此前积累的库存释放；不能看到某个环节扩产，就直接写成美光利润必然增加。\n\n研究时把“哪个环节紧张”和“谁因此赚更多钱”分开记录。",
  );
  turn(
    supply,
    3,
    "2025-06-26T12:00:00Z",
    "网上说 HBM 会挤占普通 DRAM 的产能。这个说法到底怎么验证，能不能直接拿一个固定倍率算？",
    "不适合拿一个脱离代际和工艺条件的固定倍率，推算整个行业供给。可以拆成三项核对：\n\n1. 同一厂商怎样分配工艺资源与产能，哪些可以转换，哪些不能马上转换。\n2. 每片晶圆的可用位元、良率，以及堆叠与测试的损耗怎样变化。\n3. 其他厂商扩产、技术升级和库存释放，是否抵消这种影响。\n\n“HBM 扩张可能改变其他 DRAM 的供给”先记为机制假设。我们还没有收集齐同口径数据，不把“挤占多少”和“价格必涨”写进事实节点。",
  );
  turn(
    supply,
    4,
    "2025-06-26T12:08:00Z",
    "那 NAND 呢？我原来以为都是存储，可以一块看涨跌。",
    "可以一起研究终端需求，但价格与供给要分开验证。NAND 和 DRAM 不是同一种存储技术，HBM 也不是从 NAND 的分类下面长出来的。\n\n下一次看到“AI 带动存储”这类消息，先追问：影响的是 HBM、服务器 DRAM、企业级 SSD，还是其他产品？再找它对应的公司披露。\n\n你现在最值得留下的概念是：**同一条需求叙事，可能经过不同的产品、供给和盈利路径。**",
  );

  const financials = conversation(
    "financials",
    "拆财报：增长与现金流",
    "2025-06-27T11:35:00Z",
  );
  branch(
    financials,
    root,
    4,
    "主线希望读懂美光，已建立收入、毛利率、现金三层框架；先用截至 2025-05-29、6 月 25 日发布的 FY2025 Q3 公告。利润率先统一用 GAAP，尚未知 Q4 实际结果。背景截止主线第 4 轮。",
  );
  turn(
    financials,
    1,
    "2025-06-27T11:35:00Z",
    "这里专门拆 Q3。我希望下次财报能自己读，不要只帮我总结一遍。",
    `先做一个可复用的小表。金额为**十亿美元**，利润率用 GAAP，现金指标单独标口径。\n\n| FY2025 Q3 | 数值 | 读它是为了问什么 |\n| --- | ---: | --- |\n| 营收 | 9.301 | 增长来自量、价还是产品结构？ |\n| GAAP 毛利率 | 37.7% | 产品组合与成本有没有改善？ |\n| 经营现金流 | 4.609 | 业务产生多少现金？ |\n| 净资本开支（公司调整口径） | 2.660 | 投入产能占用了多少现金？ |\n| 调整后自由现金流（非 GAAP） | 1.949 | 按公司口径，投入后剩多少？ |\n\n[来源：Q3 业绩公告及现金流调节表](${q3})。这些数值是起点；先试着解释最后两行为什么不能只看净利润。`,
  );
  turn(
    financials,
    2,
    "2025-06-27T11:41:00Z",
    "因为利润里有折旧，买设备又不会一次算进费用？所以净利润和手上多了多少钱不是一回事。",
    "方向对。资本开支通常先形成资产，后续通过折旧等方式进入损益；经营现金流还会受到应收、库存、应付等营运资本变化影响。\n\n有两个细节值得补上：第一，公司这里披露的是**调整后自由现金流**，不能把它当成 GAAP 利润指标。第二，净资本开支口径里包含补助等抵减，跨公司比较前要看调节表。\n\n你以后读到“利润大涨”，再补一句：现金转化如何？维持这份盈利需要继续投入多少？",
  );
  turn(
    financials,
    3,
    "2025-06-27T11:47:00Z",
    "Q3 已经这么好，Q4 指引是不是可以当成接下来收入基本确定了？",
    `要区分**管理层指引**和**已实现结果**。Q3 公告给出的 Q4 收入指引是 10.7 ± 0.3 十亿美元，GAAP 毛利率指引是 41.0% ± 1.0%。[Q3 公告中的 Business Outlook](${q3})\n\n先把它写在预测栏里，到下一季再填实际值。未来交付、价格、组合和成本仍可能变化。比较实际与指引有助于检验当时判断，但指引也不是市场一致预期；两者不能互换。`,
  );
  turn(
    financials,
    4,
    "2025-09-24T11:00:00Z",
    "现在加上 Q4。有没有那种表面看更好，仔细一看却需要追问的地方？",
    `有，利润表现与投入后的现金出现了不同方向。下面两期均沿用同一口径，金额为十亿美元。\n\n| 指标 | Q3 | Q4 | 变化 |\n| --- | ---: | ---: | --- |\n| 营收 | 9.301 | 11.315 | 约 +21.7% |\n| GAAP 毛利率 | 37.7% | 44.7% | +7.0 个百分点 |\n| 经营现金流 | 4.609 | 5.730 | 增加 |\n| 净资本开支（公司调整口径） | 2.660 | 4.927 | 增加 |\n| 调整后自由现金流（非 GAAP） | 1.949 | 0.803 | 减少 |\n\n[Q3 公告](${q3}) · [Q4 公告](${q4})。收入增幅按表内数值计算。\n\nQ4 收入超过上一季给出的指引区间上沿，但这仍不说明超过了市场预期。更值得追问的是：投入增加了，现金回报什么时候跟上？`,
  );
  turn(
    financials,
    5,
    "2025-09-24T11:08:00Z",
    "所以不能直接说公司变差，也不能只看利润就说更值得买。下一步查扩产的用途和回报，才是接着这份财报往下走？",
    "是的。现在证据支持“本季度收入与毛利率改善，同时资本投入加大”，还没有回答“扩产项目是否会带来足够回报”。\n\n下一份资料优先找三件事：投入对应哪些项目、何时投产、需求与利用率怎样支撑回报。再把这些假设接到多年现金流上。\n\n至于股票价格是否合适，还缺当时的估值、市场预期和情景分析。把这列保持为空，比拿产业增长直接替代投资判断更诚实。",
  );

  const risks = conversation(
    "countercase",
    "反方推演：看好 AI 也可能不赚钱",
    "2025-06-28T03:00:00Z",
  );
  branch(
    risks,
    root,
    6,
    "用户不认可“周期消失”，要求保留正反观点。已区分产业需求、企业盈利与股票回报；现阶段缺少估值和一致预期数据。此分支只继承 2025 年 6 月主线第 6 轮前的讨论，不含后来 Q4 结果。",
  );
  turn(
    risks,
    1,
    "2025-06-28T03:00:00Z",
    "假设我看好 AI，但买了美光仍然不赚钱。你站在反方，给我三个不重复的解释。",
    "可以把反例放在三个不同层次：\n\n| 哪里可能出错 | 假设情景 | 应该查什么 |\n| --- | --- | --- |\n| 需求到盈利 | AI 需求强，但价格竞争、成本或其他产品走弱抵消收益 | 组合、毛利率、分业务表现 |\n| 盈利到现金 | 利润增长，但维持增长需要持续高投入 | 资本开支、营运资本、现金流 |\n| 公司到股价 | 公司表现很好，但市场此前预期更高 | 当时估值、预期、业绩与预期差 |\n\n这是**反方情景**，不表示这些事情已经发生，也不是对后续股价的预测。",
  );
  turn(
    risks,
    2,
    "2025-06-28T03:08:00Z",
    "那我设几个指标，每次一变差就推翻原来的判断？",
    "先区分“触发复核”和“推翻判断”。单季数据波动，可能来自季节性、客户交付和投入节奏。\n\n比如毛利率下降，可以触发复核：究竟是短期爬坡成本、组合变化，还是定价能力转弱？不同原因对原假设的影响不同。\n\n给每项假设写清**它依赖什么、什么观察会削弱它、还需要什么解释**。现阶段不设机械的买卖阈值；否则很容易把研究清单误用成交易系统。",
  );
  turn(
    risks,
    3,
    "2025-06-28T03:17:00Z",
    "我还经常犯一个错：看到股票跌了，就反过来觉得自己产业逻辑全错了。",
    "可以在复盘里保留两条并列记录：一条是新增产业与公司证据；另一条是市场价格与预期。\n\n股价变化值得调查，但它本身不能直接证明哪条产业假设有问题。先问“新增了什么信息”，再决定是修改需求判断、盈利判断，还是估值判断。\n\n你想建立的是一套可修正的研究过程，而不是每次涨跌后重写整套故事。",
  );
  turn(
    risks,
    4,
    "2025-06-28T03:25:00Z",
    "记住我这个习惯。以后我说“是不是逻辑坏了”，先带我核对证据，不要顺着我的情绪换结论。",
    "记下：当你因价格波动质疑原判断时，先核对新增证据及它影响的层次，再讨论是否修正观点。\n\n下次可以直接从这三个问题开始：需求事实变了吗？公司把需求变成现金的能力变了吗？还是市场原来的预期太高？这三个问题不必每次同时得到相同答案。",
  );

  remember(
    root,
    "从美光出发学习存储产业，分出技术、财报和反方三条支线。Q4 回访显示盈利改善与调整后自由现金流下降并存；资本投入的长期回报待验证，不把 AI 增长等同于股票回报。",
    [
      [
        "fact",
        "HBM 是 DRAM 的一种；NAND 属于另一条存储技术路线，不能把三者并列为同级分类。",
        [`${root.id}-a2`],
      ],
      [
        "idea",
        "AI 相关产品可能改善盈利结构，但“成长叙事”能否削弱周期性仍是研究假设。",
        [`${root.id}-a5`],
      ],
      [
        "decision",
        "资本开支上升会占用当期现金，长期回报待验证；不简化为利空，也不代表周期消失。",
        [`${root.id}-u8`, `${root.id}-a8`],
        true,
      ],
      [
        "question",
        "新增投入何时转化为有回报的产能？需求、利用率与投入回报需要哪些后续证据？",
        [`${root.id}-a8`],
      ],
      [
        "fact",
        "Q4 回访：收入与毛利率改善，同时调整后自由现金流低于 Q3；需要结合净资本开支理解。",
        [`${root.id}-a7`],
      ],
      [
        "decision",
        "研究保留事实、假设与待验证问题；不预设看多、不把“周期消失”当成用户认可的结论。",
        [`${root.id}-u6`, `${root.id}-a6`],
      ],
      [
        "question",
        "市场价格隐含了多乐观的假设？缺少当时估值与一致预期，暂不判断股票回报。",
        [`${root.id}-a6`, `${root.id}-a7`],
      ],
      [
        "decision",
        "用户已掌握存储基础；回访直接接着现金回报的问题继续，不重复从 DRAM 科普开始。",
        [`${root.id}-u8`],
      ],
    ],
  );
  remember(
    supply,
    "梳理存储与封装的分工：HBM 属于 DRAM，CoWoS 承担集成。供给瓶颈与利润分配分别研究；HBM 挤占普通 DRAM 的幅度及 NAND 受益路径尚待证据。",
    [
      [
        "fact",
        "CoWoS 是集成逻辑芯片与 HBM 的先进封装技术，不是另一种内存。",
        [`${supply.id}-a1`],
      ],
      [
        "idea",
        "系统交付受瓶颈影响，但紧缺环节与利润受益方不一定相同。",
        [`${supply.id}-a2`],
      ],
      [
        "question",
        "HBM 如何影响普通 DRAM 供给？需要产能配置、可用位元与良率的同口径证据。",
        [`${supply.id}-a3`],
      ],
      [
        "idea",
        "不使用脱离代际和工艺条件的固定倍率，直接推算整个行业的供给变化。",
        [`${supply.id}-u3`, `${supply.id}-a3`],
      ],
      [
        "question",
        "AI 需求落到哪类 NAND 或 SSD 产品？价格、供给与盈利路径需要单独核对。",
        [`${supply.id}-a4`],
      ],
    ],
  );
  remember(
    financials,
    "用同口径对比美光 FY2025 Q3、Q4。Q4 收入约环比增长 21.7%，GAAP 毛利率上升 7 个百分点；净资本开支增加，调整后自由现金流下降。下一步验证扩产回报。",
    [
      [
        "fact",
        "FY2025 Q3 / Q4 营收为 9.301 / 11.315 十亿美元；GAAP 毛利率为 37.7% / 44.7%。",
        [`${financials.id}-a1`, `${financials.id}-a4`],
      ],
      [
        "fact",
        "Q3 / Q4 净资本开支为 2.660 / 4.927 十亿美元；调整后自由现金流为 1.949 / 0.803 十亿美元（公司非 GAAP 口径）。",
        [`${financials.id}-a1`, `${financials.id}-a4`],
      ],
      [
        "idea",
        "毛利率比较统一使用 GAAP，现金指标另标口径；不能混用净利润和调整后自由现金流。",
        [`${financials.id}-a1`, `${financials.id}-a2`],
      ],
      [
        "question",
        "新增资本开支的项目、投产时间和利用率是什么？当期现金占用是否带来足够的长期回报？",
        [`${financials.id}-u5`, `${financials.id}-a5`],
      ],
      [
        "fact",
        "Q3 给出的 Q4 收入指引是 10.7 ± 0.3 十亿美元；指引不是已实现结果，也不是市场一致预期。",
        [`${financials.id}-a3`],
      ],
      [
        "idea",
        "读财报顺序：收入与产品结构 → 毛利率 → 经营现金流与资本开支 → 多年投入回报。",
        [`${financials.id}-a1`, `${financials.id}-a5`],
      ],
    ],
  );
  remember(
    risks,
    "建立反方研究框架：产业需求到盈利、盈利到现金、公司到股价分别寻找反证。指标变化触发复核，不直接触发交易；用户希望依据新增证据而非价格情绪修正判断。",
    [
      [
        "idea",
        "反方情景：需求强但盈利未改善、利润增长却现金不足、公司表现好但市场原有预期更高。",
        [`${risks.id}-a1`],
      ],
      [
        "idea",
        "指标变化先触发复核，单季波动不自动推翻假设，也不设置机械买卖阈值。",
        [`${risks.id}-a2`],
      ],
      [
        "decision",
        "用户因价格波动问“逻辑是否坏了”时，先核对新增证据及影响层次，不顺着情绪改结论。",
        [`${risks.id}-u4`, `${risks.id}-a4`],
      ],
      [
        "question",
        "下一次变化究竟影响需求、现金转化，还是市场预期？三种解释需要分别验证。",
        [`${risks.id}-a4`],
      ],
      [
        "idea",
        "复盘保留两条并列记录：新增产业与公司证据，以及市场价格与预期。",
        [`${risks.id}-a3`],
      ],
    ],
  );

  document(
    root,
    "q3",
    "资料 · 美光 FY2025 Q3",
    `# 美光 FY2025 Q3 · 历史资料卡\n\n发布：2025-06-25 · 财季截至：2025-05-29\n\n[打开美光官方业绩公告](${q3})\n\n| 指标 | 披露数值 |\n| --- | ---: |\n| 营收 | 9.301 十亿美元 |\n| GAAP 毛利率 | 37.7% |\n| 经营现金流 | 4.609 十亿美元 |\n| 净资本开支（公司调整口径） | 2.660 十亿美元 |\n| 调整后自由现金流（非 GAAP） | 1.949 十亿美元 |\n\n后两项采用公司调节表口径，不应直接与其他公司的自由现金流定义混用。\n\n**当时对 Q4 的指引**：收入 10.7 ± 0.3 十亿美元，GAAP 毛利率 41.0% ± 1.0%。这是指引，不是当时已实现的结果。\n\n本卡为演示案例的摘记，非原公告全文，非实时行情。`,
  );
  document(
    root,
    "q4",
    "资料 · 美光 FY2025 Q4",
    `# 美光 FY2025 Q4 · 历史资料卡\n\n发布：2025-09-23 · 财季截至：2025-08-28\n\n[打开美光官方业绩公告](${q4})\n\n| 指标 | 披露数值 |\n| --- | ---: |\n| 营收 | 11.315 十亿美元 |\n| GAAP 毛利率 | 44.7% |\n| 经营现金流 | 5.730 十亿美元 |\n| 净资本开支（公司调整口径） | 4.927 十亿美元 |\n| 调整后自由现金流（非 GAAP） | 0.803 十亿美元 |\n\n**用于回访的观察**：盈利表现改善与当期现金投入增加同时存在。下一步追问扩产回报，不能只凭一个季度给投入贴上利多或利空标签。\n\n本卡为演示案例的摘记，非原公告全文，非实时行情。`,
  );
  document(
    root,
    "notebook",
    "研究笔记 · 从产业理解到投资判断",
    `# 看懂美光与存储周期\n\n> 演示研究笔记 · 资料回放至 2025-09-24。对话和记忆为预置脚本，公开财报数据保留原始来源。\n\n## 学习路径\n\n主线：AI 成长还是存储周期？\n\n- HBM、CoWoS 与供给约束：搞清产品分类与交付链。\n- 拆财报：增长与现金流：用同口径表格验证判断。\n- 反方推演：看好 AI 也可能不赚钱：区分需求、现金与估值。\n\n## 认识怎样改变\n\n| 时点 | 当时认识 | 后续如何处理 |\n| --- | --- | --- |\n| 6 月，初学 | 容易把 HBM、DRAM、NAND 当成三类并列产品 | 修正为 HBM 属于 DRAM |\n| 6 月，提出假设 | HBM 增长可能改善盈利结构 | 不把“周期消失”当作结论 |\n| 9 月，财报回访 | 盈利改善与调整后自由现金流下降并存 | 进一步验证资本投入的回报 |\n| 9 月，用户修正 | 不认可“资本开支上升就是利空” | 记为短期现金占用、长期回报待验证 |\n\n## 下次继续\n\n资本开支对应哪些项目、何时投产、需求和利用率怎样支持回报？目前不确定估值是否合适，不用产业趋势替代股票回报判断。\n\n## 资料\n\n- [美光 FY2025 Q3，2025-06-25](${q3})\n- [美光 FY2025 Q4，2025-09-23](${q4})\n- [Micron 数据中心白皮书，2024-10-14](${hbm})\n- [TSMC CoWoS 技术说明](${cowos})（动态技术页，仅使用基础技术定义，未用它还原历史产能与供需）\n\n行业机制的分析和反方情景属于学习推演，不是公司已披露结论。`,
  );
  // Conversation order is stable; message order follows actual historical timestamps.
  messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { conversations, messages, memories, artifacts };
}

/** Add once, atomically. A rerun never restores deleted nodes or overrides user edits. */
export function seedSemiconductorShowcase(store: OrbitStore) {
  return store.transaction(() => {
    if (store.metadata(marker))
      return { inserted: false, conversationId: prefix };
    const fixture = createSemiconductorShowcase();
    for (const table of [
      "conversations",
      "messages",
      "memories",
      "artifacts",
    ] as const)
      for (const value of fixture[table])
        if (store.get(table, value.id))
          throw new Error(`演示数据 ID 已存在，未覆盖：${value.id}`);
    for (const value of fixture.conversations)
      store.put("conversations", value);
    for (const value of fixture.messages) store.put("messages", value);
    for (const value of fixture.memories) store.put("memories", value);
    for (const value of fixture.artifacts) store.put("artifacts", value);
    store.setMetadata(marker, {
      importedAt: new Date().toISOString(),
      sources: semiconductorSources,
    });
    return { inserted: true, conversationId: prefix };
  });
}
