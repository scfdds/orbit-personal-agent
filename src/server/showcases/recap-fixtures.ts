// Generated with DeepSeek from authored samples, then reviewed for clarity and faithful source attribution.
import type { ConversationRecap } from "../../shared/types.ts";
export const recapFixtures: Record<string, ConversationRecap> = {
  "daily-ai-radar": {
    "sourceKey": "recap-v1:s0ndv1:daily-ai-radar-a2",
    "nodes": [
      {
        "id": "recap:daily-ai-radar-u1:daily-ai-radar-u2",
        "roundIds": [
          "daily-ai-radar-u1",
          "daily-ai-radar-u2"
        ],
        "title": "每天三条，只看值得关注的 AI 进展",
        "summary": "简报范围限定为模型、Agent 产品与开发者工具；优先官方博客、发布说明和 GitHub，同一事件合并，无重要变化不提醒。每条保留事件、原始链接、关注理由与试用价值。已确定筛选规则，尚未接入实时新闻。",
        "takeaway": "每天最多三条，合并重复事件并优先一手来源；目前确定了筛选规则，尚未接入实时新闻。"
      }
    ]
  },
  "daily-agent-products": {
    "sourceKey": "recap-v1:1nsq4ls:",
    "nodes": [
      {
        "id": "recap:daily-agent-products-u1:daily-agent-products-u2",
        "roundIds": [
          "daily-agent-products-u1",
          "daily-agent-products-u2"
        ],
        "title": "用真实任务检验 Agent 能力",
        "summary": "比较重点是能否接续上下文、执行中接受修改、让用户编辑产物，以及长任务中断后恢复。以同一组任务记录结果、人工接管点和复现步骤，并标注版本与日期；当前确定了评测方法，尚未形成产品评分。",
        "takeaway": "同一组任务检验上下文接续、途中修改、产物编辑与中断恢复；尚未形成产品评分。"
      }
    ]
  },
  "daily-semi": {
    "sourceKey": "recap-v1:1sgedeg:learning-main-a4,learning-main-a6",
    "nodes": [
      {
        "id": "recap:daily-semi-u1:daily-semi-u2",
        "roundIds": [
          "daily-semi-u1",
          "daily-semi-u2"
        ],
        "title": "一颗芯片如何成为产品",
        "summary": "设计决定功能，制造把电路做在晶圆上，封装与测试使其成为可用器件；设备与材料支撑这些环节。AI 服务器可以沿计算、存储与互连三条线理解，GPU、HBM 与先进封装各自承担不同角色。",
        "takeaway": "设计决定功能，制造形成电路，封装与测试把裸片变成可用器件。"
      },
      {
        "id": "recap:learning-main-u1:learning-main-u4",
        "roundIds": [
          "learning-main-u1",
          "learning-main-u2",
          "learning-main-u3",
          "learning-main-u4"
        ],
        "title": "GPU 计算，HBM 存数据，封装连接",
        "summary": "晶圆切割后得到裸片，裸片经封装与板卡集成才成为显卡。HBM 是独立制造的堆叠 DRAM，并非 GPU 内部缓存。“更大冰箱”只说明装得下，不保证搬得快；封装还承担供电、信号连接与散热。",
        "takeaway": "HBM 是独立的堆叠存储，并非 GPU 缓存；容量更大也不保证数据搬得更快。"
      },
      {
        "id": "recap:learning-main-u5:learning-main-u6",
        "roundIds": [
          "learning-main-u5",
          "learning-main-u6"
        ],
        "title": "有芯片不等于能交付系统",
        "summary": "CoWoS 是先进封装技术，HBM 是存储，两者不能当成同一指标。把 GPU 和 HBM 组合成产品，还需设计、互连、供电、散热、测试与工艺匹配；有封装设备不代表已经能交付这款产品。",
        "takeaway": "CoWoS 属于封装技术；GPU 与 HBM 还需互连、供电、散热及工艺匹配才能成为产品。"
      },
      {
        "id": "recap:learning-main-u7:learning-main-u8",
        "roundIds": [
          "learning-main-u7",
          "learning-main-u8"
        ],
        "title": "区分容量、性能与交付数量",
        "summary": "容量回答装多少，带宽回答搬多快，延迟回答等多久；封装产能回答一段时间能交付多少套。容量更大或产能更多，都不等于单机跑得更快。算力与带宽谁更重要，还取决于数据复用和具体负载。",
        "takeaway": "容量是装多少，带宽是搬多快，延迟是等多久；交付数量与单机性能也要分开。"
      }
    ]
  },
  "daily-macro": {
    "sourceKey": "recap-v1:1lje280:daily-macro-a2",
    "nodes": [
      {
        "id": "recap:daily-macro-u1:daily-macro-u2",
        "roundIds": [
          "daily-macro-u1",
          "daily-macro-u2"
        ],
        "title": "从支出、资金与价格理解宏观",
        "summary": "用“谁在支出、资金从哪里来、价格怎样变化”连接通胀、就业与利率。解释概念和预测市场要分开，读数据先核对口径与时间范围。接下来的讨论从名义利率、实际利率和借贷成本展开。",
        "takeaway": "用“谁在支出、资金从哪里来、价格如何变化”串起宏观概念，解释概念与预测市场要分开。"
      }
    ]
  },
  "daily-rates": {
    "sourceKey": "recap-v1:cwobqv:",
    "nodes": [
      {
        "id": "recap:daily-rates-u1:daily-rates-u1",
        "roundIds": [
          "daily-rates-u1"
        ],
        "title": "利率下降不必然立刻增加消费投资",
        "summary": "家庭和企业分开看：已有债务是否随利率下调而重定价、收入预期是否稳定、是否已有想买的东西或值得投入的项目。融资变便宜不等于大家马上多花多投。先用这些条件比较不同情境，再结合具体时期的数据判断。",
        "takeaway": "融资变便宜之后，是否多花多投还取决于债务重定价、收入预期和实际需求。"
      }
    ]
  },
  "daily-portfolio": {
    "sourceKey": "recap-v1:o7rb2b:daily-portfolio-a2",
    "nodes": [
      {
        "id": "recap:daily-portfolio-u1:daily-portfolio-u2",
        "roundIds": [
          "daily-portfolio-u1",
          "daily-portfolio-u2"
        ],
        "title": "持仓跟踪框架与提醒边界",
        "summary": "先用美光与标普500 ETF作示例建立观察框架，持续核对买入理由与事实，不计算真实收益、不展示实时价格。提醒只在重要财报、业务变化或原判断被推翻时触发，不用每日涨跌给建议；自动跟踪仍未开启。",
        "takeaway": "按买入理由与新证据跟踪，重要变化才提醒；持仓仍为示例，自动跟踪尚未开启。"
      }
    ]
  },
  "daily-portfolio-review": {
    "sourceKey": "recap-v1:1k6tinc:",
    "nodes": [
      {
        "id": "recap:daily-portfolio-review-u1:daily-portfolio-review-u1",
        "roundIds": [
          "daily-portfolio-review-u1"
        ],
        "title": "持仓复盘用四栏表区分原判断与新证据",
        "summary": "固定四栏：原判断、新证据、影响、下一步核对；没有新证据就保留空白，不为出报告而编造变化。后续可放入实际财报或公告逐条比对。",
        "takeaway": "固定记录原判断、新证据、影响与下一步核对；没有新证据就留空。"
      }
    ]
  },
  "daily-holiday": {
    "sourceKey": "recap-v1:1dmwyta:daily-holiday-a2,daily-holiday-a2",
    "nodes": [
      {
        "id": "recap:daily-holiday-u1:daily-holiday-u2",
        "roundIds": [
          "daily-holiday-u1",
          "daily-holiday-u2"
        ],
        "title": "国庆七天云南或柬埔寨比较",
        "summary": "七天假期倾向轻松、少换酒店。先按出发地、交通时间、移动次数、住宿预算与最想体验内容比较云南（大理、沙溪）与柬埔寨（暹粒吴哥）两条候选路线，暂不填未经核实的机票、酒店价格和入境要求，待出发城市确定后分头形成草案再决定。",
        "takeaway": "七天、少换酒店、轻松慢行；保留大理沙溪与暹粒吴哥两条路线，目的地尚未确定。"
      }
    ]
  },
  "daily-yunnan": {
    "sourceKey": "recap-v1:1866mpa:",
    "nodes": [
      {
        "id": "recap:daily-yunnan-u1:daily-yunnan-u2",
        "roundIds": [
          "daily-yunnan-u1",
          "daily-yunnan-u2"
        ],
        "title": "大理与沙溪，两个据点慢慢走",
        "summary": "云南草案最多住两个地方，抵达与返程单独留时间，中间保留空白。活动以散步、咖啡馆和摄影为主，减少早起与高强度徒步。出发城市、日期、预算及交通衔接仍待确定，尚未预订。",
        "takeaway": "最多住大理、沙溪两个据点，给抵返与自由活动留白；日期和交通仍待确定，尚未预订。"
      }
    ]
  },
  "daily-cambodia": {
    "sourceKey": "recap-v1:1duuzoa:",
    "nodes": [
      {
        "id": "recap:daily-cambodia-u1:daily-cambodia-u1",
        "roundIds": [
          "daily-cambodia-u1"
        ],
        "title": "以吴哥建筑与历史为主，留出休息",
        "summary": "暹粒方向围绕吴哥，避免把寺庙排满。路线取决于出发城市、日期、预算及愿意投入的参观时间；交通、门票、天气和入境要求仍需按出行时间核实。目前保留的是规划条件，还不是确定行程。",
        "takeaway": "以吴哥建筑与历史为主，避免寺庙排满；目前只是规划方向，交通与入境条件尚待核实。"
      }
    ]
  },
  "daily-sse": {
    "sourceKey": "recap-v1:td2vg2:",
    "nodes": [
      {
        "id": "recap:daily-sse-u1:daily-sse-u2",
        "roundIds": [
          "daily-sse-u1",
          "daily-sse-u2"
        ],
        "title": "SSE 和 WebSocket 的选型与断线恢复",
        "summary": "以服务端单向推送为主、客户端另发 HTTP 提交消息时，可先用 SSE，需要持续双向消息再考虑 WebSocket。SSE 需处理重连、事件编号与重复消息：重连带上最后收到的事件位置，服务端保留可回放记录并给当前执行状态兜底，恢复时对齐 runId 与事件编号，避免旧流混入新执行。",
        "takeaway": "单向推送可先用 SSE，持续双向通信再考虑 WebSocket；断线恢复要对齐执行与事件编号。"
      }
    ]
  },
  "daily-git": {
    "sourceKey": "recap-v1:1tq44gz:",
    "nodes": [
      {
        "id": "recap:daily-git-u1:daily-git-u1",
        "roundIds": [
          "daily-git-u1"
        ],
        "title": "Git worktree 与分支的区别",
        "summary": "分支记录一条开发线，worktree 提供另一份工作目录，可让两个目录分别检出不同分支、各自编辑运行。对同时改两个互不相关功能的场景，放在不同目录能避免来回切换时处理未提交改动；合并时仍要检查是否改了同一处逻辑。",
        "takeaway": "分支记录开发线，worktree 提供独立工作目录，可同时编辑、运行不同分支。"
      }
    ]
  },
  "daily-packing": {
    "sourceKey": "recap-v1:18upuqi:",
    "nodes": [
      {
        "id": "recap:daily-packing-u1:daily-packing-u1",
        "roundIds": [
          "daily-packing-u1"
        ],
        "title": "国庆旅行清单：出行前待核对",
        "summary": "需带证件、相机、备用电池、充电设备和转换插头，已整理成待核对清单。目的地和航班未定，插头规格、行李及电池携带规则待行程确定后核对，候选目的地不算已确认行程。",
        "takeaway": "证件、相机与充电设备已列入清单；插头规格和电池携带规则待行程确定后核对。"
      }
    ]
  },
  "learning-hbm-concepts": {
    "sourceKey": "recap-v1:15y19ds:learning-hbm-concepts-a4",
    "nodes": [
      {
        "id": "recap:learning-hbm-concepts-u1:learning-hbm-concepts-u2",
        "roundIds": [
          "learning-hbm-concepts-u1",
          "learning-hbm-concepts-u2"
        ],
        "title": "等待第一份数据，与持续搬运的速度",
        "summary": "假设甲为 80 GB、2 TB/s，乙为 160 GB、1 TB/s：60 GB 数据都装得下，但甲带宽更高；100 GB 时甲装不下。延迟是一次请求的等待，传输时间还受数据量与带宽影响，不能把“搬完 1 TB 的时间”当作延迟。",
        "takeaway": "延迟是一次请求的等待，带宽是持续传输的速度；搬完一批数据的总时间不等于延迟。"
      },
      {
        "id": "recap:learning-hbm-concepts-u3:learning-hbm-concepts-u4",
        "roundIds": [
          "learning-hbm-concepts-u3",
          "learning-hbm-concepts-u4"
        ],
        "title": "容量扩展与带宽扩展是两套约束",
        "summary": "堆更多 DRAM 可以增容量，但带宽还由接口宽度、传输速率与利用率决定。算术强度是运算次数与数据流量之比，描述负载如何使用数据；它不是 GPU 的固定属性，数据复用会改变瓶颈。",
        "takeaway": "堆更多 DRAM 能增加容量；带宽还取决于接口与速率，数据复用会影响性能瓶颈。"
      },
      {
        "id": "recap:learning-hbm-concepts-u5:learning-hbm-concepts-u5",
        "roundIds": [
          "learning-hbm-concepts-u5"
        ],
        "title": "模型装得下，仍可能在等数据",
        "summary": "容量足够只是能容纳工作数据，速度仍可能受访存、延迟或计算上限约束。判断模型为什么慢，需要测量具体负载，不能仅凭容量或单个硬件指标下结论。",
        "takeaway": "装得下只是容量够；具体速度还可能受带宽、延迟或算力限制，需要结合负载测量。"
      }
    ]
  },
  "learning-roofline-example": {
    "sourceKey": "recap-v1:y9h0p3:",
    "nodes": [
      {
        "id": "recap:learning-roofline-example-u1:learning-roofline-example-u2",
        "roundIds": [
          "learning-roofline-example-u1",
          "learning-roofline-example-u2"
        ],
        "title": "算力与供数能力，取较小的上界",
        "summary": "假设算力 100 TFLOP/s、带宽 2 TB/s、算术强度 10 FLOP/Byte，性能上界为 min(100, 2×10)=20 TFLOP/s。算力翻倍仍为 20；若强度升到 80，则原 GPU 的计算上限 100 成为约束。这是简化算例，非实测。",
        "takeaway": "简化算例中，性能上界取 min(算力, 带宽 × 算术强度)；带宽受限时只加算力无效。"
      },
      {
        "id": "recap:learning-roofline-example-u3:learning-roofline-example-u4",
        "roundIds": [
          "learning-roofline-example-u3",
          "learning-roofline-example-u4"
        ],
        "title": "同一个模型也会切换瓶颈",
        "summary": "分界强度为算力÷带宽，算例中是 50 FLOP/Byte：低于它先受带宽限制，高于它先受计算上限限制。模型阶段、批量与实现都会改变数据复用；计算字节数时还需明确存储层级，实际性能可能更低。",
        "takeaway": "阶段、批量与实现会改变数据复用，因此同一个模型也可能在计算与带宽瓶颈间切换。"
      }
    ]
  },
  "learning-packaging-chain": {
    "sourceKey": "recap-v1:1oabi2j:",
    "nodes": [
      {
        "id": "recap:learning-packaging-chain-u1:learning-packaging-chain-u2",
        "roundIds": [
          "learning-packaging-chain-u1",
          "learning-packaging-chain-u2"
        ],
        "title": "封装承担集成，不只是保护外壳",
        "summary": "制造在晶圆上形成器件与电路；封装把裸片连成可用器件或系统。CoWoS 等先进封装还承担逻辑芯片、HBM 与高密度互连的集成，不能一概视作低技术后道；也并非所有产品都需要同一种封装。",
        "takeaway": "先进封装连接裸片、存储与互连，承担系统集成，不能一概理解成给芯片加外壳。"
      },
      {
        "id": "recap:learning-packaging-chain-u3:learning-packaging-chain-u5",
        "roundIds": [
          "learning-packaging-chain-u3",
          "learning-packaging-chain-u4",
          "learning-packaging-chain-u5"
        ],
        "title": "单机跑多快，与能交付多少套",
        "summary": "假设每套需 1 颗逻辑芯片、4 组存储、1 个封装名额：100、240、80 的配套最多组成 60 套，只扩封装无效；存储增至 400 后上限才到 100 套。这个算例研究交付数量，算力与带宽算例研究单机性能。",
        "takeaway": "假设每套需 1 颗芯片、4 组存储、1 个封装名额，100、240、80 的配套只能交付 60 套。"
      }
    ]
  }
};
export const recapTopicFixtures = {
  "AI 动态": {
    "text": "讨论形成了两套判断标准：用每天三条、一手来源、同事件去重来筛选 AI 进展；用真实任务检验 Agent 的上下文延续、共享状态与中断恢复。目前确定了关注范围和评测方法，尚未接入实时新闻或完成产品评测。",
    "sourceKey": "3271cf9c85d204a7db9cfd67e960dad335a1fc7a4802836e48178d5632ac597c",
    "updatedAt": "2026-09-25T15:51:59.141Z"
  },
  "学习与研究": {
    "text": "半导体学习从设计、制造、封装的分工，深入到 GPU 与 HBM 如何配合。几轮澄清把容量、带宽、延迟和交付数量分开，并用假设算例理解性能与产能瓶颈。另一条主线讨论宏观金融：融资变便宜，不代表消费与投资会立即增加。",
    "sourceKey": "dcd74336959b85ecc26d7c98a85950b37b1211c33073ee904f2c65b284b3f3ad",
    "updatedAt": "2026-09-25T15:52:00.464Z"
  },
  "投资观察": {
    "text": "持仓讨论确定了以买入理由和新证据为核心的跟踪方式，减少每日涨跌的干扰；复盘用原判断、新证据、影响和下一步核对四栏。美光与标普 500 ETF 目前仅作示例，真实持仓和自动跟踪尚未接入。",
    "sourceKey": "9850db38b354706dca519a7364fdc0f36f04f47dd1e1f37389f96b40dc0c72ba",
    "updatedAt": "2026-09-25T15:52:01.729Z"
  },
  "国庆旅行": {
    "text": "七天假期保留云南与柬埔寨两条候选路线，共同偏好是少换酒店、轻松慢行。云南围绕大理与沙溪，暹粒围绕吴哥建筑与历史。目的地尚未确定，也未预订；出发城市、日期与预算仍影响最后选择。",
    "sourceKey": "74d15879f77f1262f85622ff0ac7235d85d0688b844a65c6ba188fc5dcd81e14",
    "updatedAt": "2026-09-25T15:52:03.147Z"
  },
  "日常随问": {
    "text": "技术讨论确定了 Agent 流式回复先用 SSE，并用事件编号与状态回放处理断线；也厘清了分支与 worktree 的区别。另整理了旅行随身清单，具体行李与电池规则仍待目的地和航班确定后核对。",
    "sourceKey": "b85810388c34d3e118044a15255ad638c19bf18333917d8d3a36e6a6ff8f3242",
    "updatedAt": "2026-09-25T15:52:04.345Z"
  }
};
