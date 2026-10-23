import type { Conversation, Message } from '../../shared/types.ts';
import { conversationRounds, sourceKey, validTurn } from '../../shared/discussion.ts';
import { recapSource, validateRecap } from '../../shared/recap.ts';
import { OrbitStore } from '../store.ts';
import { SectionService } from '../sections.ts';
import { TopicOverviewService } from '../topic-overview.ts';
import { everydaySummaries } from './reader-summaries.ts';
import { recapFixtures } from './recap-fixtures.ts';
import { aiNewsRecaps, aiNewsOverview } from './ai-news-fixtures.ts';
import { aiNewsTurns } from './ai-news-turns.ts';

const marker = 'showcase:ai-news:v1';
type Turn = [question: string, answer: string];
const mcpSource = '[MCP 最初发布说明 · 2024-11-25](https://www.anthropic.com/news/model-context-protocol)';
const appsSource = '[MCP Apps 发布说明 · 2026-01-26](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/)';

// Authored follow-ups. The dated release is real; trials and cost figures are explicitly hypothetical.
const news: Turn[] = [
  ['先拿一条真实发布练习一下吧。看到 MCP Apps 这个名字，我第一反应是 MCP 又改名了？',
   `没有改名。MCP 是连接 AI 应用与外部工具、数据的协议；MCP Apps 是在它上面增加交互界面的扩展。\n\n可以把这条新闻压成一句：**工具除了返回数据，还可以提供在对话中操作的界面。** 这不是一次“模型变聪明了”的发布，变化在用户怎样参与工作。这里读的是 2026 年 1 月 26 日的历史发布，不是今日新闻。\n\n${mcpSource} · ${appsSource}`],
  ['所以以后接了 MCP 的产品，就都能直接展示这种应用了？',
   '还不能这样推。需要分开三层：协议定义了什么、某个客户端实现了什么、具体工具能否在那个客户端跑通。\n\n发布扩展，只能直接证明第一层。判断某个产品可用，还要看对应版本、工具实现和实际交互。新闻里“支持 MCP”这几个字，不足以回答它是否支持交互应用。\n\n这个区别值得单独展开：界面究竟改变了什么，和只返回文本有什么差别。'],
  ['那模型榜单刷新和这种产品发布，我应该优先看哪个？感觉每天都是“能力又提升了”。',
   '先看它会不会改变你实际完成一件事的方式。\n\n如果你主要做资料研究，值得追问的是：来源能否核对、表格能否修改、补充资料后能否接着做。榜单成绩可以提供线索，但不能直接替代这些问题；比较时还要知道任务、工具、重试次数和预算是否一致。\n\n一次没有刷新榜单的改动，如果解决了“我改完表格，Agent 继续用旧数据”的问题，对你可能更有价值。'],
  ['API 降价应该最容易判断吧？单价便宜一半，我做同一件事的成本就便宜一半。',
   '只有用量、重试和结果质量都差不多时，才能这么算。做一道假设题：方案甲每次尝试花 1 元，十个任务全部一次通过验收，总共 10 元；方案乙每次尝试 0.5 元，但重试后共跑了 24 次才全部通过，总共 12 元。\n\n这里乙的单次价格更低，完成这批任务的费用却更高；还没计入工具费与人工核对时间。关注“完成同一件事花多少”，比只看每百万 token 单价更接近你的使用体验。数字仅为算例。'],
  ['我试着筛三条假设消息：榜单高了两分、交互表格可以边改边继续、API 单价减半。按我的需求，先试表格，降价放观察，榜单先略过？',
   '这个排序适合你现在的资料研究场景，但每条都要留一个验证问题。\n\n| 候选变化 | 暂时判断 | 缺少的证据 |\n| --- | --- | --- |\n| 编辑表格后继续工作 | 优先试用 | Agent 是否读到修改并保留它 |\n| API 单价减半 | 小样本比较 | 同一任务的总费用、重试与结果质量 |\n| 榜单提高两分 | 暂不优先 | 测试条件，以及和你的任务有何关系 |\n\n这三条是练习用的假设消息；不是今天发生的三个发布，也没有据此给真实产品打分。'],
  ['懂了。那以后小版本更新都跳过，只保留这种大变化就好。',
   '“小版本”不等于“小影响”。接口不兼容、常用功能修复，或你正在用的调用方式涨价，都可能比一次大发布更直接。\n\n筛选标准可以收敛为：**有没有改变我的能力边界、使用成本或已有工作是否还能继续。** 每条简报只留下变化、来源、与当前任务的关系、值得验证的问题；相同事件合并，没有重要变化就不占一条。我们确定了判断方法，尚未开启抓取或自动提醒。'],
];

