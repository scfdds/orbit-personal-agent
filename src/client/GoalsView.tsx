import { GoalIcon } from "./GoalIcon.tsx";
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { AlertCircle, ArrowUpRight, Check, ChevronRight, Circle, Clock3, LoaderCircle, MessageSquare, MoreHorizontal, Pause, Play, Plus, X } from "lucide-react";
import type { Snapshot, Work } from "../shared/types.ts";
import { IconButton, Status } from "./ui.tsx";
import GoalExecutionPanel from "./GoalExecutionPanel.tsx";
import GoalDateFilter from "./GoalDateFilter.tsx";
import { SurfaceHeader } from "./SurfaceHeader.tsx";
import { filterTimeline, goalDisplayTimeline, timelineDay, type TimelineRange, type GoalTimelineItem } from "./goal-timeline.ts";
import "./goals.css";

interface Props {
  state: Snapshot;
  selected?: Work;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onConversation: (id: string) => void;
  onAction: (id: string, action: "pause" | "resume" | "end") => Promise<unknown>;
}
const inactive = (work: Work) => ["paused", "completed"].includes(work.status);
const clockLabel = (value: string) => new Date(value).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit" });
const dayKey = timelineDay;
const dayLabel = (value: string, clock: string, replay: boolean) => {
  if (!replay && dayKey(value) === dayKey(clock)) return "今天";
  return new Date(value).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric", weekday: "short" });
};

export default function GoalsView(p: Props) {
  const [execution, setExecution] = useState<{ workId: string; itemId: string }>();
  const origin = useRef<HTMLButtonElement | null>(null);
  const selectedItem = p.selected && execution?.workId === p.selected.id ? goalDisplayTimeline(p.selected, p.state).items.find(i => i.id === execution.itemId) : undefined;
  useEffect(() => setExecution(undefined), [p.selected?.id]);
  function closeExecution() { setExecution(undefined); origin.current?.focus({ preventScroll: true }); }
  function openExecution(item: GoalTimelineItem, button: HTMLButtonElement) { origin.current = button; setExecution({ workId: p.selected!.id, itemId: item.id }); }
  const tabs = [...p.state.works].sort((a, b) => Number(Boolean(b.showcase)) - Number(Boolean(a.showcase)) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (p.selected) tabRefs.current.get(p.selected.id)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [p.selected?.id]);
  function navigateTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    p.onSelect(tabs[next]!.id);
    tabRefs.current.get(tabs[next]!.id)?.focus({ preventScroll: true });
  }
  return <>
    <SurfaceHeader title="长期目标"><button className="surface-action" onClick={p.onCreate}><Plus size={15}/>新建目标</button></SurfaceHeader>
    {tabs.length > 0 && <div className="surface-filterbar"><div className="surface-tabs goal-tabs" role="tablist" aria-label="切换长期目标">{tabs.map((work, index) => <button
      key={work.id} ref={node => { if (node) tabRefs.current.set(work.id, node); else tabRefs.current.delete(work.id); }}
      id={`goal-tab-${work.id}`} role="tab" aria-selected={work.id === p.selected?.id} aria-controls="goal-content"
      tabIndex={work.id === p.selected?.id ? 0 : -1} title={work.title}
      onClick={() => p.onSelect(work.id)} onKeyDown={event => navigateTab(event, index)}>{work.title}</button>)}</div></div>}
    <div className={`goals-layout ${selectedItem ? "with-execution" : ""}`}><div className="goals-page">
    {p.selected ? <div id="goal-content" role="tabpanel" aria-labelledby={`goal-tab-${p.selected.id}`}><GoalContent key={p.selected.id} {...p} work={p.selected} selectedItem={selectedItem?.id} onOpen={openExecution} onFilter={() => setExecution(undefined)}/></div> : <div className="goals-empty"><GoalIcon size={32}/><h2>暂无长期目标</h2></div>}
  </div>
    {selectedItem && <><button className="goal-execution-backdrop" aria-label="收起执行详情" onClick={closeExecution}/><GoalExecutionPanel item={selectedItem} state={p.state} paused={inactive(p.selected!)} onClose={closeExecution} onConversation={p.onConversation}/></>}
  </div></>;
}

