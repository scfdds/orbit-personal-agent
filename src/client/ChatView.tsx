import { GoalIcon } from "./GoalIcon.tsx";
import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  GitBranch,
  ArrowUp,
  Square,
  Plus,
  ChevronRight,
  Check,
  LoaderCircle,
  AlertCircle,
  FileText,
  ArrowDown,
  Clock3,
  ExternalLink,
  X,
} from "lucide-react";
import type {
  Activity,
  Run,
  Snapshot,
  Conversation,
  Work,
} from "../shared/types.ts";
import { IconButton, Status } from "./ui.tsx";
import { AppMark, AgentAvatar } from "./VisualIdentity.tsx";
import { WelcomeResources } from "./StartView.tsx";
import "./showcase.css";

export function RichText({ children }: { children: string }) {
  return (
    <div className="rich-text">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}

export function RunProgress({
  run,
  runs,
  activities,
  onOpenSubagent,
}: {
  run: Run;
  runs: Run[];
  activities: Activity[];
  onOpenSubagent: (id?: string) => void;
}) {
  const children = runs.filter((r) => r.parentId === run.id);
  const events = activities.filter(
    (a) => a.runId === run.id && a.kind === "tool",
  );
  const active = run.status === "running" || run.status === "queued";
  return (
    <details className="run-progress" open={active || undefined}>
      <summary>
        {active ? (
          <LoaderCircle size={14} className="spin" />
        ) : run.status === "failed" ? (
          <AlertCircle size={14} />
        ) : (
          <Check size={14} />
        )}
        <span>
          {active
            ? "正在处理"
            : run.status === "failed"
              ? "执行遇到问题"
              : run.status === "cancelled"
                ? "本次执行已停止"
                : "已完成本次执行"}
        </span>
        {children.length > 0 && (
          <button
            type="button"
            className="child-inline-link"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onOpenSubagent();
            }}
          >
            {children.length} 次子 Agent 委派
            <ExternalLink size={11} />
          </button>
        )}
        <ChevronRight size={13} className="details-chevron" />
      </summary>
      <div className="progress-details">
        {children.map((child) => (
          <button
            type="button"
            className="subtask-step"
            key={child.id}
            onClick={() => onOpenSubagent(child.subagentId)}
          >
            <AgentAvatar identity={child.subagentId || child.id} size={26} />
            <span>{child.title}</span>
            <small>
              {child.status === "running"
                ? "进行中"
                : child.status === "completed"
                  ? "已完成"
                  : child.status === "failed"
                    ? "失败"
                    : "已停止"}
            </small>
            <ChevronRight size={12} />
          </button>
        ))}
        {events.slice(-6).map((event) => (
          <div key={event.id} className="tool-step">
            <span className={`step-dot ${event.status ?? ""}`} />
            <span>{event.title}</span>
          </div>
        ))}
        {!events.length && !children.length && (
          <div className="tool-step">正在理解目标，准备下一步…</div>
        )}
        {run.error && <p className="inline-error">{run.error}</p>}
      </div>
    </details>
  );
}

const conversationDrafts: Record<string, string> = {};