const products: Turn[] = [
  ['我只想花半小时试一个产品，给我一个具体任务吧。不要再列一堆评测维度了。',
   '用“把三份发布材料整理成一张可核对的比较表”作为固定任务。材料由你提供，比较发布了什么、可用范围、限制和原始出处；某份材料没提到的地方应留空，不能猜。\n\n第一步生成表格；第二步你手动纠正一格；第三步补进第四份材料，让它更新。完成标准是：出处能回到原文，新材料加进来，旧的人工修改仍然有效。\n\n这样半小时里看到的是一件工作怎样推进，而不是聊天是否流畅。'],
  ['如果它会生成很漂亮的表格，我还能改，应该就说明这个应用做得不错了吧？',
   '还差最关键的一步：**你改完之后，它是否按新的状态继续。**\n\n例如把“已开放”改成“仅预览”，然后要求重新筛选可用产品。如果 Agent 仍将它列为已开放，界面虽然可编辑，协作却没有闭环。\n\n可以从这一步单独分支，看看“界面能改”和“人与 Agent 在同一份结果上工作”之间的区别。'],
  ['再加一个中断测试：关掉页面过一会儿回来，它还能做。这样就算长程任务支持好了？',
   '需要分清页面关闭和执行中断。关页面后后台一直运行，只说明它不依赖这个页面保持打开；执行进程真的停下、回来能接着做，才检验恢复能力。\n\n在这张比较表上，可以观察：已核对的三份材料是否保留，第四份材料是不是从正确的位置继续，已完成的写入是否重复发生。只展示“回来了”，没有显示恢复到哪里，还不能得出可靠续接的结论。'],
  ['最后怎么评价？我不太想做一个看起来很专业、实际没意义的总分。',
   '留一张简短的证据表就够了：\n\n- 来源：每个结论能否定位到材料原文。\n- 修改：人工改过的单元格，后续更新是否保留。\n- 续接：中断前后的结果是否连续，有没有重复和遗漏。\n- 代价：用了多久、多少费用、在哪些地方需要接管。\n\n先记录“完成 / 需要接管 / 未完成”和原因，不强行合成总分。一次通过仍然只是一次观察；用相同输入多跑几次，才有依据讨论稳定性。这里形成的是试用方案，尚未实际评测任何产品。'],
];

