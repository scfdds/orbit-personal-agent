import { createHash } from "node:crypto";
import type { OrbitRuntime } from "../runtime.ts";
import type { Message, ConversationMemory } from "../../shared/types.ts";
import type { Project } from "../../shared/projects.ts";
import type { ContactContext, WechatTopic } from "../../shared/wechat-personal.ts";
import { conversationRounds } from "../../shared/discussion.ts";
import { recapSource, validateRecap } from "../../shared/recap.ts";

export const workspaceDemoMarker = "workspace-demo:seed:v1";
export const workspaceDemoProjectId = (key: string) => `demo-project-${key}`;
export const workspaceDemoConversationId = (key: string) => `demo-conversation-${key}`;

type Round = [question: string, answer: string, title: string, takeaway: string];
interface DemoConversation {
  key: string;
  title: string;
  summary: string;
  hoursAgo: number;
  rounds: Round[];
  note?: { title: string; content: string };
}
interface DemoProject {
  key: string;
  name: string;
  summary: string;
  memory: string;
  conversations: DemoConversation[];
}

/** Authored fiction. No records, names, paths or credentials are copied from a real workspace. */
const projects: DemoProject[] = [
  {
    key: "cafe", name: "小店网站", summary: "帮朋友的咖啡店做一个手机上好用的展示网站，周五提供预览。",
    memory: `## 已确定
- 网站给来店前想看菜单、地址和营业时间的顾客使用，先做好手机端。
- 首版包括门店介绍、菜单、地址和联系方式；不包括下单、支付和用户账号。
- 菜单先用普通页面展示，不做管理后台。朋友提供照片和菜单文字。
- 周五交付的是展示网站预览，不是正式上线。

## 当前进度
- 首页、菜单与到店信息的结构已确定。
- 门店照片已收到，菜单价格和节假日营业时间还待确认。
- 原范围未接受在线下单，新增需求需要另行评估。`,
    conversations: [
      { key: "cafe-scope", title: "首版做哪些功能", hoursAgo: 70,
        summary: "首版是面向手机的门店展示网站，包含介绍、菜单、地址和联系方式。下一步：确认菜单价格和营业时间，周五给预览。",
        rounds: [
          ["朋友开了家咖啡店，我想帮他做个小网站。顾客扫码能看菜单，知道店在哪里就行。", "首版围绕来店前的三个问题：卖什么、什么时候营业、怎么到店。页面先做好手机端，菜单、地址和营业时间都放在容易看到的位置。", "先解决来店前的问题", "手机端优先，突出菜单、营业时间和到店信息。"],
          ["就做门店介绍、菜单、地址和联系方式，不要下单支付和账号。周五先给他看预览。", "范围记下了。周五交付展示网站预览；下单、支付和账号不在这一版。菜单先用普通页面，等内容频繁变动时再考虑后台。", "首版范围已经确定", "周五给展示网站预览，暂不做下单、支付和账号。"],
        ] },
      { key: "cafe-mobile", title: "菜单和到店信息怎么排", hoursAgo: 26,
        summary: "菜单按咖啡、非咖啡、甜点三类；地址支持复制，营业时间紧邻地址。下一步：把手机上的菜单首屏再压短一些。",
        rounds: [
          ["菜单有十几种饮品，放首页会不会太长？", "首页只展示三款招牌和“查看完整菜单”。完整菜单按咖啡、非咖啡、甜点分三组，顾客向下滑就能看完，不用频繁切换。", "首页只展示招牌", "首页保留三款招牌，完整菜单分成三组。"],
          ["地址和营业时间别藏起来。地址最好点一下就复制。", "把到店信息放在首页菜单入口后面：营业时间、详细地址、复制地址按钮放在同一块。地图另设入口，页面本身不加载大地图。", "到店信息放在一起", "营业时间与地址相邻，支持一键复制地址。"],
        ] },
      { key: "cafe-preview", title: "周五预览前还差什么", hoursAgo: 1,
        summary: "页面结构已确定、照片已收到；尚待确认菜单价格和节假日营业时间。下一步：补齐这两项内容，再检查手机上的字号和点击区域。",
        rounds: [
          ["照片朋友已经发来了。预览前还需要他确认哪些东西？", "还差两项：菜单上的最终价格，以及节假日是否沿用平时营业时间。照片可以先排进去，其余占位文案也一起核对，避免把草稿当成正式信息。", "素材还差两项确认", "照片已收到，菜单价格和节假日营业时间待确认。"],
          ["小店网站现在还差什么？", "主要还差**菜单价格和节假日营业时间**两项确认。页面结构和照片已经齐了，补齐后再检查一次手机上的字号、按钮和地址复制。\n\n周五仍按展示网站预览准备，暂不加入下单功能。", "保持周五预览范围", "先补内容并检查手机体验，不扩大首版范围。"],
        ],
        note: { title: "周五预览清单", content: "# 周五预览清单\n\n- [x] 确定首页、菜单和到店信息结构\n- [x] 收到门店照片\n- [ ] 确认菜单价格\n- [ ] 确认节假日营业时间\n- [ ] 检查手机字号、点击区域和复制地址\n\n本次预览只包含展示网站，不包含下单、支付和用户账号。" } },
    ],
  },
  {
    key: "weekend", name: "周末出游", summary: "和朋友去湖边散步、吃饭，行程轻松，时间仍在确认。",
    memory: `## 行程草案
- 和朋友周末去湖边，暂定周六 10:00 出发，傍晚回来，不住宿。
- 以散步、咖啡和晚饭为主，不赶景点，每人预算先按 300 元安排。
- 还没订餐厅或买票，时间可以调整。

## 偏好与备选
- 集合点选择公共交通方便的位置，不安排长距离徒步。
- 下雨就缩短户外行程，改成室内咖啡和晚饭。
- 需要先确认大家的空闲时间，再定集合与预订。`,
    conversations: [
      { key: "weekend-plan", title: "湖边半日行程", hoursAgo: 50,
        summary: "草案为周六 10:00 出发、傍晚回，不住宿，主要散步和吃饭。下一步：确认朋友们的时间再定集合点。",
        rounds: [
          ["这周末想和朋友去湖边走走，别太累，也不想住一晚。", "可以只安排半天到一天：到湖边散步，找地方喝咖啡，再一起吃晚饭。不把路线排满，坐公共交通往返就好。", "轻松的一日出游", "不住宿，以湖边散步、咖啡和晚饭为主。"],
          ["先按周六十点出发，傍晚回。每个人三百以内，还得看看大家有没有空。", "先作为草案保留：周六 10:00 出发、傍晚返回，每人预算 300 元以内。等大家确认时间再定集合点；目前没有预订。", "时间和预算先留草案", "周六十点出发尚待大家确认，预算每人三百元以内。"],
        ] },
      { key: "weekend-rain", title: "如果下雨怎么调整", hoursAgo: 23,
        summary: "雨天减少户外散步，改成咖啡和晚饭；暂无预订。下一步：出发前核对天气再决定路线。",
        rounds: [
          ["万一下雨怎么办？别到时候都没地方去。", "保留一个室内备选就够了：缩短散步，咖啡店多待一会儿，晚饭照常。先不用安排第二套密集路线。", "雨天也不赶行程", "缩短散步，保留咖啡和晚饭。"],
          ["可以，先别订餐厅，等时间确定。", "餐厅先不预订。等大家确认日期和集合时间，再核对天气，选择步行距离短、容易到达的位置。", "时间确定后再预订", "目前未订餐厅，先确认日期和集合时间。"],
        ] },
    ],
  },
  {
    key: "finance", name: "金融学习", summary: "从财报和现金流开始理解公司，不做短线交易建议。",
    memory: `## 学习方式
- 目标是读懂一家公司的经营情况，先学财报，再学估值。
- 优先使用小数字和日常生意的例子，术语出现时先解释。
- 目前只是知识学习，不涉及真实持仓或买卖建议。

## 已讨论
- 利润与现金流会因确认时间、应收账款和支出而不同。
- 毛利反映收入扣除直接成本后的空间，还要考虑其他费用。
- 估值需要说明假设；不能仅凭一个指标给公司下结论。

## 接下来
用一家虚构咖啡店的简化报表练习，把利润、应收和现金对应起来。`,
    conversations: [
      { key: "finance-cash", title: "为什么有利润却没现金", hoursAgo: 46,
        summary: "用赊销例子区分利润与收款，明确还要看应收、库存和支出。下一步：用简化报表把利润和现金对应起来。",
        rounds: [
          ["为什么有的公司说赚钱了，账上却没钱？用简单例子说。", "比如一家店卖了 1,000 元东西，成本 600 元，但顾客下个月才付款。这笔业务可能已经确认收入和利润，现金却还没到账。利润和现金在记录什么、何时记录上不同。", "卖出去不等于收到了钱", "利润确认和现金收付可能不在同一个时间。"],
          ["那看利润表不够，还得看应收账款？", "对。应收账款能帮助判断收入里有多少还没收回；现金流量表再告诉你钱实际进出了多少。库存、设备投入、借款等也会影响账上的现金。", "把三张报表联系起来", "同时看利润、应收账款和现金流，避免只看一个数字。"],
        ] },
      { key: "finance-margin", title: "毛利率高就是好生意吗", hoursAgo: 95,
        summary: "已区分毛利与最终利润，还要考虑人工、租金、营销等费用。下一步：结合现金回收和获客成本判断经营质量。",
        rounds: [
          ["一杯咖啡卖三十，材料只要十块，剩下二十都是赚的吗？", "这二十元更接近扣除直接成本后留下的空间，还不是最终赚到的钱。店铺还要支付人工、租金、设备和营销等费用，具体会计口径也需要保持一致。", "毛利不等于净利润", "材料之外仍有人工、租金和设备等成本。"],
          ["所以毛利率很高，也可能经营得不好？", "是的。毛利高但客流少、获客费用高或门店利用率低，都可能让最终利润不理想。还要看规模、费用、现金回收，不能只凭毛利率判断。", "指标要结合经营看", "毛利率需要和规模、费用及现金回收一起理解。"],
        ] },
      { key: "finance-valuation", title: "估值为什么要看假设", hoursAgo: 142,
        summary: "理解了未来现金流和折现的基本关系；估值结果依赖增长、风险等假设。下一步：练习比较不同假设下的结果，不急着套公式。",
        rounds: [
          ["为什么同一家公司的估值，不同人算出来差很多？", "因为大家对未来收入、成本、增长和风险的判断可能不同。估值不是把一个公开数字放进公式就得到唯一答案，先要看计算背后的假设。", "结果差异来自假设", "增长、成本和风险判断都会改变估值。"],
          ["先别给一堆公式，我想先看懂这个逻辑。", "先把它想成买一家店：你关心未来能拿回多少钱、多久拿回、这些钱有多不确定。假设换一组，愿意付的价格就会变化。后面再用小数字把这种变化算出来。", "先理解再计算", "从未来拿回的钱、等待时间和不确定性理解估值。"],
        ] },
    ],
  },
  {
    key: "photo", name: "摄影账号", summary: "面向手机摄影新手，用可复现的小实验讲清拍摄方法。",
    memory: `## 账号定位
- 面向手机摄影新手，先讲拍摄方法，再讨论设备。
- 讲解尽量用同一场景的前后对比，不堆参数。
- 每周准备一条内容，周日发布，发布前仍要自己检查。

## 当前安排
- 本周已准备“三款入门相机对比”的提纲，计划周日发布，尚未拍摄完成。
- 新选题先放候选列表，不因一条反馈直接替换原排期。
- 留意读者在真实拍摄中遇到的问题，避免只按设备新品选题。`,
    conversations: [
      { key: "photo-position", title: "账号先讲方法还是设备", hoursAgo: 168,
        summary: "账号面向手机摄影新手，优先用前后对比讲方法，设备作为补充。下一步：每条内容只解决一个具体拍摄问题。",
        rounds: [
          ["想做个摄影账号，但我不想天天介绍器材。", "可以围绕新手实际遇到的问题：拍糊、逆光、构图不知道怎么取舍。用同一场景调整前后的画面对比，让观众看完就能试。", "选题从拍摄问题出发", "用同一场景的前后对比讲清一个方法。"],
          ["受众就手机摄影新手，先讲方法，设备偶尔聊。", "定位就按这个来：手机摄影新手，每条解决一个具体问题。设备内容作为补充，不默认让观众通过换设备解决问题。", "面向手机摄影新手", "先讲方法，设备内容作为补充。"],
        ] },
      { key: "photo-weekly", title: "这周的内容怎么安排", hoursAgo: 21,
        summary: "本周相机对比提纲已列好，原定周日发布；新的拍摄问题先进入候选。下一步：拍摄同场景样片，补齐比较依据。",
        rounds: [
          ["这周想对比三款入门相机，周日发。别做成参数表。", "用三个相同场景对比更直观：室内人物、户外行走和夜景。每段只讲拍摄体验与画面差异；参数只解释它为什么会影响结果。", "同场景对比替代参数堆砌", "用相同场景展示差异，再解释相关参数。"],
          ["提纲先保留。群里如果有人问拍摄问题，先记成候选，不要把计划自动换了。", "本周保留相机对比，周日发布仍是计划。读者问题先收进候选，等你决定后再调整排期；下一步先拍同场景样片。", "反馈进入候选选题", "保留原排期，新反馈不自动替换本周计划。"],
        ] },
    ],
  },
  {
    key: "portfolio", name: "个人网站", summary: "做一个简单的作品集，清楚展示做过什么和如何联系。",
    memory: `## 目标与范围
- 网站用于展示自己的小项目，页面简洁，手机上也方便阅读。
- 首页包括一句自我介绍、三件作品和联系入口。
- 暂不做博客、登录和复杂动画。

## 作品说明
- 每件作品写清：解决什么问题、自己做了什么、目前能体验到什么。
- 封面用实际界面截图，避免仅用抽象装饰图。
- 第一件先整理小店网站，隐去不适合公开的信息。

## 当前进度
页面结构已定，作品文案还在整理；尚未发布。`,
    conversations: [
      { key: "portfolio-home", title: "首页保留哪些内容", hoursAgo: 120,
        summary: "首页保留介绍、三件作品和联系入口，不做博客和登录。下一步：完成第一件作品的介绍文案。",
        rounds: [
          ["我想做个个人网站展示作品，越简单越好。", "首页只需要回答三个问题：你做什么、做过什么、怎么联系。先放一句介绍、三件作品和联系入口，手机上也能轻松看完。", "首页只保留三个部分", "一句介绍、三件作品、联系入口。"],
          ["不用博客和登录，动画也先不要。我先把小店网站放进去。", "就先做静态作品集，不加博客、登录或复杂动画。第一件整理小店网站，用实际页面截图配上简短介绍，完成文案后再发布。", "先完成静态作品集", "第一件作品是小店网站，尚未发布。"],
        ] },
      { key: "portfolio-case", title: "作品介绍怎么写清楚", hoursAgo: 44,
        summary: "作品文案按问题、自己的工作、当前效果三部分写，配真实界面截图。下一步：补一张手机菜单截图并核对可公开内容。",
        rounds: [
          ["作品介绍总写得像在列功能，怎么说清楚？", "每件作品用三小段：原来遇到什么问题，你负责做了哪些取舍，现在可以怎样使用。功能只用来支持这三个问题，不必把页面逐个列出来。", "介绍取舍和使用效果", "按问题、自己的工作、当前效果组织作品说明。"],
          ["那小店网站就讲扫码快速看菜单和找地址，配手机截图。", "这个角度很清楚。配一张菜单和到店信息的手机截图，说明首版为什么聚焦展示；上线前再核对哪些照片和联系方式可以公开。", "用具体使用场景讲作品", "用扫码看菜单、找地址的场景配手机界面截图。"],
        ] },
    ],
  },
];

