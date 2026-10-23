import type { Run, Snapshot, Work } from "../shared/types.ts";

export interface GoalTimelineItem {
  id: string;
  at?: string;
  title: string;
  summary: string;
  detail?: string;
  status: Run["status"] | "planned";
  future: boolean;
  cadence?: string;
  addedBy?: string;
  run?: Run;
  finishedAt?: string;
  steps?: Array<{ at: string; title: string; detail?: string }>;
}
export interface TimelineRange { from?: string; to?: string }
export const timelineDay = (value: string) => new Date(value).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
export function filterTimeline(items: GoalTimelineItem[], range: TimelineRange): GoalTimelineItem[] {
  if (range.from && range.to && range.from > range.to) return [];
  return items.filter(item => {
    if (!range.from && !range.to) return true;
    if (!item.at) return false;
    const day = timelineDay(item.at);
    return (!range.from || day >= range.from) && (!range.to || day <= range.to);
  });
}
export function goalDisplayTimeline(work: Work, state: Pick<Snapshot, "runs" | "triggers">) {
  const real = goalTimeline(work, state);
  const replay = Boolean(work.showcase && !real.length);
  const items: GoalTimelineItem[] = replay ? work.showcase!.entries.map(e => ({ ...e, status: e.state === "done" ? "completed" : "planned", future: e.state === "planned" })) : real;
  return { replay, items };
}
const cadence = (minutes?: number) => minutes === 1440 ? "每天" : minutes === 10080 ? "每周" : minutes && minutes % 60 === 0 ? `每 ${minutes / 60} 小时` : `每 ${minutes || 1} 分钟`;
/** Read existing execution and scheduling records. A planned trigger is never a completed run. */
export function goalTimeline(work: Work, state: Pick<Snapshot, "runs" | "triggers">): GoalTimelineItem[] {
  const history: GoalTimelineItem[] = state.runs.filter(r => r.workId === work.id && !r.parentId)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map(run => ({ id: run.id, at: run.startedAt, title: run.title, status: run.status, future: false, run,
      summary: run.error || run.summary || (["queued", "running"].includes(run.status) ? "正在推进，结果会更新在这里。" : "本轮执行已结束。") }));
  const planned: GoalTimelineItem[] = state.triggers.filter(t => t.workId === work.id && t.enabled)
    .sort((a, b) => (a.nextRunAt || "z").localeCompare(b.nextRunAt || "z"))
    .map(t => ({ id: t.id, at: t.kind === "interval" ? t.nextRunAt : undefined,
      title: t.kind === "event" ? "收到新反馈后继续" : t.instructions.split(/[。\n]/)[0]!.slice(0, 45) || "定时检查",
      status: "planned", future: true, cadence: t.kind === "interval" ? cadence(t.intervalMinutes) : "事件触发",
      summary: t.instructions, detail: t.kind === "event" ? "收到新的反馈事件时，在来源对话中继续推进这个目标。" : "由已有定时机制唤起，在来源对话中执行。执行结果和工具调用由系统自动记录。本地服务需要保持运行。" }));
  return [...history, ...planned];
}
