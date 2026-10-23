import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, LoaderCircle, MessageSquare, PanelLeft, Plus, Search, Settings2, X } from "lucide-react";
import { useWorkspaceRequest } from "../api.ts";
import { useDesktopWorkspace } from "./useDesktopWorkspace.ts";
import { buildHomeTimeline, selectHomeTimeline } from "./home-timeline.ts";
import { dateLabel, plainSummary, referenceTitle, readSidebarCollapsed, saveSidebarCollapsed } from "./workspace-state.ts";
import Composer from "./Composer.tsx";
import Transcript from "./Transcript.tsx";
import ProjectOverview from "./ProjectOverview.tsx";
import ProjectWorkspace from "./ProjectWorkspace.tsx";
import WechatTopicNotice from "./WechatTopicNotice.tsx";
import WechatPage from "./WechatPage.tsx";
import { useWorkspaceMode } from "./WorkspaceModeRoot.tsx";
import type { Project } from "../../shared/projects.ts";
import WorkspaceSidebar from "./WorkspaceSidebar.tsx";
import MatterWorkspace from "./MatterWorkspace.tsx";
import ReferencePane from "./ReferencePane.tsx";
import DiscussionOverview from "./DiscussionOverview.tsx";
import OrbitAvatar from "./OrbitAvatar.tsx";
import SettingsDialog from "./SettingsDialog.tsx";
import Dialog from "./Dialog.tsx";
import { useVoice } from "./useVoice.ts";
import { useSpokenDelivery } from "./useSpokenDelivery.ts";
import VoiceSession from "./VoiceSession.tsx";
import "./desktop.css";
import "./voice.css";
import "./delivery.css";
import "./voice-session.css";
import "./secretary-shell.css";
import "./persistent-shell.css";
import "./conversation-handoff.css";
import "./navigation-workspace.css";
import "./matter-polish.css";
import "./projects.css";

class PaneBoundary extends Component<{ children: ReactNode; onClose(): void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <aside className="dt-pane-error"><p>内容暂时无法显示，对话和草稿已保留。</p><button className="dt-secondary" onClick={() => this.setState({ failed: false })}>重新打开</button><button onClick={this.props.onClose}>返回</button></aside> : this.props.children; }
}

