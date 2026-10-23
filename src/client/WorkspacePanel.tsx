import { GoalIcon } from "./GoalIcon.tsx";
import { useState, type ComponentType } from "react";
import {
  Inbox,
  MessagesSquare,
  Columns3,
  FileText,
  FileCheck2,
  Clock3,
  Globe2,
  X,
  Maximize2,
  Minimize2,
  ArrowUpRight,
  ChevronRight,
  Check,
  LoaderCircle,
  AlertCircle,
  FolderOpen,
  Plus,
  Bot,
  ArrowLeft,
  MessageSquare,
  Puzzle,
  ChartNoAxesCombined,
  Scale,
  BriefcaseBusiness,
} from "lucide-react";
import type {
  AppObject,
  PanelRef,
  Snapshot,
  Conversation,
  Work,
} from "../shared/types.ts";
import type { AppPanelProps } from "./panel-types.ts";
import { IconButton, Status, timeLabel } from "./ui.tsx";
import { RichText } from "./ChatView.tsx";
import SubagentPanel from "./SubagentPanel.tsx";
import { useWorkspaceResize } from "./useWorkspaceResize.ts";

const panelModules = import.meta.glob<{
  default: ComponentType<AppPanelProps>;
}>("../apps/*/Panel.tsx", { eager: true });
export const appIcons: Record<string, typeof Inbox> = {
  contracts: FileCheck2,
  memory: MessagesSquare,
  feedback: Inbox,
  opportunities: Columns3,
  portfolio: ChartNoAxesCombined,
  litigation: Scale,
  career: BriefcaseBusiness,
};

