import type { AssistantOverviewItem } from "../../shared/assistant.ts";
import { plainSummary } from "./workspace-state.ts";

/** Presentation only: status comes from the stored workflow, never inferred from reply wording. */
export function getMatterPresentation(item: AssistantOverviewItem): { label: string; tone: "attention" | "active" | "neutral"; progress: string } {
  const attention = ["needs_input", "failed", "interrupted"].includes(item.status);
  const active = item.status === "running";
  const labels: Record<string, string> = {
    needs_input: "等你确认", failed: "需要处理", interrupted: "执行中断", running: "正在处理",
    waiting: "等待条件", paused: "已暂停", completed: "最近回复", idle: "最近讨论",
  };
  const progress = plainSummary(item.progress || item.lastRun?.summary || item.summary || "打开对话，继续这件事。", 130)
    .replace(/^最近回复[：:]\s*/, "")
    .replace(/^最新要求[：:]\s*/, "");
  return { label: labels[item.status] || "最近讨论", tone: attention ? "attention" : active ? "active" : "neutral", progress };
}
