import { ArrowUpRight, ChevronDown, ChevronUp, CircleCheck, LoaderCircle, MessageSquare } from "lucide-react";
import type { AssistantOverview, AssistantOverviewItem } from "../../shared/assistant.ts";
import { dateLabel, plainSummary } from "./workspace-state.ts";
import "./workspace-home.css";
import OrbitAvatar from "./OrbitAvatar.tsx";
import { getMatterPresentation } from "./matter-presentation.ts";
import "./overview-compact.css";

type Props = {
  overview: AssistantOverview | null;
  expanded: boolean;
  onToggle: () => void;
  onOpen: (id: string) => void;
  onExamples: () => void;
  importing: boolean;
  compact?: boolean;
};

const statusText: Record<string, string> = {
  running: "正在处理", waiting: "等待条件", needs_input: "等你确认", failed: "需要关注", interrupted: "已中断",
  paused: "已暂停", completed: "最近回复", idle: "最近讨论",
};

function progressText(item: AssistantOverviewItem) {
  return getMatterPresentation(item).progress;
}

export default function WorkOverview({ overview, expanded, onToggle, onOpen, onExamples, importing, compact = false }: Props) {
  if (!overview) return <section className="dt-work-loading" aria-label="正在读取工作进展" aria-busy="true">
    <span className="dt-work-loading-line"/><span className="dt-work-loading-line"/>
  </section>;

  const items = overview.items.slice(0, 3);

  if (!items.length && compact) return <section className="dt-work-strip dt-work-strip-compact" aria-label="最近工作进展"><span className="dt-work-strip-label"><CircleCheck size={14}/>最近进展</span><span className="dt-work-strip-empty">事项的后续进展会留在这里</span></section>;

  if (!items.length) return <section className="dt-work-empty" aria-label="开始使用工作空间">
    <OrbitAvatar size={50}/>
    <div className="dt-work-empty-copy">
      <h2>从这里交代一件事。</h2>
      <p>随时提问，或一起推进一项工作。需要持续跟进的事情，会在这里保留进展。</p>
      <button className="dt-work-example-button" onClick={onExamples} disabled={importing}>
        {importing ? <LoaderCircle size={13} className="dt-spin"/> : <MessageSquare size={13}/>}
        {importing ? "正在添加示例…" : "添加示例，体验完整工作流程"}<ArrowUpRight size={12}/>
      </button>
      <small>示例与真实工作分别标记，不会执行真实任务。</small>
    </div>
  </section>;

  const attention = items.filter(item => item.status === "needs_input" || item.status === "failed");
  const briefing = plainSummary(overview.briefing?.text || (attention.length
    ? `${attention.map(item => `「${item.title}」`).join("、")}有待处理的进展。可以打开继续，也可以直接告诉我下一步。`
    : "这里保留了最近几件事的进展。可以直接继续，也可以随时交代新的事情。"), 210);

  if (!expanded) return <section className={`dt-work-strip${compact ? " dt-work-strip-compact" : ""}`} aria-label="最近工作进展">
    <span className="dt-work-strip-label"><CircleCheck size={14}/>最近进展</span>
    <div className="dt-work-strip-items">{items.slice(0, compact ? 1 : 2).map(item => <button key={item.conversationId} onClick={() => onOpen(item.conversationId)} title={`${item.title} · ${progressText(item)}`} aria-label={`打开事项：${item.title}`}><span>{item.title}</span><ArrowUpRight size={11}/></button>)}</div>
    <button className="dt-work-toggle" aria-label="展开工作概览" aria-expanded="false" onClick={onToggle}><ChevronDown size={15}/></button>
  </section>;

  return <section className={`dt-work-overview${compact ? " dt-work-overview-compact" : ""}`} aria-label="最近工作进展">
    <header className="dt-work-heading">
      <span><span className="dt-work-heading-dot"/>最近进展<small>根据已有讨论</small></span>
      <button className="dt-work-toggle" aria-label="收起工作概览" aria-expanded="true" onClick={onToggle}><ChevronUp size={15}/></button>
    </header>
    {!compact && <p className="dt-work-briefing">{briefing}</p>}
    <div className="dt-work-cards">{items.map(item => <button
      className={`dt-work-card dt-work-card-${item.status}`}
      key={item.conversationId}
      onClick={() => onOpen(item.conversationId)}
      aria-label={`打开事项：${item.title}`}
    >
      <span className="dt-work-card-top"><span className={`dt-work-status dt-work-status-${item.status}`}><i/>{statusText[item.status] || "最近讨论"}</span>{item.example && <span className="dt-work-example-tag">示例</span>}<ArrowUpRight size={13}/></span>
      <strong title={item.title}>{item.title}</strong>
      <span className="dt-work-card-summary">{progressText(item)}</span>
      <span className="dt-work-card-bottom">{item.attentionReason ? <span className="dt-work-attention">{plainSummary(item.attentionReason, 46)}</span> : <span>{dateLabel(item.updatedAt)}</span>}</span>
    </button>)}</div>
  </section>;
}