const protocol: Turn[] = [
  ['接着刚才那条 MCP Apps 发布。原来 MCP 工具能返回结果，现在只是给结果加了个网页吗？',
   `多了一个用户可以直接操作的入口。以前查到数据后，你通常还要用下一条消息描述筛选条件；交互界面可以承载表格筛选、选中和修改，再把相关操作带回工具与对话。\n\n发布说明讲的是在支持的宿主中呈现工具提供的交互界面。这并不表示每个工具都应该做网页，也不表示任意网页都自动获得对话上下文。${appsSource}`],
  ['那它和 Agent 用浏览器点一个现成的网站，有什么本质差别？',
   '从接入方式看，浏览器操作面对的是网站已有的页面与控件；协议内的应用可以显式提供工具、数据和交互入口，由宿主把它们放在同一工作过程中。\n\n比如核对发布信息，用户在表格里选中两条，Agent 继续比较这两条。如果改用外部网站，同样也可能完成，但还要看页面状态如何被读取和带回。不能仅凭一种接入方式，就断定所有任务上谁更可靠。'],
  ['如果 UI 的操作能传回对话，用户改过的内容就肯定会成为 Agent 的依据了吧？',
   '协议提供沟通通道，具体应用仍要用对它。一个按钮只在本地改了显示，没有保存或告诉后续执行，Agent 就可能继续读旧结果。\n\n以“仅预览”那一格为例，至少要确认修改写入了当前记录，后续读取拿到的是新值，重新生成时也没有把人工判断覆盖掉。**能传递状态，是条件；实际遵守修改，是需要验证的行为。**'],
  ['听起来有 GUI 就更好了？我每天看三条新闻，也应该做个应用界面？',
   '三条新闻如果只是阅读和点开来源，清晰的文字就够用。需要反复筛选、并排比较、逐项确认或编辑时，界面才更有价值。\n\n所以这条发布值得关注的，是它扩展了哪些协作方式；不是把所有回答都变成界面。你的简报可以保持文字，进入产品试用时再打开可编辑的比较表。'],
  ['给我留一个能回看的结论：MCP、MCP Apps、具体产品支持，到底怎么分？',
   'MCP 解决外部能力怎样接入；MCP Apps 在这个基础上扩展交互界面的表达；具体产品还要实现相应支持。\n\n发布扩展不等于所有客户端已经可用，可编辑不等于 Agent 一定读取了修改，有界面也不等于每个任务都更好做。这条历史发布打开了新的交互可能；判断实际价值，仍要回到某个版本、某个应用和一件真实工作。'],
];

const sharedState: Turn[] = [
  ['接着比较表的例子。我把“已开放”手动改成“仅预览”，再让 Agent 更新。它应该无条件相信我吗？',
   '至少不能悄悄改回去。可以把两件事分开：来源原文写了什么，以及你据此作出的判断。\n\n例如原文是“提供预览入口”，你把可用状态标为“仅预览”。后续 Agent 应先读取这次修改；若新资料与它冲突，就把新证据和差异展示出来，让你决定是否修订。尊重人工修改，不等于把所有人工判断都当成永远正确的事实。'],
  ['如果我正在改，它也在改同一格，最后保存的那个覆盖前一个，不就好了？',
   '那可能丢掉你刚作出的判断。用一个假设过程看：Agent 读到版本 3；你把状态改成“仅预览”，保存为版本 4；Agent 按版本 3 的旧材料写回，就可能把它覆盖。\n\n更合适的行为是检查当前版本：发现依据已过时，先重新读；不同字段的更新可以合并，同一字段有冲突时留下差异供确认。用户看到的是“这格为什么变了”，而不是两边谁写得更快。'],
  ['如果我后悔了呢？每次改动都弹确认也很烦。',
   '普通编辑直接生效，保留撤销和修改记录即可。只有真正冲突、无法判断该保留哪一项时，再请求选择。\n\n例如你撤销“仅预览”的改动，表格和 Agent 下次读取的值都要一起回到对应状态；不能只是界面看起来恢复了。流畅的体验来自平时少打断，遇到关键差异时能说明白。'],
  ['所以试用时我就做“改一格、补资料、继续、撤销”这一串，看它是否一直跟得上？',
   '对，这条操作链很容易暴露差异：\n\n1. 把一格改成“仅预览”，并留下注释。\n2. 补进新材料，要求只更新相关内容。\n3. 检查人工修改是否保留，冲突有没有明确指出。\n4. 撤销修改，再提问，检查它是否使用撤销后的值。\n\n界面不是最后展示结果的容器，它也是你参与工作的入口。是否好用，体现在你的每一步操作能否进入后续工作；这仍是待执行的验证方案。'],
];