interface DemoContact {
  key: string; title: string; project: string; background: string;
  messages: Array<[sender: string, text: string]>;
  summary: string; topic: string; opener: string; suggestions: string[];
}
const contacts: DemoContact[] = [
  {
    key: "weekend", title: "周末出游群", project: "weekend", background: "一起商量周末出游的朋友群；时间还没有最终确定。",
    messages: [
      ["小夏", "周六上午临时有事，我最早下午两点才能出发。你们先玩也行。"],
      ["阿卓", "如果想一起走，周日我也有空，其他人方便吗？"],
      ["小夏", "我周日也可以。要是还是周六，下午湖边走走、吃个晚饭也挺好。"],
    ],
    summary: "小夏周六最早 14:00 出发；小夏和阿卓周日也有空。",
    topic: "周六出发时间需要再确认",
    opener: "小夏最早周六 14:00 出发，和原来 10:00 的草案有冲突。小夏和阿卓周日都有空，可以比较周六下午和周日两个安排，其他人的时间还需要确认。",
    suggestions: ["比较两种安排", "整理一句群里确认时间的话"],
  },
  {
    key: "cafe", title: "林同学 · 小店网站", project: "cafe", background: "小店网站的需求联系人。首版是展示网站，周五提供预览。",
    messages: [
      ["林同学", "能不能再加个在线下单？周五一起看看，大概需要多久呀？"],
      ["林同学", "第一版不用支付，客人选菜、留手机号就行。店里最好能收到提醒。"],
      ["林同学", "周五先看下单流程演示也可以，正式开通时间等你评估后再说。"],
    ],
    summary: "追加不含支付的下单需求，希望周五先看流程演示。",
    topic: "下单需求超出了首版约定",
    opener: "林同学希望增加下单流程，但现有约定只是展示网站。暂不需要支付，正式开通时间也可以等评估；仍需先确认接单提醒和订单处理方式，再判断周五能演示到哪一步。",
    suggestions: ["整理需要确认的问题", "写一段范围确认草稿"],
  },
  {
    key: "photo", title: "摄影交流小群", project: "photo", background: "摄影账号的读者交流群，常反馈手机拍摄中的具体问题。",
    messages: [
      ["阿禾", "晚上在客厅用手机拍孩子，一跑起来就糊，是不是得换相机呀？"],
      ["小鹿", "我也想问室内拍糊的问题。白天靠窗会好些，晚上不知道怎么调。"],
      ["阿禾", "能不能讲讲怎么区分光线不够和孩子动太快？想先用手里的手机试试。"],
    ],
    summary: "两位读者提到室内拍糊，想先改善现有手机的拍摄方法。",
    topic: "室内拍糊可以作为下一个选题",
    opener: "两位读者都提到室内拍糊，阿禾希望先用现有手机改善。这和账号先讲方法的定位一致，可以放进候选；本周相机对比的排期先保持不变。",
    suggestions: ["整理一个拍摄提纲", "放进候选选题"],
  },
];