interface Props {
  memoryScope?: string;
  onMemoryScope?: (scope: string) => void;
  onNavigate?: (id: string, messageId?: string) => void;
  onFork?: (id: string, messageId: string) => void;
  state: Snapshot;
  work: Conversation;
  panel: PanelRef | null;
  expanded: boolean;
  sidebarCollapsed: boolean;
  onResize: () => void;
  onExpand: () => void;
  onClose: () => void;
  onPanel: (panel: PanelRef) => void;
  onUpdate: AppPanelProps["onUpdate"];
  onSend: (text: string) => void;
  onDemoEvent: () => Promise<void>;
  onTrack: (work?: Work) => void;
  onAction: (workId: string, action: "pause" | "resume" | "end") => void;
  onOpenWork: (work: Work) => void;
  onConversation: (id: string) => void;
  onDiscuss: (work: Work) => void;
  onRunWork: (id: string) => void;
  onDelegate: (text: string) => Promise<void>;
  onContinueSubagent: (id: string, instructions: string) => Promise<void>;
  onStopSubagent: (id: string) => Promise<void>;
  onToggleTrigger: (id: string, enabled: boolean) => void;
}
export default function WorkspacePanel(props: Props) {
  const { state, work, panel, onPanel } = props;
  const { panelRef, panelStyle, separatorProps } = useWorkspaceResize(
    props.expanded,
    props.sidebarCollapsed,
    props.onResize,
  );
  const app =
    panel?.kind === "app"
      ? state.apps.find((a) => a.id === panel.appId)
      : undefined;
  const object = app
    ? (state.objects.find(
        (o) =>
          o.conversationId === work.id &&
          o.appId === app.id &&
          (!panel ||
            panel.kind !== "app" ||
            !panel.objectId ||
            o.id === panel.objectId),
      ) ?? null)
    : null;
  const artifact =
    panel?.kind === "artifact"
      ? state.artifacts.find(
          (a) => a.id === panel.artifactId && a.conversationId === work.id,
        )
      : undefined;
  const Panel = app
    ? panelModules[`../apps/${app.panel.entry}`]?.default
    : undefined;
  const title =
    app?.name ||
    (panel?.kind === "subagents"
      ? "子 Agent"
      : panel?.kind === "artifact"
        ? "文件"
        : panel?.kind === "work"
          ? "目标详情"
          : panel?.kind === "activity"
            ? "关联目标"
            : panel?.kind === "browser"
              ? "浏览器"
              : "工作区");
  return (
    <aside
      ref={panelRef}
      id="orbit-workspace"
      style={panelStyle}
      className={`workspace-panel ${props.expanded ? "expanded" : ""}`}
    >
      <div {...separatorProps} />
      <nav className="workspace-rail" aria-label="工作区视图">
        <IconButton
          aria-pressed={panel?.kind === "subagents"}
          label="子 Agent"
          className={panel?.kind === "subagents" ? "active" : ""}
          onClick={() => onPanel({ kind: "subagents" })}
        >
          <Bot size={20} />
        </IconButton>
        <IconButton
          aria-pressed={panel?.kind === "artifact"}
          label="文件"
          className={panel?.kind === "artifact" ? "active" : ""}
          onClick={() => onPanel({ kind: "artifact", artifactId: "" })}
        >
          <FolderOpen size={20} />
        </IconButton>
        <IconButton
          aria-pressed={panel?.kind === "browser"}
          label="浏览器"
          className={panel?.kind === "browser" ? "active" : ""}
          onClick={() => onPanel({ kind: "browser" })}
        >
          <Globe2 size={20} />
        </IconButton>
        <IconButton
          aria-pressed={panel?.kind === "activity" || panel?.kind === "work"}
          label="长期目标"
          className={
            panel?.kind === "activity" || panel?.kind === "work" ? "active" : ""
          }
          onClick={() => onPanel({ kind: "activity" })}
        >
          <GoalIcon size={20} />
        </IconButton>
        {state.apps.some(a => a.id === "memory") && <IconButton
          aria-pressed={panel?.kind === "app" && panel.appId === "memory"}
          label={state.apps.find(a => a.id === "memory")!.name}
          className={panel?.kind === "app" && panel.appId === "memory" ? "active" : ""}
          onClick={() => onPanel({ kind: "app", appId: "memory" })}
        >
          <MessagesSquare size={20} />
        </IconButton>}
        {state.apps.some(a => a.id !== "memory") && <span className="rail-divider" />}
        {state.apps.filter(a => a.id !== "memory").map((a) => {
          const Icon = appIcons[a.id] ?? Puzzle;
          return (
            <IconButton
              key={a.id}
              aria-pressed={panel?.kind === "app" && panel.appId === a.id}
              label={a.name}
              className={
                panel?.kind === "app" && panel.appId === a.id ? "active" : ""
              }
              onClick={() => onPanel({ kind: "app", appId: a.id })}
            >
              <Icon size={20} />
            </IconButton>
          );
        })}
      </nav>
      <div className="workspace-body">
        <div className="workspace-header">
          <span className="workspace-title">
            <strong>{title}</strong>
          </span>
          <div>
            <IconButton
              label={props.expanded ? "恢复工作区宽度" : "展开工作区"}
              onClick={props.onExpand}
            >
              {props.expanded ? (
                <Minimize2 size={16} />
              ) : (
                <Maximize2 size={16} />
              )}
            </IconButton>
            <IconButton label="关闭工作区" onClick={props.onClose}>
              <X size={17} />
            </IconButton>
          </div>
        </div>
        <div
          className="workspace-content"
          key={`${app?.id === "memory" ? "global" : work.id}:${panel?.kind}:${app?.id ?? artifact?.id ?? (panel?.kind === "work" ? panel.workId : panel?.kind === "subagents" ? panel.agentId || "list" : "")}`}
        >
          {panel?.kind === "subagents" ? (
            <SubagentPanel
              state={state}
              conversationId={work.id}
              agentId={panel.agentId}
              onSelect={(agentId) =>
                onPanel({ kind: "subagents", ...(agentId ? { agentId } : {}) })
              }
              onContinue={props.onContinueSubagent}
              onStop={props.onStopSubagent}
              onCreate={(instructions) => props.onDelegate(
                `请安排子 Agent 分工完成以下任务：\n${instructions}`,
              )}
            />
          ) : Panel ? (
            <Panel
              snapshot={state}
              memoryScope={props.memoryScope}
              onMemoryScope={props.onMemoryScope}
              onNavigate={props.onNavigate}
              onFork={props.onFork}
              work={work}
              object={object}
              objects={state.objects}
              onUpdate={props.onUpdate}
              onSend={props.onSend}
              onOpenApp={(appId, objectId) =>
                onPanel({ kind: "app", appId, objectId })
              }
              onDemoEvent={props.onDemoEvent}
            />
          ) : panel?.kind === "work" ? (
            <WorkDetail
              {...props}
              selectedWork={state.works.find(
                (w) => w.id === panel.workId && w.conversationId === work.id,
              )}
            />
          ) : panel?.kind === "activity" ? (
            <ActivityPanel {...props} />
          ) : panel?.kind === "artifact" ? (
            artifact ? (
              <div className="document-view">
                <button
                  className="text-button work-back"
                  onClick={() => onPanel({ kind: "artifact", artifactId: "" })}
                >
                  <ArrowLeft size={13} />
                  全部文件
                </button>
                <div className="app-eyebrow">
                  <FileText size={14} />
                  <span>任务产物</span>
                  <span className="muted">
                    更新于 {timeLabel(artifact.updatedAt)}
                  </span>
                </div>
                <h2>{artifact.title}</h2>
                <RichText>
                  {artifact.content.startsWith(`# ${artifact.title}\n`)
                    ? artifact.content
                        .slice(artifact.title.length + 3)
                        .trimStart()
                    : artifact.content}
                </RichText>
                <button
                  className="button secondary small"
                  onClick={() => {
                    const blob = new Blob([artifact.content], {
                      type: "text/markdown;charset=utf-8",
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${artifact.title.replace(/[\/\\]/g, "-")}.md`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }}
                >
                  下载 Markdown
                </button>
              </div>
            ) : state.artifacts.some((a) => a.conversationId === work.id) ? (
              <div className="app-surface">
                <div className="app-heading">
                  <div className="app-eyebrow">当前对话</div>
                  <h2>文件</h2>
                  <p>在这里查看与下载保存的文档。</p>
                </div>
                <div className="child-list">
                  {state.artifacts
                    .filter((a) => a.conversationId === work.id)
                    .map((a) => (
                      <button
                        className="child-row"
                        key={a.id}
                        onClick={() =>
                          onPanel({ kind: "artifact", artifactId: a.id })
                        }
                      >
                        <FileText size={18} />
                        <span>
                          <strong>{a.title}</strong>
                          <small>Markdown · {timeLabel(a.updatedAt)}</small>
                        </span>
                        <ChevronRight size={14} />
                      </button>
                    ))}
                </div>
              </div>
            ) : (
              <div className="panel-empty">
                <FileText size={32} />
                <h3>成果会保存在这里</h3>
                <p>让 Orbit 把当前结论整理成一份文档。</p>
                <button
                  className="button secondary"
                  onClick={() =>
                    props.onSend(
                      "根据当前对话与已打开应用的最新资料，整理一份简明总结，并用 save_report 保存。",
                    )
                  }
                >
                  整理当前结论
                </button>
              </div>
            )
          ) : panel?.kind === "browser" ? (
            <BrowserPanel initialUrl={panel.url} />
          ) : (
            <div className="panel-empty">
              <FolderOpen size={32} />
              <h3>打开一份资料或应用</h3>
              <p>你和 Orbit 共用这个工作区。</p>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function ActivityPanel({
  work: conversation,
  state,
  onTrack,
  onOpenWork,
}: Props) {
  const works = state.works.filter((w) => w.conversationId === conversation.id);
  return (
    <div className="app-surface activity-panel">
      <div className="app-heading">
        <div className="app-eyebrow">
          <GoalIcon size={15} />
          关联目标
        </div>
        <h2>从这段对话继续</h2>
        <p className="muted">长期目标持续推进，相关讨论保留在对话中。</p>
      </div>
      <div className="related-work-list">
        {works.map((work) => (
          <button
            className="related-work-item"
            key={work.id}
            onClick={() => onOpenWork(work)}
          >
            <div>
              <strong>{work.title}</strong>
              <p>{work.goal}</p>
              <Status status={work.status} />
            </div>
            <ChevronRight size={15} />
          </button>
        ))}
      </div>
      {!works.length && (
        <p className="muted">
          这段对话还没有关联目标。需要持续推进时，再交给 Orbit。
        </p>
      )}
      <button className="button secondary small" onClick={() => onTrack()}>
        <Plus size={14} />
        创建长期目标
      </button>
    </div>
  );
}
function WorkDetail(props: Props & { selectedWork?: Work }) {
  const { selectedWork: work, state, onTrack, onAction, onPanel } = props;
  if (!work)
    return (
      <div className="panel-empty">
        <p>未找到这个目标</p>
      </div>
    );
  const conversation = state.conversations.find(
    (c) => c.id === work.conversationId,
  );
  const runs = state.runs
    .filter((r) => r.workId === work.id && !r.parentId)
    .slice()
    .reverse();
  const triggers = state.triggers.filter((t) => t.workId === work.id);
  const artifacts = state.artifacts.filter((a) => a.workId === work.id);
  const inactive = ["paused", "completed"].includes(work.status);
  const queued = runs.some((r) => ["queued", "running"].includes(r.status));
  return (
    <div className="app-surface activity-panel">
      <button
        className="text-button work-back"
        onClick={() => onPanel({ kind: "activity" })}
      >
        <ArrowLeft size={13} />
        此对话的全部目标
      </button>
      <div className="app-heading">
        <div className="app-eyebrow">
          <GoalIcon size={15} />
          长期目标
        </div>
        <h2>{work.title}</h2>
        <Status status={work.status} />
      </div>
      <button
        className="work-source"
        onClick={() => props.onConversation(work.conversationId)}
      >
        <MessageSquare size={14} />
        <span>来源对话 · {conversation?.title}</span>
        <ChevronRight size={13} />
      </button>
      <section className="detail-section">
        <h3>目标说明</h3>
        <p>{work.goal}</p>
      </section>
      {work.completionCriteria && <section className="detail-section"><h3>完成要求</h3><p>{work.completionCriteria}</p></section>}
      <section className="detail-section">
        <h3>最新进展</h3>
        <p>
          {queued && work.status !== "running"
            ? "已加入执行队列，等待当前对话中的执行结束"
            : work.summary}
        </p>
      </section>
      <div className="detail-actions">
        {inactive ? (
          <button
            className="button secondary small"
            onClick={() => onAction(work.id, "resume")}
          >
            恢复目标
          </button>
        ) : (
          <>
            <button
              className="button secondary small"
              disabled={queued}
              onClick={() => props.onRunWork(work.id)}
            >
              {queued ? "执行中" : "继续推进"}
            </button>
            <button
              className="quiet-button"
              onClick={() => props.onDiscuss(work)}
            >
              补充要求
            </button>
          </>
        )}
      </div>
      <section className="detail-section">
        <div className="section-heading">
          <h3>后续安排</h3>
          <button
            className="text-button"
            disabled={work.status === "completed"}
            onClick={() => onTrack(work)}
          >
            <Plus size={13} />
            添加
          </button>
        </div>
        {triggers.map((t) => (
          <div className="trigger-detail" key={t.id}>
            <Clock3 size={14} />
            <div>
              <strong>
                {t.kind === "event"
                  ? "收到新反馈时继续"
                  : `每 ${t.intervalMinutes} 分钟检查`}
              </strong>
              <p>{t.instructions}</p>
              <small>
                {!t.enabled
                  ? "已停用"
                  : work.status === "paused"
                    ? "随目标暂停"
                    : t.nextRunAt
                      ? `下次 ${timeLabel(t.nextRunAt)}`
                      : "已启用"}
              </small>
            </div>
            <button
              className={`switch ${t.enabled ? "on" : ""}`}
              role="switch"
              aria-checked={t.enabled}
              aria-label={`${t.enabled ? "停用" : "启用"}安排：${t.instructions}`}
              disabled={work.status === "completed"}
              onClick={() => props.onToggleTrigger(t.id, !t.enabled)}
            >
              <span />
            </button>
          </div>
        ))}
        {!triggers.length && (
          <p className="muted">还没有后续安排，可按需继续推进。</p>
        )}
      </section>
      {artifacts.length > 0 && (
        <section className="detail-section">
          <h3>相关产物</h3>
          {artifacts.map((a) => (
            <button
              className="work-artifact"
              key={a.id}
              onClick={() => onPanel({ kind: "artifact", artifactId: a.id })}
            >
              <FileText size={15} />
              {a.title}
              <ChevronRight size={13} />
            </button>
          ))}
        </section>
      )}
      <section className="detail-section">
        <h3>共享资料与应用</h3>
        <p className="muted">与来源对话共用资料，工具每次读取最新内容。</p>
        <div className="detail-actions">
          {state.apps.map((a) => (
            <button
              key={a.id}
              className="button secondary small"
              onClick={() => onPanel({ kind: "app", appId: a.id })}
            >
              {a.name}
            </button>
          ))}
        </div>
      </section>
      <section className="detail-section">
        <h3>
          执行记录 <span className="muted">{runs.length}</span>
        </h3>
        {runs.map((run) => (
          <details className="execution-record" key={run.id}>
            <summary>
              {run.status === "running" || run.status === "queued" ? (
                <LoaderCircle size={14} className="spin" />
              ) : run.status === "failed" ? (
                <AlertCircle size={14} />
              ) : (
                <Check size={14} />
              )}
              <span>{run.title}</span>
              <small>{timeLabel(run.startedAt)}</small>
              <ChevronRight size={12} />
            </summary>
            <p>
              {run.summary ||
                run.error ||
                (run.status === "queued" ? "等待执行" : "本次执行尚未结束。")}
            </p>
            {state.runs
              .filter((r) => r.parentId === run.id)
              .map((child) => (
                <div className="child-run" key={child.id}>
                  <span>{child.title}</span>
                  <small>
                    {child.status === "completed"
                      ? "已完成"
                      : child.status === "running"
                        ? "进行中"
                        : "已停止"}
                  </small>
                </div>
              ))}
          </details>
        ))}
        {!runs.length && <p className="muted">这个目标还没有执行记录。</p>}
      </section>
      {work.status !== "completed" && (
        <div className="detail-actions work-lifecycle">
          {work.status !== "paused" && (
            <button
              className="quiet-button"
              onClick={() => onAction(work.id, "pause")}
            >
              暂停目标
            </button>
          )}
          <button
            className="quiet-button"
            onClick={() => onAction(work.id, "end")}
          >
            结束目标
          </button>
        </div>
      )}
    </div>
  );
}
function BrowserPanel({ initialUrl }: { initialUrl?: string }) {
  const [url, setUrl] = useState(initialUrl || "");
  const [error, setError] = useState("");
  const open = () => {
    try {
      const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
      window.open(parsed.href, "_blank", "noopener,noreferrer");
      setError("");
    } catch {
      setError("请输入有效的网页地址");
    }
  };
  return (
    <div className="browser-view">
      <div className="browser-address">
        <Globe2 size={15} />
        <input
          aria-label="网页地址"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="输入网址"
          onKeyDown={(e) => {
            if (e.key === "Enter") open();
          }}
        />
        <IconButton label="在浏览器中打开" onClick={open}>
          <ArrowUpRight size={16} />
        </IconButton>
      </div>
      {error && <p className="inline-error">{error}</p>}
      <div className="panel-empty">
        <Globe2 size={35} />
        <h3>把网页作为工作资料</h3>
        <p>当前版本在外部浏览器中打开链接。</p>
        <span className="sample-tag">内嵌浏览器与网页操控待接入</span>
      </div>
    </div>
  );
}