const summaries = {
  news: 'AI 新闻按与实际工作的关系筛选：能力边界、完成成本、已有工作是否受影响。MCP Apps 的历史发布说明工具可以提供交互界面，但协议发布、客户端实现与具体任务可用是三层事实。榜单成绩不能替代真实任务；API 单价也不等于任务总成本。简报最多三条、优先原始来源，不按发布大小判断重要性；尚未接入实时新闻。',
  products: '以三份发布材料生成可追溯比较表，再手动改一格、补进第四份材料，检验 Agent 是否按新状态继续。关闭页面与执行进程中断是不同测试。试用留下来源、人工修改、恢复位置和成本的证据，不强行合成总分；一次成功不足以证明稳定，尚未完成真实产品评测。',
  protocol: 'MCP 连接外部能力，MCP Apps 增加协议内的交互界面，客户端和具体工具仍需实现支持。和浏览器操作相比，区别在于工具、状态与界面的接入方式，不代表天然更可靠。能传递状态不等于应用一定遵守人工修改；阅读简报可用文字，比较、筛选与编辑才更需要 GUI。',
  sharedState: '可编辑表格的关键是人工修改能进入后续工作。来源事实与人工判断分开保存；新证据引发冲突时显示差异，不静默覆盖。Agent 基于旧版本更新时应先重新读，普通编辑配合撤销即可，不必处处确认。验证链为改一格、补资料、继续、撤销，检查界面与后续读取保持一致；尚未执行实测。',
};