function GoalContent(p: Props & { work: Work; selectedItem?: string; onOpen: (item: GoalTimelineItem, button: HTMLButtonElement) => void; onFilter: () => void }) {
  const { work, state } = p;
  const [range, setRange] = useState<TimelineRange>({});
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(() => new Date().toISOString());
  useEffect(() => { const timer = setInterval(() => setClock(new Date().toISOString()), 60000); return () => clearInterval(timer); }, []);
  const conversation = state.conversations.find(c => c.id === work.conversationId);
  const { replay, items } = goalDisplayTimeline(work, state);
  const timelineClock = replay ? work.showcase!.clock : clock;
  const filtered = filterTimeline(items, range);
  const paused = inactive(work);
  async function action(value: "pause" | "resume" | "end") {
    setMenu(false); setBusy(true);
    try { await p.onAction(work.id, value); } catch { /* The application displays the API error. */ } finally { setBusy(false); }
  }
  return <article className="goal-detail">
    <header className="goal-detail-heading">
      <h2>{work.title}</h2>
      <div className="goal-action-menu"><IconButton label="目标操作" aria-expanded={menu} disabled={busy} onClick={() => setMenu(!menu)}><MoreHorizontal size={20}/></IconButton>{menu && <><button className="goal-menu-dismiss" aria-label="关闭目标操作" onClick={() => setMenu(false)}/><div className="goal-menu">
        {paused ? <button onClick={() => void action("resume")}><Play size={14}/>恢复目标</button> : <button onClick={() => void action("pause")}><Pause size={14}/>暂停目标</button>}
        {work.status !== "completed" && <button onClick={() => void action("end")}><X size={14}/>结束目标</button>}
      </div></>}</div>
    </header>
    <p className="goal-mandate">{work.goal}</p>
    {work.completionCriteria && !work.goal.includes(work.completionCriteria) && <p className="goal-stop-condition">{work.completionCriteria}</p>}
    <div className="goal-context-line"><button className="goal-conversation" title={conversation?.title} onClick={() => p.onConversation(work.conversationId)}><MessageSquare size={13}/><span>回到对话</span><ArrowUpRight size={12}/></button>{!replay || paused ? <Status status={work.status}/> : null}</div>
    <section className="goal-progress-section" aria-label="行动时间线">
      <div className="goal-timeline-heading"><h2>行动时间线</h2><GoalDateFilter value={range} clock={timelineClock} onChange={value => { setRange(value); p.onFilter(); }}/></div>
      {paused && <p className="goal-paused-note">{work.status === "completed" ? "目标已结束，后续行动已停止。" : "目标已暂停，后续行动不会执行。"}</p>}
      <Timeline items={filtered} clock={timelineClock} replay={replay} paused={paused} range={range} selectedItem={p.selectedItem} onOpen={p.onOpen}/>
      {!items.length && <p className="goal-timeline-empty">尚未安排后续行动。可以在下方告诉 Orbit 关注什么、何时继续。</p>}
    </section>
  </article>;
}

function Timeline({ items, clock, replay, paused, range, selectedItem, onOpen }: { items: GoalTimelineItem[]; clock: string; replay: boolean; paused: boolean; range: TimelineRange; selectedItem?: string; onOpen: (item: GoalTimelineItem, button: HTMLButtonElement) => void }) {
  const viewport = useRef<HTMLDivElement>(null);
  const positioned = useRef("");
  const ordered = [...items.filter(i => !i.future), ...items.filter(i => i.future)];
  const firstFuture = ordered.findIndex(i => i.future);
  const filterKey = `${range.from || ""}/${range.to || ""}`;
  // Position once per filter. Streaming updates and opening a detail must not move history.
  useLayoutEffect(() => {
    if (!items.length) { positioned.current = ""; return; }
    if (!viewport.current || positioned.current === filterKey) return;
    positioned.current = filterKey;
    const days = [...viewport.current.querySelectorAll<HTMLElement>("[data-timeline-day]")];
    const anchor = range.from || range.to ? days[0] : days.find(day => day.dataset.timelineDay! >= dayKey(clock)) || days.at(-1);
    if (anchor) viewport.current.scrollTop = anchor.offsetTop;
  }, [filterKey, items.length, clock, range.from, range.to]);
  let previousDay = "";
  return <div className="goal-timeline-viewport" ref={viewport} role="region" aria-label="时间线记录" tabIndex={0}><div className="goal-timeline">
    {!ordered.length && (range.from || range.to) && <p className="goal-timeline-empty">这段时间暂无行动记录</p>}
    {ordered.map((item, index) => {
      const day = item.at ? dayKey(item.at) : "event";
      const changed = day !== previousDay;
      previousDay = day;
      return <Fragment key={item.id}>
        {index === firstFuture && <div className={`goal-now ${paused ? "is-paused" : ""}`}><span>{replay ? "接下来" : `现在 ${clockLabel(clock)}`}</span><i/></div>}
        {changed && <div className="goal-timeline-day" data-timeline-day={day}>{item.at ? dayLabel(item.at, clock, replay) : "条件满足时"}</div>}
        <TimelineRow item={item} paused={paused} selected={selectedItem === item.id} onOpen={onOpen}/>
      </Fragment>;
    })}
    {ordered.length > 0 && firstFuture < 0 && !replay && !range.to && <div className={`goal-now ${paused ? "is-paused" : ""}`}><span>现在 {clockLabel(clock)}</span><i/></div>}
  </div></div>;
}

function TimelineRow({ item, paused, selected, onOpen }: { item: GoalTimelineItem; paused: boolean; selected: boolean; onOpen: (item: GoalTimelineItem, button: HTMLButtonElement) => void }) {
  const active = ["running", "queued"].includes(item.status);
  const failed = ["failed", "interrupted"].includes(item.status);
  const Icon = active ? LoaderCircle : failed ? AlertCircle : item.status === "cancelled" || (paused && item.future) ? Pause : item.future ? Circle : Check;
  return <div className={`goal-timeline-row ${item.future ? "is-future" : ""} ${failed ? "has-issue" : ""} ${active ? "is-running" : ""}`}>
    <time dateTime={item.at}>{item.at ? clockLabel(item.at) : <Clock3 size={14}/>}</time>
    <span className="goal-timeline-node"><Icon size={15} className={active ? "spin" : ""}/></span>
    <button className="goal-timeline-card" aria-label={`${item.at ? `${dayKey(item.at)} ${clockLabel(item.at)} ` : ""}${item.title}`} aria-expanded={selected} aria-controls={selected ? "goal-execution-panel" : undefined} onClick={e => onOpen(item, e.currentTarget)}>
      <span className="goal-row-title"><strong>{item.title}</strong>{item.cadence && <span className="goal-cadence">{item.cadence}</span>}{item.addedBy && <span className="goal-added-by">{item.addedBy}</span>}<ChevronRight size={13} className="goal-row-chevron"/></span><span className="goal-row-summary">{item.summary}</span>
    </button>
  </div>;
}