/** Only call on a separate, empty demo runtime. It never clears or reads a real workspace. */
export function seedWorkspaceDemo(runtime: OrbitRuntime): void {
  const { store } = runtime;
  if (store.metadata(workspaceDemoMarker)) return;
  const mainId = store.metadata<string>("assistant:conversation:v1") || "orbit-assistant";
  const occupied = store.list("projects").length || store.list("messages").length || store.list("artifacts").length ||
    store.list("memories").length || store.list("sharedMemories").length || store.list("works").length ||
    store.list("objects").length || store.list("runs").length || store.list("triggers").length ||
    store.list("conversations").some(c => c.id !== mainId) || runtime.wechat.context.chats().length;
  if (occupied) throw new Error("演示数据只可初始化到独立的空工作空间。");
  const anchor = Date.now();
  const at = (hoursAgo: number, minute = 0) => new Date(anchor - hoursAgo * 3_600_000 + minute * 60_000).toISOString();

  store.transaction(() => {
    runtime.assistant.initialize();
    for (const [order, definition] of projects.entries()) {
      const project: Project = {
        id: workspaceDemoProjectId(definition.key), name: definition.name, summary: definition.summary,
        instructions: "", pinned: false, order, archived: false, createdAt: at(240), updatedAt: at(Math.min(...definition.conversations.map(c => c.hoursAgo))),
      };
      store.put("projects", project);
      store.put("sections", { id: `demo-section-${definition.key}`, name: project.name, pinned: false, order });
      for (const conversation of definition.conversations) {
        const conversationId = workspaceDemoConversationId(conversation.key);
        const lastAt = at(conversation.hoursAgo, conversation.rounds.length * 2 - 1);
        store.createConversation(conversation.title, {
          id: conversationId, projectId: project.id, project: project.name,
          goal: conversation.summary, summary: conversation.summary, createdAt: at(conversation.hoursAgo), updatedAt: lastAt,
        });
        const messages: Message[] = conversation.rounds.flatMap(([question, answer], index) => [
          { id: `${conversationId}-q${index + 1}`, conversationId, role: "user", content: question, createdAt: at(conversation.hoursAgo, index * 2) },
          { id: `${conversationId}-a${index + 1}`, conversationId, role: "assistant", content: answer, createdAt: at(conversation.hoursAgo, index * 2 + 1) },
        ]);
        for (const message of messages) store.put("messages", message);
        const source = recapSource(conversationId, messages, store.list("conversations"));
        const rounds = conversationRounds(conversationId, messages);
        const memory: ConversationMemory = {
          id: conversationId, conversationId, version: 1, status: "ready", summary: conversation.summary,
          coveredMessageId: messages.at(-1)!.id, updatedAt: lastAt,
          items: conversation.rounds.map(([, , , takeaway], index) => ({ id: `${conversationId}-memory-${index + 1}`, kind: "fact", text: takeaway, sourceIds: [messages[index * 2]!.id, messages[index * 2 + 1]!.id] })),
          discussion: { version: 1, status: "ready", turns: rounds.map((round, index) => ({ id: round.id, sourceKey: round.sourceKey, question: conversation.rounds[index]![2], answer: conversation.rounds[index]![3] })) },
          recap: validateRecap({ nodes: rounds.map((round, index) => ({ roundIds: [round.id], title: conversation.rounds[index]![2], summary: conversation.rounds[index]![3], takeaway: conversation.rounds[index]![3] })) }, source),
        };
        store.put("memories", memory);
        if (conversation.note) store.put("artifacts", {
          id: `${conversationId}-note`, conversationId, title: conversation.note.title,
          content: conversation.note.content, format: "markdown", updatedAt: lastAt,
        });
      }
      const document = runtime.projects.readDocument(project.id);
      runtime.projects.saveDocument(project.id, document.version, `${definition.memory}\n`);
    }

    // Main-origin history points at the canonical answer; there is only one stored answer.
    const cafeId = workspaceDemoConversationId("cafe-preview");
    const sourceQuestion = store.require("messages", `${cafeId}-q2`);
    const sourceAnswer = store.require("messages", `${cafeId}-a2`);
    const homeQuestionId = "demo-home-cafe-question";
    const historyRunId = "demo-history-cafe-preview";
    store.put("messages", { id: "demo-home-learning-question", conversationId: mainId, role: "user", content: "以后给我讲新概念，先用一个小例子，再说术语。", createdAt: at(25) });
    store.put("messages", { id: "demo-home-learning-answer", conversationId: mainId, role: "assistant", content: "好，先用具体例子把意思讲清楚，再补术语和适用条件。涉及不同项目的约定，我会分别保留。", createdAt: at(25, 1) });
    store.put("messages", { id: homeQuestionId, conversationId: mainId, role: "user", content: sourceQuestion.content, createdAt: sourceQuestion.createdAt });
    store.put("messages", { ...sourceQuestion, runId: historyRunId, handoff: { sourceConversationId: mainId, sourceMessageId: homeQuestionId, action: "resume" } });
    store.put("messages", { ...sourceAnswer, runId: historyRunId });
    store.updateConversation(mainId, { updatedAt: sourceAnswer.createdAt });
    const general = runtime.projects.readDocument();
    runtime.projects.saveDocument(undefined, general.version, "## 沟通偏好\n- 解释新概念时先用一个具体的小例子，再补术语和适用条件。\n- 回答先说关键结论，细节按需要展开。\n\n## 工作习惯\n- 同时推进个人项目和知识学习，希望延续已有讨论。\n- 每个项目的范围和决定分别记录，不把单个项目要求当成通用偏好。\n");

    for (const [index, definition] of contacts.entries()) {
      const externalId = `workspace-demo-${definition.key}`;
      runtime.wechat.context.import({ messages: definition.messages.map(([sender, text], i) => ({
        id: `${externalId}-${i + 1}`, chatId: externalId, chatTitle: definition.title, sender, text,
        direction: "incoming", timestamp: at(0.5 + index * 0.1, i),
      })) }, "import");
      const chat = runtime.wechat.context.chats().find(c => c.externalId === externalId)!;
      runtime.wechat.context.patch(chat.id, { enabled: true });
      const context: ContactContext = { chatId: chat.id, background: definition.background,
        projectId: workspaceDemoProjectId(definition.project), watching: false, version: 1 };
      store.db.prepare("INSERT INTO wechat_contact_context VALUES(?,?)").run(chat.id, JSON.stringify(context));
      const sources = runtime.wechat.context.read(chat.id).messages;
      const project = runtime.projects.get(context.projectId!);
      const background = { background: context.background, project: { name: project.name, summary: project.summary, memory: runtime.projects.readDocument(project.id).content.slice(0, 5000) } };
      const input = JSON.stringify({ ...background, messages: sources });
      const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex");
      const topic: WechatTopic & { backgroundFingerprint: string } = {
        id: `demo-topic-${definition.key}`, chatId: chat.id, summary: definition.summary, title: definition.topic,
        opener: definition.opener, suggestions: definition.suggestions, sources, status: "new",
        fingerprint: fingerprint(input), backgroundFingerprint: fingerprint(JSON.stringify({ projectId: context.projectId, ...background })),
        createdAt: sources.at(-1)!.timestamp,
      };
      store.db.prepare("INSERT INTO wechat_topics VALUES(?,?)").run(chat.id, JSON.stringify(topic));
    }
    store.setMetadata(workspaceDemoMarker, { version: 1, createdAt: new Date(anchor).toISOString(), synthetic: true });
  });
  runtime.changed();
}
