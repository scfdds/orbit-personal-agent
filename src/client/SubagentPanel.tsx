import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  ArrowUp,
  X,
  ChevronRight,
  Circle,
  LoaderCircle,
  Check,
  AlertCircle,
  Square,
  Plus,
} from "lucide-react";
import type { Snapshot } from "../shared/types.ts";
import { RichText } from "./ChatView.tsx";
import { timeLabel } from "./ui.tsx";
import { AgentAvatar } from "./VisualIdentity.tsx";

export default function SubagentPanel({
  state,
  conversationId,
  agentId,
  onSelect,
  onContinue,
  onStop,
}: {
  state: Snapshot;
  conversationId: string;
  agentId?: string;
  onSelect: (id?: string) => void;
  onContinue: (id: string, instructions: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onCreate: (instructions: string) => Promise<void>;
}) {
  const agents = (state.subagents || []).filter(
    (a) => a.conversationId === conversationId,
  );
  const agent = agents.find((a) => a.id === agentId);
  const [tab, setTab] = useState<"process" | "definition">("process");
  const [runId, setRunId] = useState("");
  const [composing, setComposing] = useState(false);
  const followupRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const agentRunCount = state.runs.filter((r) => r.subagentId === agentId).length;
  const mainRunning = state.runs.some((r) => r.conversationId === conversationId && !r.parentId && ["running", "queued"].includes(r.status));
  useEffect(() => { setSubmitted(false); }, [agentRunCount, agentId]);
  useEffect(() => { setTab("process"); setRunId(""); setComposing(false); setError(""); }, [agentId, conversationId]);
  useEffect(() => { if (!mainRunning) setSubmitted(false); }, [mainRunning]);
  if (!agent) {
    // Each persisted agent currently owns one session. Only sessions with
    // actual runs belong in this task view; unused definitions stay out.
    const sessions = agents.map(executor => {
      const executions = state.runs.filter(r => r.subagentId === executor.id)
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      return { executor, executions, latest: executions.at(-1) };
    }).filter(session => session.latest);
    const runningCount = sessions.filter(s => s.latest?.status === "running").length;
    return (
      <div className="app-surface child-app">
        <div className="child-list-heading">
          <div><h2>子任务</h2>{sessions.length > 0 && <p>{sessions.length} 项{runningCount > 0 ? ` · ${runningCount} 项执行中` : ""}</p>}</div>
        </div>
        {sessions.length ? <div className="subtask-session-list">
          {sessions.map(({executor, executions, latest}) => {
            const events = (state.subagentEvents || []).filter(e => e.agentId === executor.id && e.runId === latest!.id).sort((a,b) => a.createdAt.localeCompare(b.createdAt));
            const result = events.find(e => e.kind === "result");
            const summary = latest!.status === "running"
              ? events.at(-1)?.title || "正在执行"
              : result?.content || latest!.summary || latest!.error || "";
            return <button className="subtask-session-card" key={executor.id} onClick={() => { setRunId(""); setTab("process"); onSelect(executor.id); }}>
              <div className="subtask-session-title"><strong>{executions[0].title || executor.name}</strong><AgentStatus status={latest!.status}/></div>
              {summary && <p className="subtask-session-summary">{summary.replace(/[#*_`]/g, "")}</p>}
              <div className="subtask-session-footer"><AgentAvatar identity={executor.id} size={20}/><span>{executor.name}</span><time>{timeLabel(latest!.finishedAt || latest!.startedAt)}</time><ChevronRight size={14}/></div>
            </button>;
          })}
        </div> : <div className="subtask-session-empty"><p>暂无子任务</p><span>Orbit 安排的子任务会显示在这里。</span></div>}
      </div>
    );
  }
  const runs = state.runs.filter((r) => r.subagentId === agent.id).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const run = runs.find((r) => r.id === runId) || runs.at(-1);
  const definition = run?.definition || agent;
  const capability = state.subagentCapabilities;
  return (
    <div className="app-surface child-app child-detail">
      <button className="text-button work-back" onClick={() => onSelect()}>
        <ArrowLeft size={13} />
        全部子任务
      </button>
      <div className="agent-detail-heading">
        <div className="child-task-heading"><h2>{runs[0]?.title || agent.name}</h2><button className="child-agent-link" onClick={() => { setRunId(""); setTab("definition"); }}><AgentAvatar identity={agent.id} size={24} /><span>{agent.name}</span><ChevronRight size={12} /></button></div>
        {!agent.legacy && (agent.status === "running" ? (
          <button className="button secondary small" disabled={busy} onClick={async () => {
            setBusy(true); setError("");
            try { await onStop(agent.id); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
          }}><Square size={12} />停止</button>
        ) : (
          <button className="button secondary small" aria-expanded={composing} onClick={() => {
            setComposing(!composing);
            if (!composing) requestAnimationFrame(() => followupRef.current?.querySelector("textarea")?.focus());
          }}>{composing ? <X size={13} /> : <Plus size={13} />}{composing ? "收起" : "继续委派"}</button>
        ))}
      </div>
      {error && <p className="inline-error">{error}</p>}
      {submitted && <p className="delegate-success" role="status"><Check size={14} />已交给 Orbit，新的执行进度会显示在这里。</p>}
      <div ref={followupRef}>
        {composing && agent.status !== "running" && <DelegateComposer label={`继续交给${agent.name}`} submitLabel="继续委派" placeholder="交代下一步，会沿用这个子 Agent 的上下文…" onSubmit={(instructions) => onContinue(agent.id, instructions)} onSuccess={() => { setComposing(false); setRunId(""); setTab("process"); setSubmitted(true); }} />}
      </div>
      <div className="child-tabs" role="tablist" aria-label="子 Agent 详情">
        <button
          role="tab"
          aria-selected={tab === "process"}
          onClick={() => setTab("process")}
        >
          过程与结果
        </button>
        <button
          role="tab"
          aria-selected={tab === "definition"}
          onClick={() => setTab("definition")}
        >
          Agent 设定
        </button>
      </div>
      {tab === "definition" ? (
        <div className="agent-settings" role="tabpanel" aria-label="Agent 设定">
          {agent.legacy ? <p className="muted">历史记录未保存 Agent 设定。</p> : <>
            <section className="agent-settings-section">
              <div className="agent-settings-label"><h3>职责</h3><span>System prompt · v{definition.version}</span></div>
              <div className="agent-instructions">{definition.systemPrompt}</div>
            </section>
            <section className="agent-settings-section">
              <div className="agent-settings-label"><h3>能力</h3></div>
              <div className="agent-ability-row"><span>Skills</span><div>
                {definition.skillIds.length ? definition.skillIds.map(id => {
                  const skill = capability?.skills.find(s => s.id === id);
                  return <details className="agent-skill" key={id}><summary>{skill?.name || id}<ChevronRight size={12}/></summary><p>{skill?.description || id}</p></details>;
                }) : <span className="muted">未分配</span>}
              </div></div>
              <div className="agent-ability-row"><span>工具</span><div className="agent-tool-tags">
                {definition.toolNames.filter(name => !capability?.mcpServers.some(server => server.tools.includes(name))).map(name => {
                  const tool = capability?.tools.find(t => t.name === name);
                  return <span className="agent-tool-tag" title={tool?.source ? name + " · " + tool.source : name} key={name}>{tool?.label || name}</span>;
                })}
                {!definition.toolNames.some(name => !capability?.mcpServers.some(server => server.tools.includes(name))) && <span className="muted">未分配</span>}
              </div></div>
              <div className="agent-ability-row"><span>MCP</span><div>
                {capability?.mcpServers.filter(server => server.tools.some(name => definition.toolNames.includes(name))).map(server => <details className="agent-skill" key={server.id}><summary>{server.name}<ChevronRight size={12}/></summary><div className="agent-tool-tags">{server.tools.filter(name => definition.toolNames.includes(name)).map(name => <span className="agent-tool-tag" key={name}>{name}</span>)}</div></details>)}
                {!capability?.mcpServers.some(server => server.tools.some(name => definition.toolNames.includes(name))) && <span className="muted">未分配</span>}
              </div></div>
            </section>
            <details className="agent-settings-extra"><summary>执行设定记录<ChevronRight size={12}/></summary>
              <p>每次执行保留当时的设定。</p>
              {runs.length > 0 && <select aria-label="查看执行时的 Agent 设定" value={run?.id} onChange={e => setRunId(e.target.value)}>{[...runs].reverse().map((r, i) => <option key={r.id} value={r.id}>第 {runs.length - i} 次 · {timeLabel(r.startedAt)}</option>)}</select>}
              <p>基础规则：仅使用分配能力、只读应用数据、不递归创建 Agent。</p>
            </details>
          </>}
        </div>
      ) : (
        <div className="agent-sessions" role="tabpanel" aria-label="过程与结果">
          {!runs.length && <p className="muted">尚未收到委派。</p>}
          {runs.map((execution, index) => {
            const events = (state.subagentEvents || []).filter(e => e.agentId === agent.id && e.runId === execution.id).sort((a,b) => a.createdAt.localeCompare(b.createdAt));
            const result = events.find(e => e.kind === "result");
            const input = events.find(e => e.kind === "input")?.content || execution.instructions;
            const steps = events.filter(e => e.kind !== "input" && e.kind !== "result" && e.kind !== "error" && !(e.kind === "progress" && e.content === result?.content));
            const errors = events.filter(e => e.kind === "error");
            return <section className="agent-session" key={execution.id}>
              <header className="agent-session-heading"><span className="agent-session-dot"/><strong>{index === 0 ? "首次委派" : "继续执行"}</strong><time>{timeLabel(execution.startedAt)}</time><AgentStatus status={execution.status}/></header>
              <div className="agent-session-body">
                {input && <details className="agent-task-brief"><summary><span>{input}</span><ChevronRight size={14}/></summary><RichText>{input}</RichText></details>}
                {steps.length > 0 && <details className="agent-process" open={execution.status === "running"}>
                  <summary><ChevronRight size={14}/><span>{execution.status === "running" ? "正在执行" : "执行过程"}</span><small>{steps.filter(e => e.kind === "tool").length} 次工具调用</small></summary>
                  <div className="agent-process-steps">{steps.map(event => event.kind === "tool" ? <details className="agent-tool-step" key={event.id}>
                    <summary>{event.status === "running" ? <LoaderCircle size={13} className="spin"/> : event.status === "failed" ? <AlertCircle size={13}/> : <Check size={13}/>}<span>{event.title || event.toolName}</span><ChevronRight size={12}/></summary>
                    <div className="agent-tool-payload"><code>{event.toolName}</code><small>输入</small><pre>{event.input || "—"}</pre><small>结果</small><pre>{event.content || "执行中…"}</pre></div>
                  </details> : <div className="agent-progress-note" key={event.id}><RichText>{event.content}</RichText></div>)}</div>
                </details>}
                {(result?.content || execution.summary) && <div className="agent-session-result"><RichText>{result?.content || execution.summary}</RichText></div>}
                {errors.map(event => <p className="inline-error" key={event.id}>{event.content || event.title}</p>)}
                {!errors.length && execution.error && <p className="inline-error">{execution.error}</p>}
                {!events.length && !execution.summary && <p className="muted">等待执行记录。</p>}
              </div>
            </section>;
          })}
        </div>
      )}

    </div>
  );
}


function AgentStatus({ status }: { status: string }) {
  const label = ({ running: "执行中", queued: "等待执行", completed: "已完成", failed: "需处理", cancelled: "已停止", interrupted: "已中断", idle: "待命" } as Record<string, string>)[status] || "待命";
  return <span className={`agent-state agent-state-${status}`}>
    {status === "running" || status === "queued" ? <LoaderCircle size={12} className="spin" /> : status === "completed" ? <Check size={12} /> : status === "failed" ? <AlertCircle size={12} /> : <Circle size={7} />}{label}
  </span>;
}

function DelegateComposer({ onSubmit, label, placeholder, submitLabel, onSuccess, showSuggestions = false }: {
  onSubmit: (text: string) => Promise<void>;
  label: string;
  placeholder: string;
  submitLabel: string;
  onSuccess?: () => void;
  showSuggestions?: boolean;
}) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const submit = async () => {
    if (!text.trim() || pending) return;
    setPending(true); setError(""); setSent(false);
    try { await onSubmit(text.trim()); setText(""); setSent(true); onSuccess?.(); }
    catch (e) { setError((e as Error).message); }
    finally { setPending(false); }
  };
  const examples = [
    ["审阅合同", "请安排两位子 Agent 分别核对当前合同的付款与交付条款，提出有原文依据的建议，再汇总需要我确认的地方。"],
    ["比较方案", "根据当前对话中的备选方案，安排子 Agent 分别评估收益与风险，再汇总主要分歧和选择依据。"],
    ["交叉复核", "安排一位子 Agent 整理当前资料的主要结论，另一位独立检查证据与遗漏，最后汇总一致和有分歧的地方。"],
  ];
  return <form className="delegate-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
    <label>{label}</label>
    <div className={`delegate-input ${pending ? "is-pending" : ""}`}>
      <textarea ref={ref} aria-label={label} value={text} maxLength={8000} rows={3} placeholder={placeholder} disabled={pending}
        onChange={(e) => { setText(e.target.value); setSent(false); }}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); } }} />
      <div className="delegate-input-footer"><span>由 Orbit 分配与汇总</span><button className="button primary" type="submit" disabled={!text.trim() || pending}>
        {pending ? <LoaderCircle size={14} className="spin" /> : <ArrowUp size={14} />}{pending ? "提交中…" : submitLabel}
      </button></div>
    </div>
    {showSuggestions && <div className="delegate-examples">{examples.map(([title, prompt]) => <button type="button" key={title} disabled={pending} onClick={() => { setText(prompt); setSent(false); ref.current?.focus(); }}>{title}<ArrowUpRight size={12} /></button>)}</div>}
    {sent && <p className="delegate-success" role="status"><Check size={14} />已交给 Orbit，分工会出现在这里。</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </form>;
}
