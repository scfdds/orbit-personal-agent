import { OrbitStore, now } from "../store.ts";
import type { Artifact, Conversation, ConversationMemory, Message } from "../../shared/types.ts";

export const desktopExamplesMarker = "showcase:desktop-examples:v1";
const notice = "这是用于体验产品的示例对话，不代表你的真实经历；没有进行预订、联系客户或设置提醒。可在事项菜单中删除。";

interface DesktopExample {
  id: string;
  title: string;
  goal: string;
  summary: string;
  rounds: Array<[string, string]>;
  artifactTitle: string;
  artifactContent: string;
}

const examples: DesktopExample[] = [
  {
    id: "desktop-example-hangzhou",
    title: "周末杭州旅行准备",
    goal: "安排一次从上海出发的双人杭州周末旅行，节奏宽松，总预算不超过 2,000 元。",
    summary: "背景：两人从上海去杭州过周末。已确定：预算合计 2,000 元以内，偏好西湖散步、咖啡和本地小馆，避免赶景点；暂按周六出发、周日返回规划。下一步：确定具体周末，再核对车次、房价和天气；尚未预订。",
    rounds: [
      ["想和朋友去杭州过个周末，从上海出发，两个人一共控制在 2,000 元以内。别安排太满。", "先按周六出发、周日返回留一晚，重点放在西湖散步和附近吃饭。2,000 元先作为两人总预算，具体周末还没确定，因此先留出预算和路线框架，不填未经核对的票价。"],
      ["我们喜欢散步、咖啡和本地小馆，不太想排热门店，也不想一天跑很多地方。", "那每天只保留一个主要区域：第一天抵达后在西湖周边慢慢走，第二天留给一段散步和咖啡，再返程。吃饭优先就近、不排长队；下雨时把户外安排缩短。"],
      ["预算怎么分？住得方便比酒店好看重要。", "可以先留交通 400 元、住宿 600 元、餐饮 500 元、市内交通及咖啡 250 元、机动 250 元。这是预算分配，不是实时报价。住宿优先考虑公共交通方便、去西湖不折腾的位置，选定日期后再比较。"],
      ["先整理成一张准备清单，等我们定了哪个周末再往下做。", "清单已整理：先确定具体日期，再核对往返车次、住宿价格和天气，最后按抵达与返程时间调整路线。当前没有任何预订；下一步只需要告诉我你们选定的周末。"],
    ],
    artifactTitle: "杭州周末旅行准备清单",
    artifactContent: `# 杭州周末旅行准备清单

> 示例资料。预算为规划额度，价格、车次与天气尚未查询，没有产生预订。

## 已确定
- 2 人，从上海出发；暂按周六去、周日回，住 1 晚。
- 总预算不超过 2,000 元。
- 偏好散步、咖啡、本地小馆；不赶景点，不排长队。
- 住宿以交通方便为主。

## 预算草案
| 项目 | 两人合计额度 |
| --- | ---: |
| 往返交通 | 400 元 |
| 一晚住宿 | 600 元 |
| 餐饮 | 500 元 |
| 市内交通与咖啡 | 250 元 |
| 机动 | 250 元 |
| 合计 | 2,000 元 |

## 路线框架
- 第一天：抵达、放行李，在西湖周边散步，就近吃饭。
- 第二天：按返程时间安排散步和咖啡，留足去车站的时间。
- 雨天：减少户外路程，保留可随时调整的室内休息时间。

## 下一步
- [ ] 确定具体周末。
- [ ] 核对可用车次、酒店房价与天气。
- [ ] 再确定住宿、抵达时间与返程时间。
`,
  },
  {
    id: "desktop-example-client-proposal",
    title: "客户官网改版方案",
    goal: "为一个小团队准备客户官网改版提案，先确认范围和依赖，再给出报价。",
    summary: "背景：小团队准备一份客户官网改版提案。已确定：首期包含首页、服务介绍、案例页和联系表单；移动端可用，由客户提供文案和图片；暂不做会员、支付或多语言。下一步：确认案例数量、素材交付与维护范围，再估算工期和报价；方案尚未发给客户。",
    rounds: [
      ["我们是个小团队，要给一个客户准备官网改版方案。客户希望服务介绍更清楚，也方便访客留联系方式。", "先围绕这两个目标确定首期范围：首页、服务介绍、案例页和联系表单。方案中把每个页面解决的问题写清楚，暂时不把尚未提出的功能算进去。"],
      ["客户自己提供文案和图片，手机上也要好用。第一版不用会员、支付和多语言。", "已把这些列为范围和依赖：支持移动端；客户提供可用素材；会员、支付、多语言不在首期。联系表单还要确认收件方式，以及是否需要后台查看提交记录。"],
      ["客户问大概要多少钱。我们还不知道案例有多少，后续维护是不是我们来做。", "这两项会影响工作量，现在不宜给确定报价。先列出待确认项：案例数量与录入方式、素材是否齐全、表单收件方式、上线后的维护责任。等范围确认，再按设计、开发和内容整理分别估算。"],
      ["整理一份内部讨论稿，先不要发给客户。", "已整理内部讨论稿，包含目标、首期范围、双方需要提供的内容和报价前的问题。下一步先内部核对遗漏，再向客户确认范围；当前没有给出承诺报价，也没有发送任何内容。"],
    ],
    artifactTitle: "官网改版方案 · 内部讨论稿",
    artifactContent: `# 官网改版方案 · 内部讨论稿

> 示例资料，使用虚构的客户需求，不包含真实客户信息；尚未发送给客户。

## 目标
让访客更容易理解服务，并留下联系信息。

## 首期范围
- 首页：介绍主要服务与联系入口。
- 服务介绍：清楚说明服务内容。
- 案例页：展示客户提供的案例。
- 联系表单：收集必要的联系信息，收件方式待确认。
- 移动端布局与基本使用体验。

## 已确定的边界
- 客户提供文案、图片及使用授权。
- 首期不包含会员、支付和多语言。
- 当前只准备方案，没有承诺价格或交付日期。

## 报价前需要确认
- [ ] 案例数量及是否需要客户自行新增。
- [ ] 素材是否齐全，谁负责最终校对。
- [ ] 表单如何收件，是否需要后台管理。
- [ ] 域名、部署环境及现有网站迁移需求。
- [ ] 上线后维护由谁承担，包含哪些内容。

## 下一步
先内部核对范围，再向客户确认上述问题；确认后分别估算设计、开发、内容整理与维护成本。
`,
  },
  {
    id: "desktop-example-english",
    title: "每周英语口语练习",
    goal: "用每个工作日 20 分钟练习英语工作表达，从简短介绍逐步到说明观点。",
    summary: "背景：希望在工作交流中更自然地用英语介绍自己、说明进展。已确定：每个工作日 20 分钟，以短口语练习为主；本周先练自我介绍和项目进展。阶段进展：示例中已拆好练习主题和自查方式，尚未记录真实打卡。下一步：写一段自己的 60 秒介绍，完成一次录音后再调整难度。",
    rounds: [
      ["想把英语口语捡起来，主要是工作里能介绍自己、说清楚项目进展。每天大概 20 分钟。", "先用短练习建立节奏：选一个工作话题，准备要点，讲一遍，再听录音修改。第一阶段不用追求复杂词汇，重点是让对方听懂你做什么、进展如何。"],
      ["工作日可以练，周末先不安排。别给我排太多背单词任务。", "按每个工作日 20 分钟：3 分钟回顾、5 分钟准备、8 分钟表达和录音、4 分钟自查。本周围绕自我介绍、工作内容和项目进展，不单独安排大量背词。"],
      ["怎么知道有没有进步？我不想只看连续打卡天数。", "每次保留一段录音，并记下一个卡住的表达。自查三点：重点是否完整、停顿是否影响理解、能否换一种说法。用同一个题目的前后录音比较，比只数天数更有帮助。"],
      ["先把这一周的安排和第一次要做什么写下来。", "计划已整理。第一次只做 60 秒自我介绍：你负责什么、经常解决什么问题、最近在推进什么。先写自己的要点，再录一遍；这份示例没有真实练习记录，也没有创建提醒。"],
    ],
    artifactTitle: "一周英语口语练习计划",
    artifactContent: `# 一周英语口语练习计划

> 示例计划。练习主题和自查方式已整理，尚未记录真实完成情况，也未创建定时提醒。

## 目标与节奏
在工作交流中清楚地介绍自己、说明进展和表达观点。每个工作日 20 分钟，周末不安排。

| 练习 | 主题 | 输出 |
| --- | --- | --- |
| 第一次 | 介绍自己与职责 | 一段 60 秒录音 |
| 第二次 | 描述常见工作 | 说明一个日常任务 |
| 第三次 | 汇报项目进展 | 已完成、正在做、遇到的问题 |
| 第四次 | 解释一个选择 | 观点和两个理由 |
| 第五次 | 重讲第一次的主题 | 对比两次录音 |

## 每次 20 分钟
1. 回顾上次卡住的表达：3 分钟。
2. 写下本次要点：5 分钟。
3. 开口表达并录音：8 分钟。
4. 回听并记录一个改进点：4 分钟。

## 自查
- 重点是否完整？
- 停顿是否影响理解？
- 不会某个词时，能否换一种说法？

## 当前进展与下一步
计划已完成，实际练习尚未开始。先准备自己的 60 秒介绍，完成第一段录音后，再根据实际难点调整后面的内容。
`,
  },
];