/** Extend only unchanged sample content. If either conversation was edited, create a separate case. */
export function seedAiNewsShowcase(store: OrbitStore, options: { fixtures?: boolean } = {}) {
  if (store.metadata(marker)) {
    if (options.fixtures !== false) seedAiNewsTurns(store);
    return { inserted: false, ids: [] as string[] };
  }
  const baselineIds = ['daily-ai-radar', 'daily-agent-products'];
  const hashes = ['s0ndv1', '1nsq4ls'];
  const messages = store.list('messages');
  const conversations = store.list('conversations');
  const reuse = baselineIds.every((id, i) => {
    const c = store.get('conversations', id), m = store.get('memories', id);
    const children = conversations.filter(child => child.parentId === id);
    return c?.showcase && !c.archived && c.project === 'AI 动态' && c.status === 'idle' && m
      && (i === 0 ? !c.parentId && children.length === 1 && children[0]!.id === baselineIds[1] && children[0]!.forkMessageId === `${id}-a2` : children.length === 0)
      && sourceKey(messages.filter(msg => msg.conversationId === id)) === hashes[i]
      && !m.summaryEdited && m.summary === everydaySummaries[id]
      && !m.items.some(item => item.edited || item.deleted) && !m.discussion?.turns.some(turn => turn.edited)
      && (!m.recap || JSON.stringify(m.recap.nodes) === JSON.stringify(recapFixtures[id]!.nodes));
  });
  const rootId = reuse ? baselineIds[0]! : 'ai-news-radar';
  const productId = reuse ? baselineIds[1]! : 'ai-news-products';
  const ids = [rootId, productId, 'ai-news-mcp-apps', 'ai-news-shared-state'];
  for (const id of ids.slice(reuse ? 2 : 0)) {
    if (store.get('conversations', id) || store.get('memories', id) || messages.some(m => m.conversationId === id)) throw new Error('AI 动态示例 ID 冲突，未覆盖已有内容');
  }
  store.transaction(() => {
    new SectionService(store).ensure('AI 动态');
    function append(c: Conversation, turns: Turn[], offset: number, start: number) {
      const added: Message[] = [];
      turns.forEach(([question, answer], i) => {
        for (const [role, content, suffix] of [['user', question, 'u'], ['assistant', answer, 'a']] as const) {
          const m: Message = { id: `${c.id}-${suffix}${i + 1 + offset}`, conversationId: c.id, role, content, createdAt: new Date(start + i * 180000 + (role === 'assistant' ? 45000 : 0)).toISOString() };
          if (store.get('messages', m.id)) throw new Error('AI 动态示例消息 ID 冲突，未覆盖已有内容');
          added.push(store.put('messages', m));
        }
      });
      return added;
    }
    function overview(c: Conversation, summary: string) {
      const before = store.get('memories', c.id), last = store.list('messages').filter(m => m.conversationId === c.id).at(-1)!;
      store.put('memories', { id: c.id, conversationId: c.id, version: (before?.version || 0) + 1, status: 'ready', summary, items: [], coveredMessageId: last.id, updatedAt: last.createdAt });
      store.updateConversation(c.id, { summary, updatedAt: last.createdAt, showcase: { title: 'AI 动态讨论', period: '', notice: '编写的多轮讨论，引用 MCP 与 MCP Apps 的历史官方发布。成本数字与候选消息为假设，没有实时抓取或真实产品评分。' } });
    }
    function branch(id: string, title: string, parent: Conversation, round: number, turns: Turn[], summary: string, snapshot: string, order: number) {
      const cutoff = store.require('messages', `${parent.id}-a${round}`);
      const own = store.list('messages').filter(m => m.conversationId === parent.id);
      const inheritedSources = [...new Set([...(parent.inheritedSources || []), ...own.slice(0, own.findIndex(m => m.id === cutoff.id) + 1).map(m => m.id)])];
      const start = Date.parse(cutoff.createdAt) + 60000;
      const c = store.createConversation(title, { id, project: 'AI 动态', order, parentId: parent.id, forkMessageId: cutoff.id, inheritedSources, inheritedContext: JSON.stringify({ summary: snapshot, items: [] }), createdAt: new Date(start).toISOString() });
      append(c, turns, 0, start); overview(c, summary); return c;
    }
    const root = reuse ? store.require('conversations', rootId) : store.createConversation('每天十分钟：从发布到判断', { id: rootId, project: 'AI 动态', order: 0, createdAt: '2026-09-24T02:00:00.000Z' });
    if (!reuse) append(root, [
      ['每天只花十分钟看 AI 动态，怎样避免被一堆发布淹没？', '关注模型、Agent 产品与开发者工具，每天最多三条。每条写清发生了什么、原始来源和它与当前工作的关系；没有重要变化就不凑数。'],
      ['优先官方来源，同一个发布合并。我还想单独比较一下 Agent 产品。', '新闻筛选保留一手来源，同一事件去重。产品体验另开讨论，用相同任务检验能力，避免把模型榜单成绩直接当成实际工作效果。'],
    ], 0, Date.parse(root.createdAt));
    append(root, news, 2, Date.parse(store.require('messages', `${root.id}-a2`).createdAt) + 180000); overview(root, summaries.news);
    const product = reuse ? store.require('conversations', productId) : branch(productId, '哪些 Agent 产品值得亲自试用', root, 2, [
      ['比较 Agent 产品，不想只看功能表，怎么试比较有效？', '用相同资料与任务，记录实际结果、人工接管和复现步骤。检查上下文接续、产物编辑和执行恢复，不预填产品评分。'],
      ['重点看看 GUI 和 Agent 是否共用状态，以及长时间执行能否恢复。', '记录产品版本、测试日期与预算，用具体操作检验这两点。可以选一项需要读取资料、形成产物并继续修改的工作。'],
    ], summaries.products, '只关注模型、Agent 与开发者工具，一手来源、同事件去重。产品能力需要用相同任务验证。', 0.1);
    append(product, products, 2, Date.parse(store.require('messages', `${product.id}-a2`).createdAt) + 180000); overview(product, summaries.products);
    branch(ids[2]!, 'MCP Apps：多了界面，究竟改变什么', root, 4, protocol, summaries.protocol, '已读 MCP Apps 的 2026-01-26 历史发布：工具可提供交互界面。协议定义、客户端实现、具体工具实际可用需要分开核对。', 0.2);
    branch(ids[3]!, '改一格之后，Agent 能跟上吗', product, 4, sharedState, summaries.sharedState, '固定试用任务为三份发布材料生成比较表、人工改一格、补新材料继续。表格可编辑不等于 Agent 会读取并保留人工修改。', 1.1);

    if (options.fixtures !== false) {
      seedAiNewsTurns(store);
      // Remap source IDs for the independent case, then validate coverage and branch cutoffs again.
      const remap = (s: string) => s.replaceAll('daily-ai-radar', rootId).replaceAll('daily-agent-products', productId);
      ids.forEach((id, index) => {
        const fixture = aiNewsRecaps[[...baselineIds, ...ids.slice(2)][index]!];
        if (!fixture) throw new Error(`缺少 AI 动态纪要：${id}`);
        const source = recapSource(id, store.list('messages'), store.list('conversations'));
        if (reuse && fixture.sourceKey !== source.key) throw new Error(`AI 动态纪要来源已变化：${id}`);
        const nodes = fixture.nodes.map(n => ({ ...n, roundIds: n.roundIds.map(remap) }));
        const m = store.require('memories', id);
        store.put('memories', { ...m, recap: validateRecap({ nodes }, source) });
      });
      const section = store.list('sections').find(s => s.name === 'AI 动态')!;
      // A topic containing other, real conversations must be summarized from all its sources normally.
      if (store.list('conversations').filter(c => !c.archived && c.project === section.name).every(c => ids.includes(c.id))) {
        const source = new TopicOverviewService(store, () => {}).source(section.id);
        store.put('sections', { ...section, overview: { text: aiNewsOverview, sourceKey: source.sourceKey, updatedAt: new Date().toISOString() } });
      }
    }
    store.setMetadata(marker, true);
  });
  return { inserted: true, ids };
}