interface Props {
  workspaceVisible?: boolean;
  visible?: boolean;
  onRead?: () => void;
  focusMessageId?: string;
  onFork: (messageId: string) => void;
  onOpenConversation: (id: string) => void;
  work: Conversation;
  state: Snapshot;
  stream?: { runId: string; text: string };
  sending: boolean;
  onSend: (text: string) => Promise<void>;
  onStop: () => void;
  onOpenArtifact: (id: string) => void;
  onOpenApps: () => void;
  onOpenApp: (appId: string) => void;
  onOpenSubagent: (id?: string) => void;
  onOpenWork: (work: Work) => void;
  targetWork?: Work;
  onClearTarget: () => void;
}
export default function ChatView({
  visible = true, onRead, workspaceVisible = false,
  focusMessageId,
  onFork,
  onOpenConversation,
  work,
  state,
  stream,
  sending,
  onSend,
  onStop,
  onOpenArtifact,
  onOpenApps,
  onOpenApp,
  onOpenSubagent,
  onOpenWork,
  targetWork,
  onClearTarget,
}: Props) {
  let branchSummary = "";
  try {
    branchSummary = JSON.parse(work.inheritedContext || "{}").summary || "";
  } catch {}
  const [input, setInput] = useState("");
  const [nearBottom, setNearBottom] = useState(true);
  const [drafts] = useState<Record<string, string>>(() => conversationDrafts);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeConversationId = useRef(work.id);
  activeConversationId.current = work.id;
  const messages = state.messages.filter(
    (m) => m.conversationId === work.id && m.content.trim(),
  );
  const runs = state.runs.filter((r) => r.conversationId === work.id);
  const activeRun = runs.find(
    (r) => !r.parentId && (r.status === "running" || r.status === "queued"),
  );
  const artifacts = state.artifacts.filter((a) => a.conversationId === work.id);
  const openedApp = work.panel?.kind === "app" && work.panel.appId !== "memory"
    ? state.apps.find(app => work.panel?.kind === "app" && app.id === work.panel.appId) : undefined;
  useEffect(() => {
    setInput(drafts[work.id] || "");
    setNearBottom(true);
  }, [work.id, drafts]);
  useEffect(() => {
    if (nearBottom && !focusMessageId)
      listRef.current?.scrollTo({
        top: listRef.current.scrollHeight,
        behavior: "instant",
      });
  }, [
    messages.length,
    messages.at(-1)?.content,
    stream?.text,
    activeRun?.id,
    nearBottom,
  ]);
  useEffect(() => {
    if (!focusMessageId) return;
    const timer = setTimeout(() => {
      document
        .getElementById(`message-${focusMessageId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      setNearBottom(false);
    }, 100);
    return () => clearTimeout(timer);
  }, [focusMessageId, work.id]);
  useEffect(() => {
    const read = () => { if(visible && nearBottom && !focusMessageId && !document.hidden) onRead?.(); };
    read(); document.addEventListener('visibilitychange',read);
    return () => document.removeEventListener('visibilitychange',read);
  }, [visible,nearBottom,focusMessageId,work.id,work.unread,messages.length]);
  const submit = async (value = input) => {
    if (!value.trim() || sending) return;
    setInput("");
    drafts[work.id] = "";
    setNearBottom(true);
    try {
      await onSend(value.trim());
    } catch {
      drafts[work.id] = value;
      if (activeConversationId.current === work.id) setInput(value);
    }
  };
  const displayedRuns = new Set<string>();
  return (
    <div className="chat-view">
      <div
        ref={listRef}
        className="conversation-scroll"
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 130;
          setNearBottom(atBottom);
          if (atBottom && visible && !document.hidden && work.unread) onRead?.();
        }}
      >
        {!messages.length ? (
          openedApp ? <div className="app-chat-empty">
            <AppMark id={openedApp.id} size={48}/>
            <p>{openedApp.id === "contracts"
              ? state.objects.some(o => o.conversationId === work.id && o.appId === "contracts" && Array.isArray(o.data.clauses) && o.data.clauses.length > 0)
                ? "合同已准备好，可以告诉我你的审阅要求。"
                : workspaceVisible ? "在右侧导入合同，也可以先告诉我你的审阅要求。" : "可以先告诉我你的审阅要求，需要时再打开合同应用。"
              : workspaceVisible ? "可以直接使用右侧应用，也可以在这里告诉我你的需求。" : "继续在这里讨论，需要时再打开应用。"}</p>
          </div> : <div className="welcome">
            <h1>{work.parentId ? "在这里，继续展开" : "有什么想一起做的？"}</h1>
            <p>{work.parentId ? "来源对话的背景已带入，可以直接接着聊。" : "聊一个想法，或交代一件需要持续推进的事。"}</p>
            {work.parentId ? <p className="branch-welcome-summary">{branchSummary}</p> : <WelcomeResources apps={state.apps} disabled={sending} onApps={onOpenApps} onOpenApp={onOpenApp}/>}
          </div>
        ) : (
          <div className="conversation-track">
            {messages.map((message) => {
              if (message.kind === "conversation_link" && message.linkedConversationId) {
                const target = state.conversations.find(c => c.id === message.linkedConversationId);
                return target ? <button key={message.id} className="conversation-handoff" onClick={() => onOpenConversation(target.id)}>
                  <GitBranch size={16}/><span><small>已展开讨论</small><strong>{target.title}</strong></span><ChevronRight size={14}/>
                </button> : null;
              }
              if (message.kind === "work_created" && message.workId) {
                const linked = state.works.find((w) => w.id === message.workId);
                if (linked)
                  return (
                    <button
                      className="linked-work-card"
                      key={message.id}
                      onClick={() => onOpenWork(linked)}
                    >
                      <GoalIcon size={18} />
                      <span>
                        <small>已创建长期目标</small>
                        <strong>{linked.title}</strong>
                      </span>
                      <Status status={linked.status} compact />
                      <ChevronRight size={15} />
                    </button>
                  );
              }
              const run = message.runId
                ? runs.find((r) => r.id === message.runId)
                : undefined;
              const showRun =
                message.role === "assistant" &&
                run &&
                !displayedRuns.has(run.id);
              if (showRun) displayedRuns.add(run.id);
              return (
                <article
                  id={`message-${message.id}`}
                  className={`message message-${message.role} ${focusMessageId === message.id ? "source-highlight" : ""}`}
                  key={message.id}
                >
                  {message.route && <div className="message-route" title={message.route.reason}>
                    <GitBranch size={12}/>
                    <span>{message.route.fallback ? "自动选择暂不可用，已新建对话" : message.route.action === "resume" ? "已接续这段讨论" : message.route.action === "fork" ? "已带入背景，展开新的讨论" : `新对话 · ${message.route.project}`}</span>
                  </div>}
                  {showRun && (
                    <RunProgress
                      run={run!}
                      runs={runs}
                      activities={state.activities}
                      onOpenSubagent={onOpenSubagent}
                    />
                  )}
                  {message.runId &&
                    runs.find((r) => r.id === message.runId)?.workId && (
                      <button
                        className="message-work-link"
                        onClick={() => {
                          const linked = state.works.find(
                            (w) =>
                              w.id ===
                              runs.find((r) => r.id === message.runId)?.workId,
                          );
                          if (linked) onOpenWork(linked);
                        }}
                      >
                        <GoalIcon size={12} />
                        {
                          state.works.find(
                            (w) =>
                              w.id ===
                              runs.find((r) => r.id === message.runId)?.workId,
                          )?.title
                        }
                      </button>
                    )}
                  <div className="message-branch-action">
                    <IconButton
                      label="从这条消息展开分支"
                      onClick={() => onFork(message.id)}
                    >
                      <GitBranch size={13} />
                    </IconButton>
                  </div>
                  <div className="message-content">
                    {message.role === "user" ? (
                      message.content
                    ) : (
                      <RichText>{message.content}</RichText>
                    )}
                  </div>
                </article>
              );
            })}
            {activeRun && !displayedRuns.has(activeRun.id) && (
              <article className="message message-assistant">
                <RunProgress
                  run={activeRun}
                  runs={runs}
                  activities={state.activities}
                  onOpenSubagent={onOpenSubagent}
                />
                {stream?.text ? (
                  <RichText>{stream.text}</RichText>
                ) : (
                  <span className="thinking-indicator">
                    正在思考<span>···</span>
                  </span>
                )}
              </article>
            )}
            {stream?.text &&
              !messages.some(
                (m) => m.role === "assistant" && m.runId === stream.runId,
              ) &&
              (!activeRun || displayedRuns.has(activeRun.id)) && (
                <article className="message message-assistant streaming-message">
                  <RichText>{stream.text}</RichText>
                </article>
              )}
            {artifacts.length > 0 && !activeRun && (
              <div className="artifact-links">
                {artifacts.map((artifact) => (
                  <button
                    key={artifact.id}
                    onClick={() => onOpenArtifact(artifact.id)}
                  >
                    <span className="file-icon">
                      <FileText size={19} />
                    </span>
                    <span>
                      <strong>{artifact.title}</strong>
                      <small>文档 · 已保存在此对话</small>
                    </span>
                    <ExternalLink size={14} />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {!nearBottom && (
        <IconButton
          label="回到最新消息"
          className="scroll-bottom"
          onClick={() => {
            setNearBottom(true);
            listRef.current?.scrollTo({
              top: listRef.current.scrollHeight,
              behavior: "smooth",
            });
          }}
        >
          <ArrowDown size={17} />
        </IconButton>
      )}
      <div className="composer-area">
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {targetWork && (
            <div className="composer-work-context">
              <GoalIcon size={14} />
              <span>关于目标：{targetWork.title}</span>
              <IconButton
                label="取消目标引用，返回普通对话"
                onClick={onClearTarget}
              >
                <X size={13} />
              </IconButton>
            </div>
          )}
          <textarea
            ref={textareaRef}
            aria-label="给 Orbit 的消息"
            placeholder={
              activeRun
                ? "补充要求，Orbit 会接着处理…"
                : "向 Orbit 提问，或交代一件事…"
            }
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              drafts[work.id] = e.target.value;
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
            }}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void submit();
              }
            }}
            rows={2}
          />
          <div className="composer-toolbar">
            <div>
              <IconButton label="打开应用" onClick={onOpenApps}>
                <Plus size={20} />
              </IconButton>
            </div>
            <div>
              <span className="model-name">
                DeepSeek
              </span>
              {activeRun && !input.trim() ? (
                <IconButton
                  label="暂停执行"
                  className="send-button stop-button"
                  onClick={onStop}
                >
                  <Square size={14} fill="currentColor" />
                </IconButton>
              ) : (
                <button
                  className="send-button"
                  type="submit"
                  aria-label={activeRun ? "追加要求" : "发送消息"}
                  disabled={!input.trim() || sending}
                >
                  <ArrowUp size={19} />
                </button>
              )}
            </div>
          </div>
        </form>

      </div>
    </div>
  );
}
