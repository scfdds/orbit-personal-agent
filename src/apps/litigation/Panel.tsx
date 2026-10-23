import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, CheckCircle2, ChevronRight, Download, FileText, Link2, ListChecks, Pencil, Plus, Scale, Sparkles, Trash2, X } from "lucide-react";
import type { AppPanelProps } from "../../client/panel-types.ts";
import { caseProgress, evidenceStatus, nextCaseId, sampleLitigation, validateLitigationData, type LitigationData } from "./data.ts";
import "./litigation.css";

type Tab = "overview" | "facts" | "evidence";
type Kind = "case" | "parties" | "events" | "evidence" | "checklist";
type Draft = { kind: Kind; id?: string; version: number; title: string; detail: string; date: string; source: string; category: string; evidenceIds: string[]; status: "missing" | "collected" | "checked"; ready: boolean };

export default function LitigationPanel({ object, onUpdate, onSend, work }: AppPanelProps) {
  const data = object?.data as unknown as LitigationData | undefined;
  const [tab, setTab] = useState<Tab>("overview");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [focus, setFocus] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => { setDraft(null); setError(""); setFocus(null); setRemoving(null); setTab("overview"); }, [object?.id]);
  useEffect(() => { if (draft) surface.current?.querySelector(".litigation-editor")?.scrollIntoView({ block: "nearest" }); }, [draft?.kind, draft?.id]);
  useEffect(() => { if (focus && tab === "evidence") surface.current?.querySelector(".litigation-material.is-focused")?.scrollIntoView({ block: "nearest" }); }, [focus, tab]);
  const started = data && data.source !== "empty";
  const progress = data ? caseProgress(data) : { missing: 0, unlinked: 0, ready: 0 };
  async function perform(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "保存失败，请重试"); } finally { setBusy(false); }
  }
  async function save(next: LitigationData) {
    if (!object) throw new Error("应用正在准备，请稍后重试");
    validateLitigationData(next as unknown as Record<string, unknown>);
    await onUpdate(object, next as unknown as Record<string, unknown>);
  }
  function edit(kind: Kind, id?: string) {
    if (!data || !object) return;
    const initial: Draft = { kind, id, version: object.version, title: "", detail: "", source: "", category: "", date: "", evidenceIds: [], status: "missing", ready: false };
    if (kind === "case") Object.assign(initial, { title: data.title, detail: data.summary, source: data.objective });
    else if (id) {
      const item = data[kind].find((i) => i.id === id);
      if (!item) return;
      if ("name" in item) Object.assign(initial, { title: item.name, category: item.role, detail: item.contact });
      else if ("date" in item) Object.assign(initial, { title: item.title, detail: item.detail, date: item.date, evidenceIds: [...item.evidenceIds] });
      else if ("status" in item) Object.assign(initial, { title: item.title, detail: item.description, source: item.source, category: item.kind, status: item.status });
      else Object.assign(initial, { title: item.title, detail: item.detail, evidenceIds: [...item.evidenceIds], ready: item.ready });
    }
    setError(""); setDraft(initial); setRemoving(null);
  }
  async function submitDraft() {
    if (!draft || !data || !object) return;
    if (draft.version !== object.version) throw new Error("资料已更新，请关闭编辑后重新打开，保留最新修改");
    const d = draft;
    let next = structuredClone(data);
    if (d.kind === "case") next = { ...next, title: d.title.trim(), summary: d.detail.trim(), objective: d.source.trim(), source: next.source === "empty" ? "user" : next.source, userEdited: true };
    else {
      const id = d.id ?? nextCaseId({ parties: "P", events: "F", evidence: "E", checklist: "M" }[d.kind], data[d.kind]);
      const base = { id, userEdited: true };
      const item = d.kind === "parties" ? { ...base, name: d.title.trim(), role: d.category.trim(), contact: d.detail.trim() }
        : d.kind === "events" ? { ...base, title: d.title.trim(), detail: d.detail.trim(), date: d.date, evidenceIds: d.evidenceIds }
        : d.kind === "evidence" ? { ...base, title: d.title.trim(), kind: d.category.trim(), source: d.source.trim(), description: d.detail.trim(), status: d.status }
        : { ...base, title: d.title.trim(), detail: d.detail.trim(), evidenceIds: d.evidenceIds, ready: d.ready };
      // Keep other rows from the current version; an editor only changes one row.
      const items = next[d.kind] as Array<typeof item>;
      const index = items.findIndex((old) => old.id === id);
      if (index < 0) items.push(item); else items[index] = item;
    }
    await save(next); setDraft(null);
  }
  async function remove(kind: Exclude<Kind, "case">, id: string) {
    if (!data) return;
    if (kind === "evidence" && [...data.events, ...data.checklist].some((item) => item.evidenceIds.includes(id))) throw new Error("这项材料仍有关联，请先在事实或清单中解除关联，再删除");
    const next = structuredClone(data);
    (next[kind] as { id: string }[]) = next[kind].filter((item) => item.id !== id);
    await save(next); setRemoving(null);
  }
  function actions(kind: Exclude<Kind, "case">, id: string) {
    return <div className="litigation-row-actions">
      {removing === id ? <><span>删除此项？</span><button type="button" className="litigation-danger" disabled={busy} onClick={() => void perform(() => remove(kind, id))}>删除</button><button type="button" onClick={() => setRemoving(null)}>取消</button></>
        : <><button type="button" aria-label={`编辑 ${id}`} title="编辑" disabled={busy} onClick={() => edit(kind, id)}><Pencil size={14} /></button><button type="button" aria-label={`删除 ${id}`} title="删除" disabled={busy} onClick={() => setRemoving(id)}><Trash2 size={14} /></button></>}
    </div>;
  }
  function links(ids: string[]) {
    return <div className="litigation-evidence-links">{ids.length ? ids.map((id) => <button type="button" key={id} onClick={() => { setTab("evidence"); setFocus(id); }}><Link2 size={11} />{id} · {data?.evidence.find((e) => e.id === id)?.title}</button>) : <span className="litigation-unlinked">尚未关联材料</span>}</div>;
  }
  const askOrbit = () => onSend("请读取诉讼材料准备应用中的最新案件资料，核对事实时间线与证据的对应关系，补充待核对问题和待补材料清单。保留我手动编辑的内容与准备状态，不把缺失或仅有描述的材料当成已核实证据；不虚构事实、法条、期限、管辖或法律结论。将整理意见保存到应用，再简要说明结果。");
  const patch = (p: Partial<Draft>) => setDraft((old) => old ? { ...old, ...p } : null);
  return <div className="app-surface litigation-app" ref={surface}>
    <div className="app-heading">
      <div className="app-eyebrow"><Scale size={15} /><span>诉讼材料准备</span>{data?.source === "sample" && <span className="sample-tag">虚构示例</span>}</div>
      <h2>{started ? data.title : "把事实与证据整理清楚"}</h2>
      <p>{started ? "从事实出发，让每一项材料都有据可查。" : "梳理事情经过，关联证据，逐项补齐准备材料。"}</p>
    </div>
    {error && <div className="litigation-error" role="alert">{error}<button aria-label="关闭提示" onClick={() => setError("")}><X size={14} /></button></div>}
    {!started && !draft && <div className="litigation-start">
      <div className="litigation-start-illustration" aria-hidden="true"><FileText size={29} /><span><Check size={15} /></span></div>
      <h3>先建立一份案件资料</h3>
      <p>记录当事人和争议经过，再整理时间线、证据目录与待补清单。</p>
      <button className="button primary" disabled={busy || !object} onClick={() => edit("case")}><Plus size={15} />开始整理</button>
      <button className="text-button" disabled={busy || !object} onClick={() => void perform(() => save(sampleLitigation()))}>看看服务费争议示例 <ArrowUpRight size={13} /></button>
    </div>}
    {draft && <form className="litigation-editor" onSubmit={(e) => { e.preventDefault(); void perform(submitDraft); }}>
      <div className="litigation-section-title"><h3>{draft.kind === "case" ? "案件概况" : `${draft.id ? "编辑" : "添加"}${{ parties: "当事人", events: "事实", evidence: "材料", checklist: "准备事项" }[draft.kind]}`}</h3><button type="button" aria-label="关闭编辑" disabled={busy} onClick={() => setDraft(null)}><X size={16} /></button></div>
      <label>{draft.kind === "parties" ? "姓名 / 主体名称" : draft.kind === "case" ? "案件名称" : "名称"}<input required maxLength={draft.kind === "parties" ? 120 : 160} value={draft.title} onChange={(e) => patch({ title: e.target.value })} placeholder={draft.kind === "case" ? "例如：设计服务尾款争议" : "填写简短明确的名称"} autoFocus /></label>
      {draft.kind === "parties" && <label>在事件中的身份<input required maxLength={100} value={draft.category} onChange={(e) => patch({ category: e.target.value })} placeholder="例如：服务提供方" /></label>}
      {draft.kind === "events" && <label>发生日期 <span>不确定时可留空</span><input type="date" value={draft.date} onChange={(e) => patch({ date: e.target.value })} /></label>}
      {draft.kind === "evidence" && <div className="litigation-form-columns"><label>材料类型<select value={draft.category} onChange={(e) => patch({ category: e.target.value })} required><option value="">选择类型</option>{["合同 / 约定", "付款记录", "沟通 / 交付记录", "主体信息", "其他材料"].map((value) => <option key={value}>{value}</option>)}{draft.category && !["合同 / 约定", "付款记录", "沟通 / 交付记录", "主体信息", "其他材料"].includes(draft.category) && <option>{draft.category}</option>}</select></label><label>准备状态<select value={draft.status} onChange={(e) => patch({ status: e.target.value as Draft["status"] })}>{Object.entries(evidenceStatus).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>}
      <label>{draft.kind === "case" ? "事情经过与争议" : draft.kind === "parties" ? "联系信息 / 备注" : draft.kind === "evidence" ? "内容摘录 / 材料说明" : "具体说明"}<textarea rows={draft.kind === "case" ? 5 : 3} maxLength={draft.kind === "case" ? 10000 : draft.kind === "parties" ? 500 : draft.kind === "checklist" ? 2000 : 5000} value={draft.detail} onChange={(e) => patch({ detail: e.target.value })} placeholder={draft.kind === "evidence" ? "粘贴相关文字，或说明材料内容和需要核对的问题" : "只填写已知信息，未确认的内容可以注明"} /></label>
      {(draft.kind === "case" || draft.kind === "evidence") && <label>{draft.kind === "case" ? "希望整理清楚什么" : "来源 / 原件存放位置"}<textarea rows={2} maxLength={draft.kind === "case" ? 5000 : 500} value={draft.source} onChange={(e) => patch({ source: e.target.value })} placeholder={draft.kind === "case" ? "例如：梳理尾款金额与交付情况，列出缺失材料" : "例如：经办人邮箱、文件夹名称或资料来源"} /></label>}
      {(draft.kind === "events" || draft.kind === "checklist") && <fieldset className="litigation-reference-picker"><legend>关联材料</legend>{data?.evidence.length ? data.evidence.map((item) => <label key={item.id}><input type="checkbox" checked={draft.evidenceIds.includes(item.id)} onChange={(e) => patch({ evidenceIds: e.target.checked ? [...draft.evidenceIds, item.id] : draft.evidenceIds.filter((id) => id !== item.id) })} /><span>{item.id} · {item.title}</span><small>{evidenceStatus[item.status]}</small></label>) : <p>还没有材料，可稍后在「证据材料」中添加再关联。</p>}</fieldset>}
      <div className="litigation-editor-actions"><button type="button" className="quiet-button" disabled={busy} onClick={() => setDraft(null)}>取消</button><button type="submit" className="button primary small" disabled={busy}>{busy ? "保存中…" : "保存"}</button></div>
    </form>}
    {started && <>
      <div className="litigation-toolbar"><button className="button primary small" disabled={busy || work.status === "running"} onClick={askOrbit}><Sparkles size={14} />{work.status === "running" ? "Orbit 正在整理" : "让 Orbit 核对"}</button><a className="button secondary small" href={`/api/conversations/${encodeURIComponent(work.id)}/apps/litigation/export/md`} download><Download size={14} />导出准备稿</a></div>
      <div className="litigation-metrics"><div><strong>{data.events.length}</strong><span>条事实</span></div><div><strong>{data.evidence.length}</strong><span>项材料</span></div><button onClick={() => { setTab("evidence"); setFocus(null); }}><strong className={progress.missing ? "litigation-warm" : ""}>{progress.missing}</strong><span>待补充</span><ChevronRight size={13} /></button></div>
      <div className="litigation-tabs" role="tablist" aria-label="案件资料"><button role="tab" aria-selected={tab === "overview"} onClick={() => setTab("overview")}>案件概况</button><button role="tab" aria-selected={tab === "facts"} onClick={() => setTab("facts")}>事实时间线</button><button role="tab" aria-selected={tab === "evidence"} onClick={() => setTab("evidence")}>证据材料</button></div>
      {tab === "overview" && <>
        <section className="litigation-section"><div className="litigation-section-title"><h3>事情经过与整理目标</h3><button type="button" onClick={() => edit("case")} disabled={busy}><Pencil size={13} />编辑</button></div><p className="litigation-prose">{data.summary || "还没有事情经过，可直接补充已知事实。"}</p><div className="litigation-objective"><span>整理目标</span><p>{data.objective || "待补充"}</p></div></section>
        <section className="litigation-section"><div className="litigation-section-title"><h3>当事人 <span>{data.parties.length}</span></h3><button type="button" disabled={busy} onClick={() => edit("parties")}><Plus size={13} />添加</button></div>{data.parties.length ? data.parties.map((party) => <article className="litigation-party" key={party.id}><div><span className="litigation-label">{party.role}</span><h4>{party.name}</h4><p>{party.contact || "联系信息待补充"}</p></div>{actions("parties", party.id)}</article>) : <p className="litigation-empty-copy">添加事件涉及的个人或机构，以及各自的身份。</p>}</section>
        <section className="litigation-section"><div className="litigation-section-title"><h3>准备清单 <span>{progress.ready} / {data.checklist.length}</span></h3><button type="button" disabled={busy} onClick={() => edit("checklist")}><Plus size={13} />添加</button></div>{data.checklist.length ? data.checklist.map((item) => <article className={`litigation-checklist-row ${item.ready ? "is-ready" : ""}`} key={item.id}><button className="litigation-checkbox" role="checkbox" aria-checked={item.ready} aria-label={`${item.ready ? "撤销准备" : "标记已准备"}：${item.title}`} disabled={busy} onClick={() => void perform(() => save({ ...data, checklist: data.checklist.map((i) => i.id === item.id ? { ...i, ready: !i.ready, userEdited: true } : i) }))}>{item.ready && <Check size={13} />}</button><div><h4>{item.title}</h4><p>{item.detail}</p>{links(item.evidenceIds)}{actions("checklist", item.id)}</div></article>) : <div className="litigation-empty-copy"><ListChecks size={20} /><p>把需要补充或核对的内容列在这里，完成后逐项勾选。</p></div>}</section>
        {data.reviewNotes && <section className="litigation-review"><div><Sparkles size={15} /><h3>Orbit 整理意见</h3></div><p>{data.reviewNotes}</p></section>}
      </>}
      {tab === "facts" && <section className="litigation-section"><div className="litigation-section-title"><h3>事情是怎样发生的</h3><button type="button" disabled={busy} onClick={() => edit("events")}><Plus size={13} />添加事实</button></div>{progress.unlinked > 0 && <p className="litigation-note">{progress.unlinked} 条事实尚未关联材料，可逐条补充。</p>}{data.events.length ? <div className="litigation-timeline">{[...data.events].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999")).map((item) => <article className="litigation-timeline-item" key={item.id}><span className="litigation-timeline-dot" /><time>{item.date || "日期待确认"}<span>{item.id}</span></time><h4>{item.title}</h4><p>{item.detail}</p>{links(item.evidenceIds)}{actions("events", item.id)}</article>)}</div> : <div className="litigation-empty-copy"><p>先添加签约、付款、交付或沟通等关键事实，再关联对应材料。</p><button className="button secondary small" onClick={() => edit("events")}><Plus size={13} />添加第一条事实</button></div>}</section>}
      {tab === "evidence" && <section className="litigation-section"><div className="litigation-section-title"><h3>证据与材料目录</h3><button type="button" disabled={busy} onClick={() => edit("evidence")}><Plus size={13} />添加材料</button></div><p className="litigation-note">保存文字摘录与原件位置；导出包含目录和已录入内容。</p>{data.evidence.length ? <div className="litigation-materials">{data.evidence.map((item) => <article key={item.id} className={`litigation-material ${item.status === "missing" ? "is-missing" : ""} ${focus === item.id ? "is-focused" : ""}`}><div className="litigation-material-heading"><span>{item.id} · {item.kind}</span><span className={`litigation-status ${item.status}`}>{item.status === "checked" && <CheckCircle2 size={11} />}{evidenceStatus[item.status]}</span></div><h4>{item.title}</h4><p>{item.description || "材料内容待补充"}</p><small>来源 / 位置：{item.source || "待补充"}</small>{data.events.some((event) => event.evidenceIds.includes(item.id)) && <button className="litigation-backlink" onClick={() => setTab("facts")}><Link2 size={11} />关联 {data.events.filter((event) => event.evidenceIds.includes(item.id)).length} 条事实</button>}<div className="litigation-material-footer">{item.status === "missing" && <button className="litigation-ready-action" disabled={busy} onClick={() => edit("evidence", item.id)}>补充材料 <ArrowUpRight size={12} /></button>}{actions("evidence", item.id)}</div></article>)}</div> : <div className="litigation-empty-copy"><FileText size={21} /><p>添加合同、付款记录或沟通资料。尚未取得的材料也可先列为待补充。</p><button className="button secondary small" onClick={() => edit("evidence")}><Plus size={13} />添加第一项材料</button></div>}</section>}
    </>}
    <p className="litigation-footnote">整理事实与材料，供后续核对；不代表法律意见或已向法院提交。</p>
  </div>;
}
