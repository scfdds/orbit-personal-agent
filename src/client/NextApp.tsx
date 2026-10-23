import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, ArrowUpRight, ArrowDown, Check, ChevronRight, History, LoaderCircle, MessageSquare, PanelRight, Search, Square, X, CornerDownLeft } from "lucide-react";
import type { AssistantState, AssistantWorkspace, AssistantMessageContext, AssistantWorkspaceAction } from "../shared/assistant.ts";
import { request, useOrbit } from "./api.ts";
import { RichText } from "./ChatView.tsx";
import { IconButton, Modal, OrbitMark } from "./ui.tsx";
import NextWorkspace from "./NextWorkspace.tsx";
import "./next.css";

export default function NextApp() {
  const { state, online, error: connectionError, streams, refresh } = useOrbit();
  const [assistant, setAssistant] = useState<AssistantState | null>(null);
  const [input, setInput] = useState(() => localStorage.getItem("orbit-next.draft") || "");
  const [historyOpen, setHistoryOpen] = useState(false);
  const closeHistory = useCallback(() => setHistoryOpen(false), []);
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [reference, setReference] = useState<AssistantMessageContext | null>(null);
  const [ignoredTab, setIgnoredTab] = useState<string | null>(null);
  const [paneHidden, setPaneHidden] = useState(false);
  const [mobilePane, setMobilePane] = useState(false);
  const [scrolledUp, setScrolledUp] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const historySearch = useRef<HTMLInputElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const lastActive = useRef<string | null>(null);
  const latestRevision = useRef(-1);
  const submitGuard = useRef(false);
  const acceptWorkspace = useCallback((workspace: AssistantWorkspace) => {
    if (workspace.revision < latestRevision.current) return;
    latestRevision.current = workspace.revision;
    setAssistant(previous => previous ? { ...previous, workspace } : previous);
  }, []);
  useEffect(() => {
    let cancelled = false;
    request<AssistantState>("/assistant").then(value => {
      if (cancelled || value.workspace.revision < latestRevision.current) return;
      latestRevision.current = value.workspace.revision;
      setAssistant(value);
    }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [state]);
  useEffect(() => { localStorage.setItem("orbit-next.draft", input); }, [input]);
  useEffect(() => {
    if (!historyOpen) return;
    const frame = requestAnimationFrame(() => historySearch.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [historyOpen]);
  const tabs = assistant?.workspace.tabs || [];
  const activeTab = tabs.find(tab => tab.id === assistant?.workspace.activeTabId);
  const mainId = assistant?.conversationId;
  const messages = state?.messages.filter(message => message.conversationId === mainId && (message.role !== "system" || message.kind === "conversation_link")) || [];
  const runs = state?.runs.filter(run => run.conversationId === mainId && !run.parentId) || [];
  const activeRun = runs.find(run => run.status === "running" || run.status === "queued");
  const stream = mainId ? streams[mainId] : undefined;
  const activities = state?.activities.filter(activity => activity.runId === activeRun?.id && activity.kind === "tool") || [];
  const context = reference || (activeTab && ignoredTab !== activeTab.id ? { conversationId: activeTab.conversationId, ...(activeTab.artifactId ? {artifactId:activeTab.artifactId} : {}), ...(activeTab.appId ? {appId:activeTab.appId} : {}), ...(activeTab.objectId ? {objectId:activeTab.objectId} : {}) } : undefined);
  const contextConversation = state?.conversations.find(conversation => conversation.id === context?.conversationId);
  const contextTitle = (context?.artifactId ? state?.artifacts.find(item => item.id === context.artifactId)?.title : undefined)
    || (context?.objectId ? state?.objects.find(item => item.id === context.objectId)?.title : undefined)
    || (context?.appId ? state?.apps.find(item => item.id === context.appId)?.name : undefined)
    || contextConversation?.title;
  const hasWorkspace = Boolean(activeTab && !paneHidden);
  const allConversations = state?.conversations.filter(conversation => conversation.id !== mainId && !conversation.archived && !conversation.draft) || [];
  const histories = allConversations.filter(conversation => `${conversation.title} ${conversation.project} ${conversation.summary}`.toLowerCase().includes(search.toLowerCase()));
  const recent = [...allConversations].sort((a,b) => (a.id === "orbit-next-vr" ? -1 : b.id === "orbit-next-vr" ? 1 : b.updatedAt.localeCompare(a.updatedAt))).slice(0,3);

  useEffect(() => {
    if (!activeTab) { lastActive.current = null; return; }
    if (activeTab.id !== lastActive.current) {
      setPaneHidden(false); setIgnoredTab(null); setReference(null);
      lastActive.current = activeTab.id;
    }
  }, [activeTab?.id]);
  useEffect(() => {
    if (!scrolledUp) scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: "instant" });
  }, [messages.length, stream?.text, activeRun?.id, scrolledUp]);
  useEffect(() => {
    const element = composer.current;
    if (element) { element.style.height = "auto"; element.style.height = `${Math.min(element.scrollHeight, 180)}px`; }
  }, [input]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); setHistoryOpen(value => !value);
      }
      if (event.key === "Escape") setMobilePane(false);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  async function workspace(action: AssistantWorkspaceAction) {
    try {
      setError("");
      const result = await request<AssistantWorkspace>("/assistant/workspace", "POST", action);
      acceptWorkspace(result);
      if (action.action === "open" || action.action === "activate") {
        setPaneHidden(false); setIgnoredTab(null); setReference(null);
      }
    } catch (e) { setError((e as Error).message); }
  }
  async function openConversation(conversationId: string) {
    await workspace({ action: "open", conversationId });
    setHistoryOpen(false); setMobilePane(true);
  }
  function refer(value: AssistantMessageContext, draft?: string) {
    setReference(value); setMobilePane(false);
    if (draft) setInput(previous => previous ? `${previous}\n${draft}` : draft);
    requestAnimationFrame(() => composer.current?.focus());
  }
  async function send(value = input) {
    const content = value.trim();
    if (!content || !mainId || submitGuard.current || activeRun) return;
    submitGuard.current = true; setSending(true); setError(""); setScrolledUp(false);
    try {
      await request("/assistant/messages", "POST", { requestId: crypto.randomUUID(), content, ...(context ? { context } : {}) });
      setInput(previous => previous === value ? "" : previous); setReference(null);
      await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { submitGuard.current = false; setSending(false); composer.current?.focus(); }
  }
  async function stop() {
    if (!mainId) return;
    try { await request(`/conversations/${mainId}/stop`, "POST", {}); await refresh(); }
    catch (e) { setError((e as Error).message); }
  }

  return <div className={`next-app ${hasWorkspace ? "with-workspace" : ""} ${mobilePane ? "show-mobile-workspace" : ""}`}>
    <header className="next-topbar">
      <div className="next-brand-group">
        <IconButton label="查找历史对话" onClick={() => { setSearch(""); setHistoryOpen(true); }}><History size={19}/></IconButton>
        <span className="next-brand">Orbit<span>next</span></span>
      </div>
      <div className="next-top-actions">
        <span className="next-connection"><i className={online ? "online" : ""}/>{online ? "本地已连接" : "正在连接"}</span>
        {tabs.length > 0 && <button className="next-open-count" onClick={() => { setPaneHidden(false); setMobilePane(true); }}><PanelRight size={16}/>已打开 <span>{tabs.length}</span></button>}
      </div>
    </header>
    <div className="next-layout">
      <main className={`next-main ${messages.length ? "has-messages" : "is-welcome"}`}>
        {hasWorkspace && <div className="next-chat-label"><OrbitMark size={18}/><span>主对话</span><span className="next-chat-label-note">从这里继续每件事</span></div>}
        <div className="next-chat-scroll" ref={scroll} onScroll={() => {
          const el = scroll.current; if (el) setScrolledUp(el.scrollHeight - el.scrollTop - el.clientHeight > 100);
        }}>
          {!messages.length ? <div className="next-welcome">
            <div className="next-welcome-mark"><OrbitMark size={42}/></div>
            <h1>想聊点什么，<br/>或者继续一件事。</h1>
            <p>背景我来找，思路我们接着往下走。</p>
          </div> : <div className="next-transcript">
            <div className="next-transcript-start">你的主对话 <span>·</span> Orbit</div>
            {messages.map(message => message.kind === "conversation_link" && message.linkedConversationId ?
              <button key={message.id} className="next-conversation-receipt" onClick={() => void openConversation(message.linkedConversationId!)}><MessageSquare size={15}/><span>{state?.conversations.find(c => c.id === message.linkedConversationId)?.title || message.content}</span><ArrowUpRight size={15}/></button> :
              <article key={message.id} className={`next-message next-message-${message.role}`}>
                {message.role === "assistant" && <div className="next-speaker"><OrbitMark size={18}/><span>Orbit</span></div>}
                <RichText>{message.content}</RichText>
              </article>)}
            {stream?.text && <article className="next-message next-message-assistant"><div className="next-speaker"><OrbitMark size={18}/><span>Orbit</span></div><RichText>{stream.text}</RichText></article>}
            {(activeRun || sending) && <div className="next-thinking" role="status"><LoaderCircle size={14} className="spin"/><span>{activities.at(-1)?.title || "正在理解你的想法…"}</span></div>}
            {runs.at(-1)?.status === "failed" && !activeRun && <div className="next-run-error">这次处理未完成。{runs.at(-1)?.error || "可以重新发送，或调整请求后再试。"}</div>}
          </div>}
        </div>
        <div className="next-compose-region">
          {scrolledUp && <button className="next-back-to-bottom" onClick={() => setScrolledUp(false)}><ArrowDown size={14}/>回到最新</button>}
          {(error || connectionError) && <div className="next-error" role="alert"><span>{error || connectionError}</span><IconButton label="关闭提示" onClick={() => setError("")}><X size={14}/></IconButton></div>}
          {state && !state.configured && <div className="next-config-note">尚未配置模型。你可以先打开历史对话，查看新版交互。</div>}
          <form className="next-composer" onSubmit={event => { event.preventDefault(); void send(); }}>
            {contextConversation && <div className="next-context-row"><span><MessageSquare size={13}/><span>{reference?.quote ? "引用自" : "正在参考"} · {contextTitle}</span></span><IconButton label="不带入此内容" onClick={() => { setReference(null); setIgnoredTab(activeTab?.id || null); }}><X size={13}/></IconButton></div>}
            {reference?.quote && <blockquote className="next-composer-quote">{reference.quote}</blockquote>}
            <textarea aria-label="给 Orbit 发消息" ref={composer} value={input} rows={2} placeholder={contextConversation ? "围绕这件事继续，或者聊点新的…" : "说说你的想法…"} onChange={event => setInput(event.target.value)} onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
            }}/>
            <div className="next-composer-bottom"><button type="button" className="next-history-shortcut" onClick={() => { setSearch(""); setHistoryOpen(true); }}><Search size={15}/><span>找回一段讨论</span></button><div className="next-send-group"><span>{state?.model ? (state.model.toLowerCase().includes("deepseek") ? "DeepSeek" : state.model) : "Orbit"}</span>{activeRun ? <IconButton label="停止生成" className="next-send" onClick={() => void stop()}><Square size={14}/></IconButton> : <button type="submit" className="next-send" aria-label="发送消息" disabled={!input.trim() || sending || !assistant || !state?.configured}>{sending ? <LoaderCircle size={17} className="spin"/> : <ArrowUp size={19}/>}</button>}</div></div>
          </form>
          {!messages.length ? <>
            <div className="next-suggestions"><button disabled={!state?.configured || !assistant} onClick={() => void send("打开上次的 VR 助手方案，告诉我上次讨论到哪了。")}>继续 VR 助手方案 <ArrowUpRight size={13}/></button><button disabled={!state?.configured || !assistant} onClick={() => void send("找回之前关于 HBM 带宽和延迟的讨论，打开给我看看。")}>找回关于 HBM 的讨论 <ArrowUpRight size={13}/></button></div>
            <div className="next-recent"><div className="next-recent-heading"><span>也可以直接打开</span><button onClick={() => setHistoryOpen(true)}>全部历史 <ChevronRight size={12}/></button></div>{recent.map(conversation => <button key={conversation.id} className="next-recent-row" onClick={() => void openConversation(conversation.id)}><MessageSquare size={15}/><span>{conversation.title}</span><small>{conversation.project}</small><ArrowUpRight size={14}/></button>)}</div>
          </> : <p className="next-composer-hint"><CornerDownLeft size={11}/> 发送 <span>·</span> Shift + Enter 换行 <span>·</span> 始终在主对话交流</p>}
        </div>
      </main>
      {hasWorkspace && state && assistant && activeTab && <NextWorkspace state={state} workspace={assistant.workspace} activeTab={activeTab} onAction={workspace} onReference={refer} onHide={() => { void workspace({action:"clear"}); setMobilePane(false); setReference(null); }} onRefresh={refresh}/>}
    </div>
    {historyOpen && <Modal title="找回一段讨论" onClose={closeHistory}>
      <div className="next-history-search"><Search size={18}/><input ref={historySearch} aria-label="搜索历史对话" placeholder="搜索标题、主题或摘要" value={search} onChange={event => setSearch(event.target.value)}/><kbd>⌘ K</kbd></div>
      <div className="next-history-list">{histories.length ? histories.map(conversation => <button key={conversation.id} onClick={() => void openConversation(conversation.id)}><MessageSquare size={17}/><span><strong>{conversation.title}</strong><small>{conversation.project} {conversation.summary ? `· ${conversation.summary.slice(0,70)}` : ""}</small></span><ArrowUpRight size={16}/></button>) : <div className="next-empty-search">没有找到匹配的讨论，换个关键词试试。</div>}</div>
      <div className="next-history-tip"><Check size={13}/> 打开历史不会打断主对话</div>
    </Modal>}
  </div>;
}
