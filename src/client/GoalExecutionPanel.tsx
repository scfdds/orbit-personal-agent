import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, ChevronDown, Clock3, X } from "lucide-react";
import type { Activity, Run, Snapshot } from "../shared/types.ts";
import { request } from "./api.ts";
import { RichText } from "./ChatView.tsx";
import { IconButton, timeLabel } from "./ui.tsx";
import type { GoalTimelineItem } from "./goal-timeline.ts";

const runLabel: Record<GoalTimelineItem["status"], string> = { planned: "待执行", queued: "等待执行", running: "执行中", completed: "已完成", failed: "执行失败", cancelled: "已停止", interrupted: "已中断" };
const timestamp = (value: string) => new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
function duration(start?: string, end?: string) {
  if (!start || !end) return "";
  const seconds = Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 1000));
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}
export default function GoalExecutionPanel({ item, state, paused, onClose, onConversation }: { item: GoalTimelineItem; state: Snapshot; paused: boolean; onClose: () => void; onConversation: (id: string) => void }) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { panel.current?.focus({ preventScroll: true }); }, [item.id]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);
  const elapsed = duration(item.at, item.run?.finishedAt || item.finishedAt);
  return <aside className="goal-execution-panel" id="goal-execution-panel" aria-label="执行详情" ref={panel} tabIndex={-1}>
    <header><h2>执行详情</h2><IconButton label="关闭执行详情" onClick={onClose}><X size={18}/></IconButton></header>
    <div className="goal-execution-content">
      <div className="goal-execution-meta"><span className={`execution-state ${item.status}`}>{item.future && paused ? "已暂停" : runLabel[item.status]}</span>{item.cadence && <span>{item.cadence}</span>}</div>
      <h1>{item.title}</h1>
      <p className="goal-execution-time"><Clock3 size={13}/>{item.at ? `${item.future ? "计划" : "开始于"} ${timestamp(item.at)}` : "条件满足时执行"}{elapsed && ` · 用时 ${elapsed}`}</p>
      {item.addedBy && <p className="goal-execution-origin">{item.addedBy}</p>}
      {item.future ? <section><h3>执行安排</h3><p>{item.summary}</p>{item.detail && <p>{item.detail}</p>}</section> : item.run ? <RunDetail key={item.run.id} run={item.run} state={state} onConversation={onConversation}/> : <>
        {item.steps && <section><h3>执行过程</h3><ol className="goal-operation-list">{item.steps.map((step, index) => <li key={index}><span className="goal-operation-dot"/><div><strong>{step.title}</strong>{step.detail && <p>{step.detail}</p>}</div><small>{timeLabel(step.at)}</small></li>)}</ol></section>}
        <section><h3>执行结果</h3><div className="goal-execution-result"><p>{item.summary}</p>{item.detail && <p>{item.detail}</p>}</div></section>
      </>}
    </div>
  </aside>;
}
function RunDetail({ run, state, onConversation }: { run: Run; state: Snapshot; onConversation: (id: string) => void }) {
  const [history, setHistory] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    setLoading(true); setError("");
    void request<Activity[]>(`/runs/${encodeURIComponent(run.id)}/activities`).then(records => {
      if (current) setHistory(records);
    }).catch(() => { if (current) setError("历史过程暂时未能加载，重新打开可重试。"); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [run.id, run.status]);
  // The live snapshot contains only the latest 500 global activities. Fetch older history on demand.
  const activities = [...new Map([...history, ...state.activities.filter(a => a.runId === run.id)].map(a => [a.id, a])).values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const children = state.runs.filter(r => r.parentId === run.id);
  const response = state.messages.filter(m => m.runId === run.id && m.role === "assistant").map(m => m.content).join("\n\n");
  return <>
    <section><h3>执行过程</h3>{error && <p role="status">{error}</p>}{activities.length > 0 ? <ol className="goal-operation-list">{activities.map(a => <li key={a.id}><span className={`goal-operation-dot ${a.status || ""}`}/><div><strong>{a.title}</strong>{a.detail && <details className="goal-operation-data"><summary>查看详情</summary><p>{a.detail}</p></details>}</div><small>{timeLabel(a.createdAt)}</small></li>)}</ol> : !error && <p>{loading ? "正在加载过程…" : "暂无过程记录"}</p>}
      {children.map(child => <details className="goal-child-run" key={child.id}><summary><span>{child.title}</span><small>{runLabel[child.status]}</small><ChevronDown size={12}/></summary><p>{child.summary || child.error || "执行中…"}</p></details>)}
    </section>
    <section><h3>{["running", "queued"].includes(run.status) ? "当前进展" : "执行结果"}</h3><div className="goal-execution-result"><RichText>{response || run.error || run.summary || "尚未产生结果。"}</RichText></div></section>
    <button className="text-button" onClick={() => onConversation(run.conversationId)}>回到对话<ArrowUpRight size={13}/></button>
  </>;
}
