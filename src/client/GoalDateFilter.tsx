import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { timelineDay, type TimelineRange } from "./goal-timeline.ts";

export default function GoalDateFilter({ value, clock, onChange }: { value: TimelineRange; clock: string; onChange: (range: TimelineRange) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const today = timelineDay(clock);
  const invalid = Boolean(draft.from && draft.to && draft.from > draft.to);
  const label = !value.from && !value.to ? "全部日期" : value.from === today && value.to === today ? "今天" : value.from === value.to ? value.from : `${value.from || "不限"} — ${value.to || "不限"}`;
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  function apply(range: TimelineRange) { onChange(range); setOpen(false); trigger.current?.focus(); }
  return <div className="goal-date-filter" ref={root} onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); trigger.current?.focus(); } }}>
    <button ref={trigger} className="goal-date-trigger" aria-label={`筛选日期：${label}`} aria-expanded={open} onClick={() => { setDraft(value); setOpen(!open); }}><CalendarDays size={14}/><span>{label}</span><ChevronDown size={12}/></button>
    {open && <div className="goal-date-popover" role="dialog" aria-label="筛选日期">
      <div className="goal-date-shortcuts">
        <button onClick={() => apply({})}>全部日期</button>
        <button onClick={() => apply({ from: today, to: today })}>今天</button>
        <button onClick={() => apply({ from: timelineDay(new Date(new Date(`${today}T12:00:00+08:00`).getTime() - 6 * 86400000).toISOString()), to: today })}>最近 7 天</button>
      </div>
      <div className="goal-date-inputs">
        <label>开始日期<input type="date" value={draft.from || ""} onInput={e => { const from = e.currentTarget.value || undefined; setDraft(previous => ({ ...previous, from })); }}/></label>
        <label>结束日期<input type="date" value={draft.to || ""} onInput={e => { const to = e.currentTarget.value || undefined; setDraft(previous => ({ ...previous, to })); }}/></label>
      </div>
      {invalid && <p role="alert">结束日期不能早于开始日期</p>}
      <button className="button" disabled={invalid} onClick={() => apply(draft)}>应用</button>
    </div>}
  </div>;
}
