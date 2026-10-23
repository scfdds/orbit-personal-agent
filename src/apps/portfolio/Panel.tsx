import { useEffect, useState } from "react";
import { ArrowUpRight, ChartNoAxesCombined, Check, ChevronDown, Download, ListChecks, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import type { AppPanelProps } from "../../client/panel-types.ts";
import type { AppObject } from "../../shared/types.ts";
import { asRecord, currencyLabels, emptyPortfolio, money, number, samplePortfolio, summarizePositions, type Currency, type Observation, type PortfolioData, type Position } from "./data.ts";
import "./portfolio.css";

type PositionDraft = Omit<Position, "quantity" | "averageCost" | "lastPrice"> & { quantity: string; averageCost: string; lastPrice: string };
type Editor = { type: "position"; base: AppObject; value: PositionDraft } | { type: "observation"; base: AppObject; value: Observation } | { type: "focus"; base: AppObject; title: string; focus: string };
const nextId = (prefix: string, list: { id: string }[]) => `${prefix}${String(Math.max(0, ...list.map((p) => Number(p.id.slice(1)))) + 1).padStart(3, "0")}`;
const signClass = (value: number) => value > 0 ? "portfolio-positive" : value < 0 ? "portfolio-negative" : "";
const signedMoney = (value: number, currency: Currency) => `${value > 0 ? "+" : ""}${money(value, currency)}`;

export default function PortfolioPanel({ object, onUpdate, onSend, work }: AppPanelProps) {
  const data = (object?.data as unknown as PortfolioData | undefined) ?? emptyPortfolio();
  const [tab, setTab] = useState<"assets" | "tracking" | "review">("assets");
  const [kind, setKind] = useState<Position["kind"]>("holding");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>("CNY");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => { setEditor(null); setError(""); setDeleteId(null); setExpanded(null); }, [object?.id]);
  const summaries = summarizePositions(data.positions);
  const summary = summaries.find((s) => s.currency === selectedCurrency) ?? summaries[0];
  const hasSample = data.positions.some((p) => p.source === "sample");
  const openObservations = data.observations.filter((o) => o.status === "open");
  const filtered = data.positions.filter((p) => p.kind === kind && `${p.name} ${p.symbol}`.toLowerCase().includes(query.toLowerCase()));
  const isBlank = !data.positions.length && !data.observations.length;

  async function save(next: PortfolioData, base = object) {
    if (!base) return false;
    setBusy(true); setError("");
    try { await onUpdate(base, asRecord(next)); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "保存失败，请重试"); return false; }
    finally { setBusy(false); }
  }
  function openPosition(p?: Position) {
    if (!object) return;
    const position: Position = p ?? { id: nextId("P", data.positions), name: "", symbol: "", currency: "CNY", kind, quantity: kind === "holding" ? 100 : 0, averageCost: 0, lastPrice: null, quoteDate: "", quoteSource: "", source: "manual", note: "" };
    setEditor({ type: "position", base: object, value: { ...position, quantity: String(position.quantity), averageCost: String(position.averageCost), lastPrice: position.lastPrice === null ? "" : String(position.lastPrice) } });
    setDeleteId(null); setError("");
  }
  function openObservation(o?: Observation) {
    if (!object) return;
    setEditor({ type: "observation", base: object, value: o ?? { id: nextId("T", data.observations), title: "", positionId: "", detail: "", evidence: "", dueDate: "", status: "open" } });
    setDeleteId(null); setError("");
  }
  async function submitEditor() {
    if (!editor) return;
    const old = editor.base.data as unknown as PortfolioData;
    let next: PortfolioData;
    if (editor.type === "position") {
      const d = editor.value;
      if (!d.name.trim() || !d.symbol.trim()) { setError("请填写资产名称和代码"); return; }
      if (d.kind === "holding" && (!d.quantity.trim() || !d.averageCost.trim())) { setError("请填写持仓数量和成本价"); return; }
      const p: Position = { ...d, name: d.name.trim(), symbol: d.symbol.trim().toUpperCase(), quantity: d.kind === "watching" ? 0 : Number(d.quantity), averageCost: d.kind === "watching" ? 0 : Number(d.averageCost), lastPrice: d.lastPrice.trim() ? Number(d.lastPrice) : null, quoteDate: d.lastPrice.trim() ? d.quoteDate : "", quoteSource: d.lastPrice.trim() ? d.quoteSource : "" };
      next = { ...old, positions: old.positions.some((item) => item.id === p.id) ? old.positions.map((item) => item.id === p.id ? p : item) : [...old.positions, p] };
    } else if (editor.type === "observation") {
      const o = editor.value;
      if (!o.title.trim()) { setError("请填写观察事项"); return; }
      next = { ...old, observations: old.observations.some((item) => item.id === o.id) ? old.observations.map((item) => item.id === o.id ? o : item) : [...old.observations, o] };
    } else next = { ...old, title: editor.title, focus: editor.focus };
    if (await save(next, editor.base)) setEditor(null);
  }
  async function remove(id: string, type: "position" | "observation") {
    if (deleteId !== id) { setDeleteId(id); return; }
    const next = type === "position" ? { ...data, positions: data.positions.filter((p) => p.id !== id), observations: data.observations.map((o) => o.positionId === id ? { ...o, positionId: "" } : o) } : { ...data, observations: data.observations.filter((o) => o.id !== id) };
    if (await save(next)) { setDeleteId(null); setExpanded(null); }
  }
  const patchPosition = (patch: Partial<PositionDraft>) => editor?.type === "position" && setEditor({ ...editor, value: { ...editor.value, ...patch } });
  const patchObservation = (patch: Partial<Observation>) => editor?.type === "observation" && setEditor({ ...editor, value: { ...editor.value, ...patch } });

  return <div className="portfolio-app">
    <header className="portfolio-heading">
      <div><span className="portfolio-eyebrow"><ChartNoAxesCombined size={15} />持仓追踪</span><h2>{data.title}</h2><p>记录持仓依据，跟进每一个待验证的判断。</p></div>
      {!isBlank && <a className="portfolio-icon-action" title="导出持仓复盘" aria-label="导出持仓复盘" href={`/api/conversations/${encodeURIComponent(work.id)}/apps/portfolio/export/md`} download><Download size={18} /></a>}
    </header>
    <nav className="portfolio-tabs" aria-label="持仓追踪视图">{([["assets", "持仓与自选"], ["tracking", "观察清单"], ["review", "复盘"]] as const).map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined}>{label}{id === "tracking" && openObservations.length > 0 && <span>{openObservations.length}</span>}</button>)}</nav>
    {error && <div className="portfolio-error" role="alert">{error}<button aria-label="关闭错误" onClick={() => setError("")}><X size={14} /></button></div>}
    {hasSample && <div className="portfolio-sample"><span>示例组合</span>含虚构资产 · 初始示例日期 2026-09-24 · 非实时行情</div>}

    {editor && <form className="portfolio-editor" onSubmit={(e) => { e.preventDefault(); void submitEditor(); }}>
      <div className="portfolio-section-title"><h3>{editor.type === "position" ? "资产记录" : editor.type === "observation" ? "观察事项" : "复盘设置"}</h3><button type="button" className="portfolio-icon-action" aria-label="取消编辑" disabled={busy} onClick={() => setEditor(null)}><X size={17} /></button></div>
      <fieldset disabled={busy}>
        {editor.type === "position" && <>
          <div className="portfolio-form-grid"><label>资产名称<input autoFocus required maxLength={80} value={editor.value.name} onChange={(e) => patchPosition({ name: e.target.value })} placeholder="例如：资产名称" /></label><label>代码<input required maxLength={30} value={editor.value.symbol} onChange={(e) => patchPosition({ symbol: e.target.value })} placeholder="例如：证券代码" /></label>
            <label>类型<select value={editor.value.kind} onChange={(e) => patchPosition({ kind: e.target.value as Position["kind"] })}><option value="holding">持仓</option><option value="watching">自选 · 尚未持有</option></select></label><label>币种<select value={editor.value.currency} onChange={(e) => patchPosition({ currency: e.target.value as Currency })}>{Object.entries(currencyLabels).map(([id, name]) => <option value={id} key={id}>{name} · {id}</option>)}</select></label>
            {editor.value.kind === "holding" && <><label>持仓数量<input required type="number" min="0.000001" step="any" value={editor.value.quantity} onChange={(e) => patchPosition({ quantity: e.target.value })} /></label><label>平均成本价<input required type="number" min="0" step="any" value={editor.value.averageCost} onChange={(e) => patchPosition({ averageCost: e.target.value })} /></label></>}
            <label>参考价格 <small>选填</small><input type="number" min="0" step="any" value={editor.value.lastPrice} onChange={(e) => patchPosition({ lastPrice: e.target.value })} placeholder="尚未录入" /></label><label>价格日期<input type="date" required={!!editor.value.lastPrice.trim()} disabled={!editor.value.lastPrice.trim()} value={editor.value.quoteDate} onChange={(e) => patchPosition({ quoteDate: e.target.value })} /></label>
          </div>
          <label>价格来源<input maxLength={300} required={!!editor.value.lastPrice.trim()} disabled={!editor.value.lastPrice.trim()} value={editor.value.quoteSource} onChange={(e) => patchPosition({ quoteSource: e.target.value })} placeholder="资料名称、链接或交易记录" /></label>
          <label>持仓依据 / 备注<textarea rows={3} maxLength={2000} value={editor.value.note} onChange={(e) => patchPosition({ note: e.target.value })} placeholder="为什么关注它？哪些判断仍需验证？" /></label>
        </>}
        {editor.type === "observation" && <>
          <label>观察事项<input autoFocus required maxLength={160} value={editor.value.title} onChange={(e) => patchObservation({ title: e.target.value })} placeholder="例如：核对本季度现金流变化" /></label>
          <div className="portfolio-form-grid"><label>关联资产<select value={editor.value.positionId} onChange={(e) => patchObservation({ positionId: e.target.value })}><option value="">整个组合</option>{data.positions.map((p) => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label><label>复核日期 <small>选填</small><input type="date" value={editor.value.dueDate} onChange={(e) => patchObservation({ dueDate: e.target.value })} /></label></div>
          <label>要核对什么<textarea rows={3} maxLength={4000} value={editor.value.detail} onChange={(e) => patchObservation({ detail: e.target.value })} placeholder="说明要验证的问题与观察口径" /></label>
          <label>资料 / 依据<textarea rows={2} maxLength={4000} value={editor.value.evidence} onChange={(e) => patchObservation({ evidence: e.target.value })} placeholder="补充来源、原文或实际核对结果" /></label>
          <p className="portfolio-hint">复核日期仅用于记录，不会自动创建定时任务。</p>
        </>}
        {editor.type === "focus" && <><label>组合名称<input autoFocus required maxLength={120} value={editor.title} onChange={(e) => setEditor({ ...editor, title: e.target.value })} /></label><label>复盘关注方向<textarea rows={4} maxLength={4000} value={editor.focus} onChange={(e) => setEditor({ ...editor, focus: e.target.value })} placeholder="希望重点关注哪些变化？有哪些判断需要持续验证？" /></label></>}
      </fieldset>
      <div className="portfolio-editor-actions"><button type="button" className="portfolio-button" disabled={busy} onClick={() => setEditor(null)}>取消</button><button className="portfolio-button portfolio-button-primary" disabled={busy} type="submit">{busy ? "保存中…" : "保存"}</button></div>
    </form>}

    {isBlank && !editor ? <div className="portfolio-empty">
      <div className="portfolio-empty-symbol"><ChartNoAxesCombined size={31} /></div>
      <h3>从一项持仓开始</h3><p>记录资产、成本和关注依据。<br />让 Orbit 帮你整理资料，逐项跟进变化。</p>
      <button className="portfolio-button portfolio-button-primary" onClick={() => openPosition()} disabled={!object}><Plus size={16} />添加资产</button>
      <button className="portfolio-text-button" disabled={busy || !object} onClick={() => void save(samplePortfolio())}>先看看示例组合 <ArrowUpRight size={14} /></button>
      <div className="portfolio-empty-features"><span>持仓与盈亏</span><span>观察清单</span><span>复盘记录</span></div>
    </div> : <>
      {tab === "assets" && <>
        {summary && <section className="portfolio-summary">
          <div className="portfolio-summary-heading"><span>组合概览</span>{summaries.length > 1 ? <select aria-label="概览币种" value={summary.currency} onChange={(e) => setSelectedCurrency(e.target.value as Currency)}>{summaries.map((s) => <option key={s.currency} value={s.currency}>{currencyLabels[s.currency]}</option>)}</select> : <small>{currencyLabels[summary.currency]}</small>}</div>
          <div className="portfolio-metrics"><div><span>参考市值</span><strong>{summary.quotedCount ? money(summary.value, summary.currency) : "待补价格"}</strong></div><div><span>持仓成本</span><strong>{money(summary.cost, summary.currency)}</strong></div><div><span>浮动盈亏</span><strong className={signClass(summary.profit)}>{summary.quotedCount ? signedMoney(summary.profit, summary.currency) : "—"}</strong><small className={signClass(summary.profit)}>{summary.returnPercent === null ? "—" : `${summary.returnPercent > 0 ? "+" : ""}${summary.returnPercent.toFixed(2)}%`}</small></div></div>
          <p className="portfolio-hint">{summary.quotedCount}/{summary.count} 项持仓已录入价格 · 盈亏按已录入价格部分计算，未含税费与分红</p>
        </section>}
        <div className="portfolio-toolbar"><div className="portfolio-segment">{(["holding", "watching"] as const).map((k) => <button className={kind === k ? "active" : ""} key={k} onClick={() => setKind(k)}>{k === "holding" ? "持仓" : "自选"}<small>{data.positions.filter((p) => p.kind === k).length}</small></button>)}</div><button className="portfolio-text-button" disabled={busy} onClick={() => openPosition()}><Plus size={15} />添加</button></div>
        {data.positions.length > 5 && <label className="portfolio-search"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="查找名称或代码" aria-label="查找资产" /></label>}
        <div className="portfolio-assets">{filtered.map((p) => {
          const profit = p.lastPrice === null ? null : p.quantity * (p.lastPrice - p.averageCost);
          return <article className="portfolio-asset" key={p.id}>
            <button className="portfolio-asset-overview" onClick={() => setExpanded(expanded === p.id ? null : p.id)} aria-expanded={expanded === p.id}>
              <div><h3>{p.name}<small>{p.symbol}</small></h3><p>{p.kind === "holding" ? `${number(p.quantity)} 份 · 成本 ${money(p.averageCost, p.currency)}` : "尚未持有"}</p></div>
              <div className="portfolio-asset-price"><strong>{p.lastPrice === null ? "未录入价格" : money(p.lastPrice, p.currency)}</strong><small className={profit === null ? "" : signClass(profit)}>{p.kind === "holding" && profit !== null ? signedMoney(profit, p.currency) : p.quoteDate || "添加参考价格"}</small></div>
              <ChevronDown size={14} className={expanded === p.id ? "expanded" : ""} />
            </button>
            {expanded === p.id && <div className="portfolio-asset-detail"><p>{p.note || "还没有记录持仓依据。"}</p><small>{p.lastPrice === null ? "暂未录入价格，未计入参考市值与浮动盈亏。" : `${p.quoteDate} · ${p.quoteSource}`}</small><div className="portfolio-inline-actions"><button className="portfolio-text-button" disabled={busy} onClick={() => openPosition(p)}><Pencil size={13} />编辑记录</button><button className="portfolio-text-button portfolio-remove" disabled={busy} onClick={() => void remove(p.id, "position")}><Trash2 size={13} />{deleteId === p.id ? "再次点击确认移除" : "移除"}</button></div></div>}
          </article>;
        })}{!filtered.length && <p className="portfolio-inline-empty">{query ? "没有匹配的资产" : kind === "holding" ? "尚无持仓，可以先添加一项资产。" : "把想继续了解的资产加入自选。"}</p>}</div>
        <p className="portfolio-source-note">参考价来自你录入的资料，未连接实时行情。不同币种独立统计。</p>
      </>}

      {tab === "tracking" && <section className="portfolio-tracking">
        <div className="portfolio-section-title"><div><h3>把判断逐项核对</h3><p>{openObservations.length} 项待跟进 · {data.observations.length - openObservations.length} 项已核对</p></div><button className="portfolio-text-button" onClick={() => openObservation()} disabled={busy}><Plus size={15} />添加</button></div>
        {[...data.observations].sort((a, b) => Number(a.status === "done") - Number(b.status === "done")).map((o) => <article className={`portfolio-observation ${o.status === "done" ? "done" : ""}`} key={o.id}>
          <button className="portfolio-checkbox" aria-label={`${o.status === "done" ? "重新跟进" : "标记已核对"}：${o.title}`} aria-pressed={o.status === "done"} disabled={busy} onClick={() => void save({ ...data, observations: data.observations.map((item) => item.id === o.id ? { ...item, status: item.status === "done" ? "open" : "done" } : item) })}>{o.status === "done" && <Check size={13} />}</button>
          <div className="portfolio-observation-content"><h4>{o.title}</h4><div className="portfolio-observation-meta"><span>{data.positions.find((p) => p.id === o.positionId)?.name ?? "整个组合"}</span>{o.dueDate && <span>复核日期 {o.dueDate}</span>}</div>{o.detail && <p>{o.detail}</p>}{o.evidence && <div className="portfolio-evidence">{o.evidence}</div>}<div className="portfolio-inline-actions"><button className="portfolio-text-button" onClick={() => openObservation(o)} disabled={busy}>编辑 / 补充依据</button><button className="portfolio-text-button portfolio-remove" onClick={() => void remove(o.id, "observation")} disabled={busy}>{deleteId === o.id ? "确认移除" : "移除"}</button></div></div>
        </article>)}
        {!data.observations.length && <div className="portfolio-inline-empty"><ListChecks size={24} /><p>记录一项需要验证的判断，<br />补充资料后再标记为已核对。</p><button className="portfolio-button" onClick={() => openObservation()}>添加观察事项</button></div>}
        <button className="portfolio-assist" disabled={busy} onClick={() => onSend("读取最新持仓追踪与用户备注，整理一份需要补充资料的观察清单并保存。保留我的持仓数据、已有观察事项和完成状态；不要编造行情或来源，不要给出买卖建议。")}>让 Orbit 整理观察清单 <ArrowUpRight size={15} /></button>
      </section>}

      {tab === "review" && <section className="portfolio-review">
        <div className="portfolio-section-title"><h3>本轮关注方向</h3><button className="portfolio-text-button" disabled={busy || !object} onClick={() => object && setEditor({ type: "focus", base: object, title: data.title, focus: data.focus })}><Pencil size={14} />编辑</button></div><p className="portfolio-focus">{data.focus || "写下你关心的变化，以及想要核对的判断。"}</p>
        <div className="portfolio-section-title"><h3>组合分布</h3><small>按录入价格对应的市值</small></div>
        {summaries.map((s) => <div key={s.currency} className="portfolio-allocation"><div className="portfolio-allocation-label">{currencyLabels[s.currency]}<span>{money(s.value, s.currency)}</span></div><div className="portfolio-allocation-bar">{data.positions.filter((p) => p.kind === "holding" && p.currency === s.currency && p.lastPrice !== null).map((p, i) => <span key={p.id} style={{ width: `${s.value > 0 ? p.quantity * p.lastPrice! / s.value * 100 : 0}%`, background: ["#548bb8", "#67a99d", "#a4a0cf", "#d5b781"][i % 4] }} title={p.name} />)}</div>{data.positions.filter((p) => p.kind === "holding" && p.currency === s.currency).map((p) => <div className="portfolio-allocation-item" key={p.id}><span>{p.name}</span><span>{p.lastPrice === null || s.value <= 0 ? "价格待补充" : `${(p.quantity * p.lastPrice / s.value * 100).toFixed(1)}%`}</span></div>)}</div>)}
        {!summaries.length && <p className="portfolio-inline-empty">添加持仓后可查看组合分布。</p>}
        <div className="portfolio-review-actions"><button className="portfolio-button portfolio-button-primary" disabled={busy} onClick={() => onSend("读取最新持仓追踪，按我的关注方向和观察清单生成一份简短复盘，使用 save_report 保存。区分已知事实和待验证问题，尊重用户记录的数量、成本、备注与状态；不编造实时行情，不给出买卖建议。")}>让 Orbit 生成复盘 <ArrowUpRight size={14} /></button><a className="portfolio-button" href={`/api/conversations/${encodeURIComponent(work.id)}/apps/portfolio/export/md`} download><Download size={14} />导出记录</a></div>
      </section>}
    </>}
    {!isBlank && <footer className="portfolio-footer"><span><Check size={12} />{busy ? "正在保存" : `已保存 · v${object?.version ?? 1}`}</span><span>与 Orbit 共享当前记录</span></footer>}
  </div>;
}