export interface DesktopExamplesResult {
  created: string[];
  skipped: string[];
}

/** Explicit opt-in only. No module side effects, background runs, or automatic restoration. */
export function seedDesktopExamples(store: OrbitStore): DesktopExamplesResult {
  const allIds = examples.map(example => example.id);
  if (store.metadata(desktopExamplesMarker)) return { created: [], skipped: allIds };

  return store.transaction(() => {
    const timestamp = now();
    const result: DesktopExamplesResult = { created: [], skipped: [] };
    for (const example of examples) {
      // An existing conversation owns all its child records, even if it shares an example ID.
      if (store.get("conversations", example.id)) {
        result.skipped.push(example.id);
        continue;
      }

      const artifactId = `${example.id}-note`;
      const messages: Message[] = example.rounds.flatMap(([question, answer], round) => [
        { id: `${example.id}-user-${round + 1}`, conversationId: example.id, role: "user" as const, content: question, createdAt: timestamp },
        { id: `${example.id}-assistant-${round + 1}`, conversationId: example.id, role: "assistant" as const, content: answer, createdAt: timestamp },
      ]);
      const memory: ConversationMemory = {
        id: example.id,
        conversationId: example.id,
        version: 1,
        status: "ready",
        summary: `示例资料。${example.summary}`,
        coveredMessageId: messages.at(-1)!.id,
        updatedAt: timestamp,
        items: example.rounds.map(([, answer], index) => ({
          id: `${example.id}-memory-${index + 1}`,
          kind: index === example.rounds.length - 1 ? "question" : "decision",
          text: answer,
          sourceIds: [`${example.id}-assistant-${index + 1}`],
        })),
      };
      const artifact: Artifact = {
        id: artifactId,
        conversationId: example.id,
        title: example.artifactTitle,
        content: example.artifactContent,
        format: "markdown",
        updatedAt: timestamp,
      };
      if (messages.some(message => store.get("messages", message.id)) ||
          store.get("memories", memory.id) || store.get("artifacts", artifact.id)) {
        throw new Error("体验示例记录冲突；未覆盖现有数据。");
      }
      const conversation: Conversation = store.createConversation(example.title, {
        id: example.id,
        project: "体验示例",
        goal: example.goal,
        summary: example.summary,
        status: "idle",
        showcase: { title: "示例", period: "体验内容", notice },
        createdAt: timestamp,
        updatedAt: timestamp,
        panel: { kind: "artifact", artifactId },
      });
      for (const message of messages) store.put("messages", message);
      store.put("memories", memory);
      store.put("artifacts", artifact);
      result.created.push(conversation.id);
    }
    store.setMetadata(desktopExamplesMarker, true);
    return result;
  });
}