export default function DesktopApp() {
  const request = useWorkspaceRequest();
  const { mode } = useWorkspaceMode();
  const quick = new URLSearchParams(window.location.search).get("surface") === "quick";
  const workspace = useDesktopWorkspace(quick);
  const { state, mainId, selectedId, view, mainDraft, mainView } = workspace;
  const timeline = useMemo(() => buildHomeTimeline({ snapshot: state || { messages: [], conversations: [], runs: [] }, mainId,
    streams: workspace.streams, preferredRunId: workspace.interactionRun?.id }), [state, mainId, workspace.streams, workspace.interactionRun?.id]);
  const { messages: mainMessages, run: mainRun, stream } = timeline;
  const [projectPageId, setProjectPageId] = useState<string | null>(null);
  const [wechatPage, setWechatPage] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectPending, setProjectPending] = useState(false), [projectError, setProjectError] = useState("");
  const projects = useMemo(() => (state?.projects || []).filter(item => !item.archived).sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order), [state?.projects]);
  const projectPage = projects.find(item => item.id === projectPageId);
  const matterActive = !quick && selectedId !== mainId && !projectPage && !wechatPage;
  const activeProjectId = wechatPage ? null : projectPage?.id || state?.conversations.find(item => item.id === selectedId)?.projectId;
  useEffect(() => { if (projectPageId && state?.projects && !projectPage) setProjectPageId(null); }, [projectPageId, state?.projects, projectPage]);
  const [overviewId, setOverviewId] = useState<string | null>(null);
  const overviewOpen = matterActive && overviewId === selectedId && !view.resource;
  useEffect(() => { setOverviewId(null); }, [selectedId]);
  useEffect(() => { if (view.resource) setOverviewId(null); }, [view.resource?.id]);
  const paneOpen = !quick && !projectPage && !wechatPage && !!view.resource && view.resource.kind !== "conversation";
  const activeMessages = matterActive ? workspace.messages : mainMessages;
  const activeRun = matterActive ? workspace.run : workspace.interactionRun || mainRun;
  const activeBusy = matterActive ? workspace.busy : workspace.mainBusy;
  const activeRouting = matterActive ? workspace.routing : workspace.mainRouting;
  const [history, setHistory] = useState(false);

  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [listError, setListError] = useState("");
  const [listPending, setListPending] = useState(false);
  const [sourceTarget, setSourceTarget] = useState<{ id: string; revision: number } | null>(null);
  const [callKeyboard, setCallKeyboard] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  function toggleSidebar() {
    setSidebarCollapsed(value => { const next = !value; saveSidebarCollapsed(next); return next; });
  }
  const [homeExpanded, setHomeExpanded] = useState(() => {
    try { return localStorage.getItem("orbit-home-overview-v2") !== "false"; } catch { return true; }
  });
  const scroller = useRef<HTMLDivElement>(null);
  const composerDock = useRef<HTMLDivElement>(null);
  const quickFrame = useRef<HTMLDivElement>(null);
  const scrollRestored = useRef(false);
  const mainWasHidden = useRef(false);
  const atBottom = useRef(true);
  const native = !!window.orbitDesktop;
  const voice = useVoice({ scope: workspace.voiceScope, messages: activeMessages, run: activeRun, quick,
    onTranscript: text => { window.dispatchEvent(new Event("orbit-delivery-interrupt")); void workspace.send(text); },
  });
  const explanation = useSpokenDelivery(workspace.delivery, voice, true);
  useEffect(() => window.orbitDesktop?.onSurfaceHidden?.(() => {
    window.dispatchEvent(new Event("orbit-voice-stop"));
    window.dispatchEvent(new Event("orbit-delivery-interrupt"));
    window.dispatchEvent(new Event("orbit-surface-hidden"));
  }), []);
  useEffect(() => { voice.interrupt(); }, [workspace.settings, voice.interrupt]);
  useEffect(() => { workspace.setVoiceActive(false); }, [voice.callActive, voice.micMuted]);
  useEffect(() => { if (!voice.callActive) setCallKeyboard(false); }, [voice.callActive]);
  function focusMain() { document.querySelector<HTMLTextAreaElement>(matterActive ? ".dt-focused-matter textarea" : ".dt-anchor-main textarea")?.focus({ preventScroll: true }); }
  function goHome() { explanation.stop(); setWechatPage(false); setProjectPageId(null); workspace.closeMatter(); }
  function openConversation(id: string, messageId?: string) { explanation.stop(); setWechatPage(false); setProjectPageId(null); workspace.navigate(id, messageId); }
  function openProject(id: string) { explanation.stop(); setWechatPage(false); setOverviewId(null); workspace.openResource(null); setProjectPageId(id); }
  function openWechat() { explanation.stop(); setOverviewId(null); setProjectPageId(null); workspace.openResource(null); setWechatPage(true); }
  function newProject() { setProjectName(""); setProjectError(""); setCreatingProject(true); }
  async function createProject() {
    if (!projectName.trim() || projectPending) return;
    setProjectPending(true); setProjectError("");
    try { const project = await request<Project>("/projects", "POST", { name: projectName.trim() }); await workspace.refresh(); setCreatingProject(false); openProject(project.id); }
    catch (cause) { setProjectError((cause as Error).message); } finally { setProjectPending(false); }
  }
  function showOverview() { explanation.stop(); workspace.openResource(null); setOverviewId(selectedId); }
  function closeResource() { explanation.stop(); workspace.openResource(null); }
  function showMainSource(conversationId: string, messageId: string) {
    if (conversationId !== mainId) return;
    explanation.stop(); workspace.closeMatter();
    atBottom.current = false;
    setSourceTarget(previous => ({ id: messageId, revision: (previous?.revision || 0) + 1 }));
  }
  useLayoutEffect(() => {
    if (!sourceTarget || matterActive || projectPage || wechatPage) return;
    let timer = 0;
    let node: HTMLElement | undefined;
    const frame = requestAnimationFrame(() => {
      const area = scroller.current;
      node = area ? [...area.querySelectorAll<HTMLElement>("[data-message-id]")].find(element => element.dataset.messageId === sourceTarget.id) : undefined;
      if (!area || !node) return;
      area.scrollTop += node.getBoundingClientRect().top - area.getBoundingClientRect().top - 30;
      workspace.changeMainView({ scrollTop: area.scrollTop });
      node.classList.add("dt-source-focus");
      timer = window.setTimeout(() => node?.classList.remove("dt-source-focus"), 3200);
    });
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); node?.classList.remove("dt-source-focus"); };
  }, [sourceTarget, matterActive, projectPageId, wechatPage]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (quick || event.isComposing || workspace.settings || history) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setQuery(""); setHistory(true); return; }
      if (!native && event.altKey && event.code === "Space") { event.preventDefault(); focusMain(); }
      if (event.key === "Escape" && voice.callActive) { event.preventDefault(); voice.endCall(); }
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [quick, native, workspace.settings, history, voice.callActive, voice.endCall]);
  // Only the currently visible discussion may acknowledge a conversation delivery.
  useEffect(() => {
    const delivery = workspace.delivery;
    if (!delivery || quick || matterActive || projectPage || wechatPage || delivery.target?.kind !== "conversation") return;
    const inMain = delivery.target.conversationId === mainId || (delivery.target.conversationId === delivery.conversationId && timeline.groups.some(group => group.runIds.includes(delivery.runId)));
    if (!inMain) return;
    const frame = requestAnimationFrame(() => {
      const area = scroller.current;
      if (!area?.isConnected || !area.clientHeight) return;
      const node = [...area.querySelectorAll<HTMLElement>("[data-message-id]")].find(element => element.dataset.messageId === delivery.target?.focus?.messageId);
      if (delivery.target?.focus?.messageId && !node) return;
      if (node) area.scrollTo({ top: Math.max(0, area.scrollTop + node.getBoundingClientRect().top - area.getBoundingClientRect().top - 24) });
      explanation.onReady(delivery.id, !!node);
    });
    return () => cancelAnimationFrame(frame);
  }, [workspace.delivery?.id, mainId, mainMessages.length, quick, matterActive, projectPageId, wechatPage]);
  function sendMain() {
    explanation.stop(); atBottom.current = true;
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
    void workspace.sendMain();
  }
  useLayoutEffect(() => {
    if (matterActive || projectPage || wechatPage) { mainWasHidden.current = true; return; }
    if (!state || !workspace.assistant || !scroller.current) return;
    const container = scroller.current;
    if (!scrollRestored.current || mainWasHidden.current) {
      mainWasHidden.current = false;
      scrollRestored.current = true;
      container.scrollTop = mainView.scrollLayout === "continuous-v2" ? mainView.scrollTop : container.scrollHeight;
      atBottom.current = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
      workspace.changeMainView({ scrollTop: container.scrollTop, scrollLayout: "continuous-v2" });
    } else if (atBottom.current && (mainMessages.length || stream)) container.scrollTop = container.scrollHeight;
  }, [mainMessages.length, stream, !!state, !!workspace.assistant, matterActive, projectPageId, wechatPage]);
  useEffect(() => {
    if (!quick) return;
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape" && !workspace.settings && !event.isComposing) void window.orbitDesktop?.hideQuick(); };
    document.addEventListener("keydown", keydown);
    const resize = new ResizeObserver(() => { if (quickFrame.current) void window.orbitDesktop?.resizeQuick(voice.callActive ? callKeyboard ? 650 : 520 : quickFrame.current.scrollHeight + 4); });
    if (quickFrame.current) resize.observe(quickFrame.current);
    return () => { document.removeEventListener("keydown", keydown); resize.disconnect(); };
  }, [quick, workspace.settings, voice.callActive, callKeyboard]);
  function openArtifact(id: string) {
    const artifact = state?.artifacts.find(a => a.id === id);
    if (artifact) workspace.openResource({ id: `artifact:${id}`, kind: "artifact", conversationId: artifact.conversationId, artifactId: id, title: artifact.title });
  }
  async function deleteMatter(id: string) {
    if (deleting !== id) { setDeleting(id); return; }
    setListPending(true); setListError("");
    try {
      await request(`/conversations/${encodeURIComponent(id)}`, "DELETE");
      if (id === selectedId) workspace.closeMatter();
      await workspace.refresh(); setDeleting(null);
    } catch (error) { setListError((error as Error).message); }
    finally { setListPending(false); }
  }
  const error = workspace.localError || workspace.error;
  const settings = workspace.settings && <SettingsDialog onClose={() => workspace.setSettings(false)} onSaved={workspace.refresh} messages={state?.messages || []}/>;
  const composer = state && <Composer draft={mainDraft} onChange={workspace.changeMainDraft} onSend={sendMain} onStop={() => { explanation.stop(); void workspace.stopMain(); }} voice={undefined}
    title="主对话" referenceTitle={referenceTitle(mainDraft.reference, state)} isHome busy={workspace.mainBusy} routing={workspace.mainRouting}
    configured={state.configured} onSettings={() => quick && native ? void window.orbitDesktop?.openMain({ view: "settings" }) : workspace.setSettings(true)} focusKey={workspace.mainFocusKey} autoFocus={!matterActive && !projectPage && !wechatPage} compact={quick} inputLabel="主对话输入"/>;
  // The main surface is one continuous conversation. Only the quick surface
  // deliberately limits its content to the current exchange.
  const visibleTimeline = quick ? selectHomeTimeline(timeline, { maxGroups: 1 }) : timeline;
  const transcript = state && visibleTimeline.groups.map(group => <Transcript key={group.id} data={state} messages={group.messages}
    assignments={visibleTimeline.assignments} streamAssignment={visibleTimeline.streamAssignment}
    stream={visibleTimeline.streamGroupId === group.id ? stream : undefined} run={visibleTimeline.runGroupId === group.id ? mainRun : undefined} voice={undefined}
    activities={state.activities.filter(a => a.runId === mainRun?.id)} onOpen={openConversation} onReference={workspace.referenceMain} onArtifact={quick ? () => void window.orbitDesktop?.openMain() : openArtifact}/>);
  const errorBar = error && <div className="dt-error" role="alert"><span>{error}</span><button className="dt-icon" aria-label="关闭提示" onClick={workspace.clearError}><X size={14}/></button></div>;
  const textReply = activeRun?.status === "completed" ? activeMessages.filter(message => message.role === "assistant" && message.runId === activeRun.id).at(-1)?.content : undefined;
  const deliveryError = state?.activities.findLast(activity => activity.runId === activeRun?.id && activity.title === "语音讲解未生成")?.detail;
  const call = <VoiceSession voice={voice} busy={activeBusy && (!workspace.delivery || workspace.delivery.kind === "preview")} routing={activeRouting} delivery={workspace.delivery} ready={explanation.ready} textReply={textReply} deliveryError={deliveryError} lastUserText={activeMessages.filter(message => message.role === "user").at(-1)?.content || ""} resourceTitle={paneOpen ? view.resource?.title : matterActive ? workspace.conversation?.title : undefined} keyboardOpen={callKeyboard} onKeyboard={() => { if (quick) setCallKeyboard(value => !value); else focusMain(); }} onStopTask={() => { explanation.stop(); void (matterActive ? workspace.stop() : workspace.stopMain()); }} compact/>;
  if (!state || !workspace.assistant) return <div className="dt-root dt-boot"><OrbitAvatar size={65}/><p>{error || "正在打开你的工作空间…"}</p>{error ? <button className="dt-secondary" onClick={() => location.reload()}>重新连接</button> : <LoaderCircle size={17} className="dt-spin"/>}</div>;
  if (quick) return <div className={`dt-root dt-quick ${voice.callActive ? "dt-quick-call" : ""}`} ref={quickFrame}>
    <header className="dt-quick-header"><span><OrbitAvatar size={29}/>Orbit{mode.demo && <small className="dt-demo-badge">演示模式</small>}</span><div><button className="dt-icon" aria-label="打开完整工作空间" onClick={() => void window.orbitDesktop?.openMain({ view: "home", conversationId: mainId, ...(voice.callActive && !voice.micMuted ? { voiceInput: true } : {}), ...(workspace.interactionRun && workspace.mainBusy ? { runId: workspace.interactionRun.id, conversationId: workspace.interactionRun.conversationId } : {}) })}><ArrowUpRight size={16}/></button><button className="dt-icon" aria-label="收起助手" onClick={() => void window.orbitDesktop?.hideQuick()}><X size={15}/></button></div></header>
    {voice.callActive ? <>{call}{errorBar}{callKeyboard && <div className="dt-call-keyboard">{composer}</div>}</> : <>
    {!mainMessages.length && <div className="dt-quick-context"><strong>接下来想做什么？</strong><p>直接提问，或接着之前的讨论。</p></div>}
    {mainMessages.filter(message => message.role === "user").at(-1) && <div className="dt-quick-last-user">{mainMessages.filter(message => message.role === "user").at(-1)!.content}</div>}
    {(workspace.mainBusy ? <div className="dt-quick-last-answer dt-delivery-working"><LoaderCircle size={14} className="dt-spin"/>正在找回背景、准备内容…</div> : <div className="dt-quick-last-answer" ref={scroller}><Transcript data={state} messages={mainMessages.filter(message => message.role === "assistant").slice(-1)} assignments={timeline.assignments} activities={[]} onOpen={openConversation} onReference={workspace.referenceMain} onArtifact={() => void window.orbitDesktop?.openMain()} voice={undefined}/></div>)}
    {errorBar}{composer}</>}<footer className="dt-quick-hint">{voice.callActive ? "Esc 收起并结束通话" : workspace.mainBusy ? "正在处理 · 可打开工作空间继续" : "⌥ Space 随时唤起 · Esc 收起"}</footer>{settings}
  </div>;
  const matters = state.conversations.filter(c => c.id !== mainId && !c.archived && (!c.draft || !!c.projectId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const filteredMatters = matters.filter(c => `${c.title} ${c.project} ${c.summary} ${state.messages.filter(m => m.conversationId === c.id).map(m => m.content).join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  const filteredGroups = [...projects.map(project => ({ id: project.id, title: project.name, conversations: matters.filter(item => item.projectId === project.id), example: false })), { id: "unassigned", title: "其他对话", conversations: matters.filter(item => !item.projectId), example: false }].map(group => ({ ...group, conversations: group.title.toLowerCase().includes(query.toLowerCase()) ? group.conversations : group.conversations.filter(item => filteredMatters.some(match => match.id === item.id)) })).filter(group => group.conversations.length);
  return <div className={`dt-root dt-shell dt-secretary-shell dt-persistent-shell dt-focus-shell ${native ? "dt-native" : ""} ${paneOpen ? "dt-resource-open" : ""} ${matterActive ? "dt-matter-focused" : ""} ${overviewOpen ? "dt-overview-open" : ""}`}>
    <header className="dt-toolbar"><div className="dt-toolbar-leading"><button className="dt-icon dt-toolbar-sidebar" onClick={toggleSidebar} aria-label={sidebarCollapsed ? "展开工作导航" : "收起工作导航"} title={sidebarCollapsed ? "展开工作导航" : "收起工作导航"} aria-expanded={!sidebarCollapsed} aria-controls="workspace-navigation"><PanelLeft size={18} aria-hidden="true"/></button></div>
      <nav className="dt-toolbar-actions" aria-label="工作空间导航">{mode.demo && <span className="dt-demo-badge">演示模式</span>}<span className={`dt-connection ${workspace.online ? "" : "offline"}`}><i/>{workspace.online ? "本地运行" : "连接中"}</span><button className="dt-icon" aria-label="设置" onClick={() => workspace.setSettings(true)}><Settings2 size={17}/></button></nav>
    </header>
    <div className="dt-body">
      <WorkspaceSidebar projects={projects} conversations={state.conversations} activeProjectId={activeProjectId} projectPageId={projectPageId} mainId={mainId} selectedId={selectedId} collapsed={sidebarCollapsed} wechatActive={wechatPage}
        onToggle={toggleSidebar}
        onOpen={openConversation} onProject={openProject} onCreateProject={newProject} onHome={goHome} onWechat={openWechat} onHistory={() => { setHistory(true); setQuery(""); }} onSettings={() => workspace.setSettings(true)}/>
      <div className="dt-discussion-stage">
      <main className="dt-main dt-home dt-anchor-main" aria-label="Orbit 主对话" hidden={matterActive || !!projectPage || wechatPage}>
        <div className="dt-scroll dt-main-scroll" ref={scroller} onScroll={event => {
          const target = event.currentTarget; if (!target.clientHeight) return; atBottom.current = target.scrollHeight - target.scrollTop - target.clientHeight < 100; workspace.changeMainView({ scrollTop: target.scrollTop, scrollLayout: "continuous-v2" });
        }}><div className="dt-content">
          <div className="dt-home-overview"><ProjectOverview projects={projects} state={state} expanded={homeExpanded} onToggle={() => setHomeExpanded(value => { const next = !value; try { localStorage.setItem("orbit-home-overview-v2", String(next)); } catch {} return next; })} onOpen={openProject} onCreate={newProject}/></div>
          <WechatTopicNotice onOpen={openWechat}/>
          <div className="dt-home-conversation-label"><span>与 Orbit 的对话</span><div/></div>
          {transcript}
          {!mainMessages.length && <div className="dt-home-start"><p>{matters.length ? "想继续哪件事，或有新的想法？" : "有什么想一起完成的？"}</p><span>直接开始聊，相关讨论会自动整理，随时可以找回。</span>{matters.length > 0 && <button onClick={() => workspace.changeMainDraft({ text: "帮我回顾一下最近几件事的进展。", reference: null })}>回顾最近的进展<ArrowUpRight size={12}/></button>}</div>}
        </div></div>
        {voice.callActive && !matterActive && <div className="dt-inline-call">{call}</div>}
        <div className="dt-compose-dock" ref={composerDock}><div className="dt-compose-inner">{errorBar}{paneOpen && <div className="dt-main-visible-context"><span>正在看</span><strong>{view.resource?.title || workspace.conversation?.title}</strong><span>可直接说“这里”</span></div>}{composer}<div className="dt-composer-hint"><span>{paneOpen ? "在这里继续聊，右侧资料可直接引用。" : "直接接着聊，相关内容会自动整理。"}</span>{native && <kbd>⌥ Space</kbd>}</div></div></div>
      </main>
      {projectPage && <ProjectWorkspace key={projectPage.id} project={projectPage} state={state} onBack={goHome} onOpen={openConversation} onRefresh={workspace.refresh}/>}
      {wechatPage && <PaneBoundary onClose={goHome}><WechatPage onDiscuss={draft => { void workspace.refresh(); goHome(); if (draft) workspace.changeMainDraft({ text: draft, reference: null }); }}/></PaneBoundary>}
      {matterActive && <PaneBoundary key={selectedId} onClose={goHome}><MatterWorkspace workspace={workspace} voice={voice} textOnly onProject={openProject} delivery={workspace.delivery} onReady={explanation.onReady} onHome={goHome} onOverview={showOverview} overviewOpen={overviewOpen} onSource={showMainSource} call={voice.callActive ? call : undefined} notice={errorBar}/></PaneBoundary>}
      </div>
      {overviewOpen && workspace.conversation && <DiscussionOverview key={selectedId} data={state} conversation={workspace.conversation} onOpen={openConversation} onClose={() => setOverviewId(null)} onLocate={id => workspace.navigate(selectedId, id)} onResource={resource => { setOverviewId(null); workspace.openResource(resource); }}/> }
      {paneOpen && view.resource && <PaneBoundary key={`resource:${selectedId}:${view.resource.id}`} onClose={closeResource}><ReferencePane data={state} tab={view.resource} selectedId={selectedId} delivery={workspace.delivery} onReady={explanation.onReady} onClose={closeResource} onOpen={openConversation} onResource={workspace.openResource} onReference={matterActive ? workspace.reference : workspace.referenceMain} onRefresh={workspace.refresh}/></PaneBoundary>}
    </div>
    {settings}
    {creatingProject && <Dialog title="新建项目" onClose={() => setCreatingProject(false)}><form className="dt-project-edit" onSubmit={event => { event.preventDefault(); void createProject(); }}><p className="dt-settings-description">给持续讨论的事情留一个共同空间。</p><label>项目名称<input data-autofocus autoFocus aria-label="项目名称" value={projectName} onChange={event => setProjectName(event.target.value)} maxLength={80} placeholder="例如：个人网站、金融学习"/></label><div className="dt-form-actions"><button className="dt-primary" disabled={projectPending || !projectName.trim()} type="submit">{projectPending ? "创建中…" : "创建项目"}</button></div>{projectError && <p className="dt-settings-error" role="alert">{projectError}</p>}</form></Dialog>}
    {history && <Dialog title="项目与对话" onClose={() => { setHistory(false); setDeleting(null); }}><div className="dt-search"><Search size={16}/><input data-autofocus aria-label="查找项目和对话" value={query} onChange={e => setQuery(e.target.value)} placeholder="查找标题、背景或讨论内容"/></div><div className="dt-history-list">{filteredGroups.map(group => <section className="dt-history-group" key={group.id}><div className="dt-history-group-heading"><strong>{group.title}</strong><small>{group.conversations.length} 段讨论{group.example ? " · 示例" : ""}</small></div>{group.conversations.map(c => <div className="dt-history-row" key={c.id}><button className="dt-history-open" onClick={() => { openConversation(c.id); setHistory(false); }}><MessageSquare size={17}/><span><strong>{c.title}{c.showcase && <small>示例</small>}</strong><p>{plainSummary(c.summary || "还没有讨论摘要", 95)}</p><small>{c.project} · {dateLabel(c.updatedAt)}</small></span><ArrowUpRight size={14}/></button><button className={`dt-history-delete ${deleting === c.id ? "dt-danger" : ""}`} disabled={listPending} onClick={() => void deleteMatter(c.id)}>{deleting === c.id ? "确认删除" : "删除"}</button></div>)}</section>)}{!filteredGroups.length && <p className="dt-empty-list">{query ? "没有找到对应讨论。" : "从主对话开始，相关项目和讨论会保存在这里。"}</p>}</div>{listError && <p className="dt-settings-error" role="alert">{listError}</p>}<button className="dt-secondary dt-history-home" onClick={() => { goHome(); setHistory(false); }}><Plus size={14}/>回到主对话，聊件新事</button></Dialog>}

  </div>;
}