/** Fill missing per-round summaries only when the original messages still match. */
function seedAiNewsTurns(store: OrbitStore) {
  const overview = new TopicOverviewService(store, () => {});
  const section = store.list('sections').find(s => s.name === 'AI 动态');
  const overviewWasCurrent = section?.overview?.sourceKey === (section && overview.source(section.id).sourceKey);
  let inserted = 0;
  const canonical = (id: string) => id.replace(/^ai-news-radar(?=-|$)/, 'daily-ai-radar').replace(/^ai-news-products(?=-|$)/, 'daily-agent-products');
  store.transaction(() => {
    for (const id of ['daily-ai-radar', 'daily-agent-products', 'ai-news-radar', 'ai-news-products', 'ai-news-mcp-apps', 'ai-news-shared-state']) {
      const c = store.get('conversations', id), m = store.get('memories', id);
      if (c?.showcase?.title !== 'AI 动态讨论' || !m) continue;
      const rounds = conversationRounds(id, store.list('messages'));
      const added = rounds.flatMap(round => {
        if (validTurn(round, m.discussion?.turns)) return [];
        const key = sourceKey(round.messages.map(msg => ({ ...msg, id: canonical(msg.id) })));
        const fixture = aiNewsTurns.find(t => t.id === canonical(round.id) && t.sourceKey === key);
        return fixture ? [{ ...fixture, id: round.id, sourceKey: round.sourceKey }] : [];
      });
      if (!added.length) continue;
      inserted += added.length;
      const turns = [...(m.discussion?.turns || []).filter(t => !added.some(n => n.id === t.id)), ...added];
      store.put('memories', { ...m, discussion: { version: (m.discussion?.version || 0) + 1, status: rounds.every(r => validTurn(r, turns)) ? 'ready' : 'empty', turns } });
    }
    // The recap text still describes the same Q&A; avoid regenerating it solely due to compact turn wording.
    if (inserted && section?.overview && overviewWasCurrent) store.put('sections', { ...section, overview: { ...section.overview, sourceKey: overview.source(section.id).sourceKey } });
    const all = store.list('conversations'), messages = store.list('messages');
    const topic = section && all.filter(c => !c.archived && c.project === section.name);
    const unchangedCase = topic?.length === 4 && topic.every(c => aiNewsRecaps[c.id]?.sourceKey === recapSource(c.id, messages, all).key && !store.get('memories', c.id)?.discussion?.turns.some(t => t.edited));
    if (section && unchangedCase) store.put('sections', { ...section, overview: { text: aiNewsOverview, sourceKey: overview.source(section.id).sourceKey, updatedAt: new Date().toISOString() } });
  });
}
