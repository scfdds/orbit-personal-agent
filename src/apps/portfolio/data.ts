export type Currency = "CNY" | "USD" | "HKD";
export interface Position {
  id: string;
  symbol: string;
  name: string;
  currency: Currency;
  kind: "holding" | "watching";
  quantity: number;
  averageCost: number;
  lastPrice: number | null;
  quoteDate: string;
  quoteSource: string;
  note: string;
  source: "sample" | "manual";
}
export interface Observation {
  id: string;
  positionId: string;
  title: string;
  detail: string;
  evidence: string;
  dueDate: string;
  status: "open" | "done";
}
export interface PortfolioData {
  title: string;
  focus: string;
  positions: Position[];
  observations: Observation[];
}
export const currencyLabels: Record<Currency, string> = { CNY: "人民币", USD: "美元", HKD: "港币" };
export const money = (value: number, currency: Currency) => new Intl.NumberFormat("zh-CN", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
export const number = (value: number) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 }).format(value);
export const asRecord = (data: PortfolioData) => data as unknown as Record<string, unknown>;

export function emptyPortfolio(): PortfolioData {
  return { title: "我的持仓与观察", focus: "", positions: [], observations: [] };
}
export function samplePortfolio(): PortfolioData {
  const quote = { currency: "CNY" as const, quoteDate: "2026-09-24", quoteSource: "Orbit 虚构示例 · 非真实行情", source: "sample" as const };
  return {
    title: "示例组合 · 科技与消费",
    focus: "把持仓依据和待验证事项放在一起，每次复盘检查事实是否变化。",
    positions: [
      { ...quote, id: "P001", symbol: "DEMO01", name: "星河科技", kind: "holding", quantity: 500, averageCost: 42.8, lastPrice: 46.2, note: "关注新产品收入占比；等待下一份经营数据核对。" },
      { ...quote, id: "P002", symbol: "DEMO02", name: "远山消费", kind: "holding", quantity: 800, averageCost: 18.5, lastPrice: 17.9, note: "观察门店经营改善是否持续，尚未形成新结论。" },
      { ...quote, id: "P003", symbol: "DEMO03", name: "青禾能源", kind: "holding", quantity: 300, averageCost: 31.2, lastPrice: 32.6, note: "核对现金流与应收账款，不根据单一新闻调整判断。" },
      { ...quote, id: "P004", symbol: "DEMO04", name: "云帆软件", kind: "watching", quantity: 0, averageCost: 0, lastPrice: 25.4, note: "仅观察，暂未持有。" },
    ],
    observations: [
      { id: "T001", positionId: "P001", title: "核对新产品收入的变化", detail: "查看新一季经营数据，区分公司披露与外部推测。", evidence: "尚未补充资料", dueDate: "", status: "open" },
      { id: "T002", positionId: "P002", title: "补充门店经营数据", detail: "保留相同口径，并记录信息对应的时间。", evidence: "尚未补充资料", dueDate: "", status: "open" },
      { id: "T003", positionId: "P003", title: "整理持仓观察依据", detail: "已记下需要核对现金流及应收账款，后续等待实际资料。", evidence: "演示用检查项，非真实调研结果", dueDate: "", status: "done" },
    ],
  };
}

export interface PortfolioSummary {
  currency: Currency;
  count: number;
  quotedCount: number;
  cost: number;
  quotedCost: number;
  value: number;
  profit: number;
  returnPercent: number | null;
}
export function summarizePositions(positions: Position[]): PortfolioSummary[] {
  const groups = new Map<Currency, PortfolioSummary>();
  for (const p of positions.filter((item) => item.kind === "holding")) {
    let g = groups.get(p.currency);
    if (!g) {
      g = { currency: p.currency, count: 0, quotedCount: 0, cost: 0, quotedCost: 0, value: 0, profit: 0, returnPercent: null };
      groups.set(p.currency, g);
    }
    g.count += 1;
    g.cost += p.quantity * p.averageCost;
    if (p.lastPrice !== null) {
      g.quotedCount += 1;
      g.quotedCost += p.quantity * p.averageCost;
      g.value += p.quantity * p.lastPrice;
    }
    g.profit = g.value - g.quotedCost;
    g.returnPercent = g.quotedCost > 0 ? g.profit / g.quotedCost * 100 : null;
  }
  return [...groups.values()];
}

function cell(value: string) { return value.replaceAll("|", "\\|").replaceAll("\n", "<br>"); }
export function portfolioMarkdown(data: PortfolioData): string {
  const lines = [ `# ${data.title}`, "", data.focus || "尚未设置复盘关注方向。", "", "价格由用户或 Agent 依据资料录入，不是实时行情；不同币种独立计算，未计入税费与分红。" ];
  if (data.positions.some((p) => p.source === "sample")) lines.push("包含虚构示例资产与价格，仅用于演示。请勿作为真实投资依据。");
  for (const s of summarizePositions(data.positions)) lines.push("", `## ${currencyLabels[s.currency]}组合`, `持仓成本：${money(s.cost, s.currency)}；已录入价格部分市值：${money(s.value, s.currency)}；浮动盈亏：${money(s.profit, s.currency)}。价格覆盖 ${s.quotedCount}/${s.count} 项。`);
  lines.push("", "## 持仓与自选", "", "| 名称 / 代码 | 类型 | 数量 | 成本价 | 参考价 / 日期 | 价格来源 | 备注 |", "| --- | --- | ---: | ---: | --- | --- | --- |");
  for (const p of data.positions) lines.push(`| ${cell(p.name)} / ${cell(p.symbol)}${p.source === "sample" ? "（虚构）" : ""} | ${p.kind === "holding" ? "持仓" : "自选"} | ${number(p.quantity)} | ${money(p.averageCost, p.currency)} | ${p.lastPrice === null ? "未录入" : `${money(p.lastPrice, p.currency)} / ${p.quoteDate}`} | ${cell(p.quoteSource)} | ${cell(p.note)} |`);
  lines.push("", "## 观察清单", "");
  for (const item of data.observations) {
    const name = data.positions.find((p) => p.id === item.positionId)?.name;
    lines.push(`- [${item.status === "done" ? "x" : " "}] ${item.title}${name ? ` · ${name}` : ""}${item.dueDate ? ` · ${item.dueDate}` : ""}`, `  ${item.detail}`, `  资料 / 依据：${item.evidence || "尚未补充"}`);
  }
  return lines.join("\n");
}
