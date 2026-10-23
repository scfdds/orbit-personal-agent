/** Authored overviews of what these sample conversations actually contain. */
export const everydaySummaries: Record<string, string> = {
  'daily-ai-radar': 'AI 简报的关注范围已确定为模型发布、Agent 产品和开发者工具，每次最多三条。同一发布合并，优先引用官方博客、发布说明和 GitHub。模型基准成绩与实际使用体验分开评价。目前只讨论了筛选标准，尚未接入实时新闻或开启定时抓取。',
  'daily-agent-products': '比较 Agent 产品，功能表之外还要看同一任务能否真正完成。讨论确定了四类体验：整理资料、续接上次工作、中途修改要求、手动编辑产物。关键差异在上下文是否延续、GUI 和 Agent 是否共用状态、长任务能否恢复；尚未选定具体产品，也没有实测评分。',
  'daily-semi': '一颗芯片的生产过程包含设计、晶圆制造、封装和测试；设备与材料为这些环节提供生产条件。讨论引出了 AI 服务器中的计算、存储和互连分工，但尚未具体解释 GPU、HBM 与先进封装的关系。',
  'daily-macro': '宏观经济可以从支出、资金来源和价格变化三条线联系起来，再放入通胀、就业与利率。读数据需要先看统计口径与时间范围，单一指标不能直接推出市场涨跌。这段对话只确定了学习框架，名义利率和实际利率尚未展开。',
  'daily-rates': '利率下降不一定马上增加消费和投资。家庭是否多花钱，取决于债务能否重定价、收入预期和消费需求；企业是否扩张，还取决于有没有值得投入的项目。“融资便宜了”与“愿意增加支出”是两个条件，不能直接画等号。',
  'daily-portfolio': '持仓讨论确定了四项记录：持仓信息、买入理由、待核对事实和复盘时间。关注财报与业务变化是否改变原判断，不按日常涨跌反复给建议。美光与标普 500 ETF 只是示例观察对象，实际数量、成本和资料来源未录入，自动跟踪也未开启。',
  'daily-portfolio-review': '复盘表采用四栏：原判断、新证据、影响、下一步核对。原判断作为比较基准保留；新证据说明发生了什么变化。没有证据时留空，不为了交一份报告编造结论。目前还没有代入实际财报或公告。',
  'daily-holiday': '国庆旅行保留云南和柬埔寨两个候选，约七天，偏好少换酒店、留休息时间。云南讨论大理与沙溪，柬埔寨讨论暹粒与吴哥；两条路线分别展开后再比较。出发地、日期与预算尚未确定，没有预订，也没有核实价格和入境信息。',
  'daily-yunnan': '云南草案以大理与沙溪为两个住宿据点，抵达和返程单独留时间。活动偏向散步、咖啡馆和摄影，避开高强度徒步与每天早起赶景点。具体交通衔接仍取决于出发城市、日期和预算，当前没有形成已订行程。',
  'daily-cambodia': '暹粒方向以吴哥建筑和历史为重点，寺庙不密集排满，保留休息和机动时间。讨论列出了制定行程前缺少的信息：出发地、日期、预算和参观深度。交通、门票、天气与入境要求尚未核实。',
  'daily-sse': 'SSE 适合服务端持续推送回复，客户端用普通 HTTP 提交消息；WebSocket 更适合持续双向通信。当前浏览器与 Node 的对话流选择 SSE。后台返回后的恢复依靠事件编号、有限回放和当前执行状态，并用 runId 区分旧流与新执行，防止遗漏或重复。',
  'daily-git': '分支是一条开发线，worktree 是另一份工作目录。两个 worktree 可以分别检出不同分支，同时编辑和运行，减少切换时处理未提交改动的负担。目录隔离不会消除合并冲突：两个功能仍可能修改同一处逻辑。',
  'daily-packing': '随身清单包含证件、相机、备用电池、充电设备和转换插头。目的地与航班尚未确定，因此插头规格、行李额度及电池携带规则还没有核实。',
};

export function upgradeReaderSummaries(store: import('../store.ts').OrbitStore) {
  if (store.metadata('showcase:reader-summaries:v1')) return;
  store.transaction(() => {
    for (const [id, summary] of Object.entries(everydaySummaries)) {
      const c = store.get('conversations', id), m = store.get('memories', id);
      const messages = store.list('messages').filter(msg => msg.conversationId === id);
      // Only migrate the original authored samples; never overwrite a live or edited summary.
      if (!c?.showcase || !m || m.version !== 1 || m.summaryEdited || m.items.some(i => i.edited || i.deleted)
        || messages.some(msg => !new RegExp(`^${id}-[ua]\\d+$`).test(msg.id))
        || messages.at(-1)?.id !== m.coveredMessageId) continue;
      store.put('memories', { ...m, summary, version: m.version + 1 });
      store.updateConversation(id, { summary });
    }
    store.setMetadata('showcase:reader-summaries:v1', true);
  });
}
