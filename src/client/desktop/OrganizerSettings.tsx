import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronRight, LoaderCircle, RotateCcw } from "lucide-react";
import type { WorkspaceOrganizerState } from "../../shared/workspace-organizer.ts";
import { useWorkspaceRequest } from "../api.ts";
import "./organizer-settings.css";

type Action = WorkspaceOrganizerState["actions"][number];
type Settings = WorkspaceOrganizerState["settings"];
type Props = { onChanged?: () => Promise<void> };

function formatTime(value?: string) {
  if (!value) return "尚未整理";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "尚未整理";
  return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

function actionLabel(action: Action) {
  if (action.state === "applied") return "已整理";
  if (action.state === "undone") return "已撤销";
  if (action.state === "stale") return "内容已变化";
  return "已处理";
}

/** Background organization stays in settings; it never interrupts the conversation. */
export default function OrganizerSettings({ onChanged }: Props) {
  const request = useWorkspaceRequest();
  const id = useId();
  const [state, setState] = useState<WorkspaceOrganizerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const alive = useRef(false), sequence = useRef(0), mutating = useRef(false), reading = useRef(false);

  const load = useCallback(async () => {
    if (mutating.current || reading.current) return;
    reading.current = true;
    const ticket = ++sequence.current;
    const current = () => alive.current && ticket === sequence.current;
    try {
      const next = await request<WorkspaceOrganizerState>("/organizer");
      if (current()) { setState(next); setError(""); }
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : "暂时无法读取整理设置，请重试。");
    } finally {
      reading.current = false;
      if (current()) setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    alive.current = true;
    const timer = window.setTimeout(() => void load(), 0);
    return () => { clearTimeout(timer); alive.current = false; sequence.current++; };
  }, [load]);

  const active = state?.status === "running" || state?.status === "queued";
  useEffect(() => {
    const visible = () => { if (!document.hidden && !mutating.current) void load(); };
    const timer = active ? window.setInterval(visible, 2500) : undefined;
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", visible);
    return () => {
      if (timer !== undefined) clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", visible);
    };
  }, [active, load]);

  async function mutate(key: string, path: string, method: string, body: unknown) {
    if (mutating.current) return;
    mutating.current = true;
    const ticket = ++sequence.current;
    const current = () => alive.current && ticket === sequence.current;
    setPending(key); setError("");
    try {
      const next = await request<WorkspaceOrganizerState>(path, method, body);
      if (current()) setState(next);
      if (current() && key !== "settings") {
        try { await onChanged?.(); }
        catch { if (current()) setError("整理结果已保存，工作区暂时未刷新。重新打开页面可查看。"); }
      }
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : "操作未完成，请重试。");
    } finally {
      mutating.current = false;
      if (current()) setPending(null);
    }
  }

  const save = (settings: Partial<Settings>) => mutate("settings", "/organizer/settings", "PATCH", settings);
  const undo = (action: Action) => mutate(`${action.id}:undo`, `/organizer/actions/${encodeURIComponent(action.id)}/undo`, "POST", {});
  const history = [...(state?.actions || [])].filter(action => ["applied", "undone", "stale"].includes(action.state)).sort((a, b) => (b.appliedAt || b.createdAt).localeCompare(a.appliedAt || a.createdAt)).slice(0, 10);
  const working = !!pending || state?.status === "running";

  function renderAction(action: Action) {
    const changing = pending?.startsWith(`${action.id}:`);
    return <li className="dt-organizer-action" key={action.id}>
      <div className="dt-organizer-action-heading"><strong>{action.title}</strong><span>{actionLabel(action)}</span></div>
      <p className="dt-organizer-action-description">{action.fromLabel || action.toLabel ? `${action.fromLabel || "未归类"} → ${action.toLabel || "未归类"}` : action.description}</p>
      {action.reason && <p className="dt-organizer-action-reason">{action.reason}</p>}
      {action.state === "applied" && <div className="dt-organizer-action-buttons">
        {changing && <LoaderCircle size={12} className="dt-spin" aria-label="正在处理"/>}
        <button type="button" className="dt-text-button" disabled={working} onClick={() => void undo(action)}><RotateCcw size={12}/>撤销</button>
      </div>}
    </li>;
  }

  return <section className="dt-organizer-settings" aria-label="自动整理设置">
    {loading ? <p className="dt-settings-status"><LoaderCircle size={14} className="dt-spin"/>正在读取设置…</p> : state && <>
      <div className="dt-organizer-enable">
        <div><h3 id={`${id}-heading`}>自动整理项目与对话</h3><p>空闲时自动归类对话、整理摘要与项目记忆。</p></div>
        <button type="button" className="dt-organizer-switch" role="switch" aria-labelledby={`${id}-heading`} aria-checked={state.settings.enabled} disabled={!!pending} onClick={() => void save({ enabled: !state.settings.enabled })}><span/></button>
      </div>
      <div className="dt-organizer-options">
        <div className="dt-organizer-field"><label htmlFor={`${id}-interval`}>检查频率</label><select id={`${id}-interval`} value={state.settings.intervalMinutes} disabled={!!pending} onChange={event => void save({ intervalMinutes: Number(event.target.value) as Settings["intervalMinutes"] })}><option value={15}>每 15 分钟</option><option value={60}>每小时</option><option value={240}>每 4 小时</option></select></div>
        <p className="dt-organizer-help">保留你手动调整的名称和归属。</p>
      </div>
      <div className="dt-organizer-run"><p role="status">{active ? <>{state.status === "running" && <LoaderCircle size={12} className="dt-spin"/>}{state.status === "queued" ? "已安排整理" : "正在整理"}</> : <span>{state.lastRunAt ? `上次整理 ${formatTime(state.lastRunAt)}` : "尚未整理"}</span>}<span className="dt-organizer-status-divider">·</span><span>{state.pendingCount} 段待检查</span></p><button type="button" className="dt-secondary" disabled={working} onClick={() => void mutate("scan", "/organizer/scan", "POST", {})}>{pending === "scan" ? "正在启动…" : "立即整理"}</button></div>
      {state.lastError && !error && <p className="dt-settings-error" role="alert">{state.lastError}</p>}
      <div className="dt-organizer-records">
        <details className="dt-organizer-group"><summary><ChevronRight size={13}/>最近整理<span>{history.length}</span></summary>{history.length ? <ul>{history.map(renderAction)}</ul> : <p className="dt-organizer-empty">暂无整理记录</p>}</details>
      </div>
    </>}
    {error && <p className="dt-settings-error" role="alert">{error}<button type="button" className="dt-text-button" disabled={!!pending} onClick={() => void load()}>重新读取</button></p>}
  </section>;
}
