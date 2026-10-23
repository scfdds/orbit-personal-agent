import MemoryPanel from "../apps/memory/Panel.tsx";
import FloatingComposer from "./FloatingComposer.tsx";
import StartView from "./StartView.tsx";
import { rootOf } from "../shared/conversation-tree.ts";
import { conversationRounds, plainExcerpt, validTurn } from "../shared/discussion.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  PanelLeft,
  PanelRight,
  Laptop,
  ChevronDown,
  Ellipsis,
  Search,
  ArrowLeft,
  Check,
  LoaderCircle,
  AlertCircle,
  X,
  Info,
  Clock3,
} from "lucide-react";
import type {
  AppManifest,
  AppObject,
  PanelRef,
  Conversation,
  Work,
  IntakeRequest,
  IntakeResult,
} from "../shared/types.ts";
import { request, useOrbit } from "./api.ts";
import Sidebar, { type View } from "./Sidebar.tsx";
import ChatView from "./ChatView.tsx";
import GlobalViews from "./GlobalViews.tsx";
import GoalsView from "./GoalsView.tsx";
import WorkspacePanel from "./WorkspacePanel.tsx";
import { IconButton, Modal, OrbitMark, Status } from "./ui.tsx";
import DemoGuide from "./DemoGuide.tsx";
import AppDetails from "./AppDetails.tsx";
import DevicesView, { CurrentDeviceDialog, useExecutionDevice } from "./DevicesView.tsx";
import { installedDetails } from "./app-catalog.ts";

type Dialog =
  "search" | "track" | "about" | "environment" | "edit" | "app" | null;
export default function App() {
  const { state, online, error, streams, refresh } = useOrbit();
  const [selectedId, setSelectedId] = useState(
    () => new URLSearchParams(window.location.search).get("conversation") || localStorage.getItem("orbit.selected") || "daily-ai-radar",
  );
  const [view, setView] = useState<View>("task");
  const [appOrigins, setAppOrigins] = useState<Record<string, {view: "apps" | "start"; section?: string}>>({});
  const [overviewGoalId, setOverviewGoalId] = useState<string>();
  const [collapsed, setCollapsed] = useState(false);
  const [panelHidden, setPanelHidden] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const lastPanel = useRef<{ conversationId: string; value: string | undefined } | undefined>(undefined);
  const [dialog, setDialog] = useState<Dialog>(null);
  const deviceState = useExecutionDevice(view === "devices" || dialog === "environment", online);
  const [editingWork, setEditingWork] = useState<Conversation | null>(null);
  const [appInfo, setAppInfo] = useState<AppManifest | null>(null);
  const [memoryPinned, setMemoryPinned] = useState(false);
  const [memoryScope, setMemoryScope] = useState("all");
  const lastMemoryScope = useRef<string | undefined>(undefined);
  const [memoryNavigationKey, setMemoryNavigationKey] = useState(0);
  const [memorySelected, setMemorySelected] = useState<string>();
  const [memorySelectedMessage, setMemorySelectedMessage] = useState<string>();
  const [focusMessageId, setFocusMessageId] = useState<string | undefined>();
  const [forkTarget, setForkTarget] = useState<{
    id: string;
    messageId: string;
  } | null>(null);
  const [forkTitle, setForkTitle] = useState("");
  const [forkBusy, setForkBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [intakeBusy, setIntakeBusy] = useState(false);
  const [openingApp, setOpeningApp] = useState(false);
  const appOpening = useRef(false);
  const [startSection, setStartSection] = useState<string>();
  const navigationVersion = useRef(0);
  const [arrangingWork, setArrangingWork] = useState<Work | null>(null);
  const [targetWorkId, setTargetWorkId] = useState<string | undefined>();
  const [guideOpen, setGuideOpen] = useState(false);
  const [localPanel, setLocalPanel] = useState<{conversationId: string; panel: PanelRef} | null>(null);
  const closeGuide = useCallback(() => setGuideOpen(false), []);
  const [toast, setToast] = useState("");
  const [search, setSearch] = useState("");
  const work =
    state?.conversations.find((w) => w.id === selectedId) ||
    state?.conversations.find((w) => !w.archived && !w.draft) ||
    state?.conversations[0];
  const closeDialog = useCallback(() => setDialog(null), []);
  function openDevices() {
    navigationVersion.current++;
    setView("devices");
    setMemoryPinned(false);
    setPanelHidden(true);
    setExpanded(false);
    setMobileMenu(false);
    setDialog(null);
  }
  const closeFork = useCallback(() => {
    if (!forkBusy) setForkTarget(null);
  }, [forkBusy]);
  const notify = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (work && work.id !== selectedId) setSelectedId(work.id);
  }, [work?.id, selectedId]);
  useEffect(() => {
    localStorage.setItem("orbit.selected", selectedId);
    setExpanded(false);
  }, [selectedId]);
  useEffect(() => {
    if (!work) return;
    const value = JSON.stringify(work.panel);
    // Only a panel update in the current conversation should reveal the workspace.
    if (lastPanel.current?.conversationId === work.id && value !== lastPanel.current.value)
      setPanelHidden(false);
    lastPanel.current = { conversationId: work.id, value };
  }, [work?.id, work?.panel && JSON.stringify(work.panel)]);
  async function mutate<T>(
    path: string,
    method: string,
    body?: unknown,
  ): Promise<T> {
    try {
      const result = await request<T>(path, method, body);
      await refresh();
      return result;
    } catch (e) {
      notify((e as Error).message);
      await refresh();
      throw e;
    }
  }
  function select(id: string) {
    setLocalPanel(null);
    navigationVersion.current++;
    setFocusMessageId(undefined);
    if (memoryPinned && memoryScope !== "all" && state)
      setMemoryScope(rootOf(id, state.conversations));
    setSelectedId(id);
    setTargetWorkId(undefined);
    setMemoryPinned(false);
    setPanelHidden(true);
    setExpanded(false);
    setView("task");
    setDialog(null);
    setMobileMenu(false);
  }
  function createConversation(section?: string) {
    navigationVersion.current++;
    setStartSection(section); setMemoryPinned(false); setPanelHidden(true);
    setTargetWorkId(undefined); setExpanded(false); setView("start");
    setMobileMenu(false); setDialog(null);
  }
  async function intake(input: IntakeRequest) {
    const version = navigationVersion.current;
    setIntakeBusy(true);
    try {
      const result = await mutate<IntakeResult>("/intake", "POST", input);
      if (version === navigationVersion.current) {
        select(result.conversationId); setMemoryPinned(false); setPanelHidden(true);
      } else notify(`已在「${result.route.title}」中接着处理`);
    } finally { setIntakeBusy(false); }
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (document.getElementById("root")?.inert) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearch("");
        setDialog("search");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  async function send(text: string) {
    if (!work) return;
    setSending(true);
    setView("task");
    try {
      await mutate(`/conversations/${work.id}/messages`, "POST", {
        content: text,
        ...(targetWorkId ? { workId: targetWorkId } : {}),
      });
    } finally {
      setSending(false);
    }
  }
  function sendFromPanel(text: string) {
    void send(text).catch(() => {});
  }
  async function launchApp(appId: string, inNewConversation = true) {
    if (appOpening.current) return;
    appOpening.current = true;
    setOpeningApp(true);
    const version = navigationVersion.current;
    const origin = view === "apps" || view === "start" ? {view, section: startSection} : undefined;
    try {
      const opened = await mutate<Conversation>(`/apps/${encodeURIComponent(appId)}/open`, "POST", {
        ...(!inNewConversation && work ? { conversationId: work.id } : {}),
        ...(inNewConversation && view === "start" && startSection ? { project: startSection } : {}),
      });
      if (navigationVersion.current === version) {
        if (inNewConversation && origin) setAppOrigins(previous => ({...previous, [opened.id]: origin}));
        select(opened.id);
        setPanelHidden(false);
      }
    } catch { /* mutate presents the error and preserves the current surface. */ }
    finally { appOpening.current = false; setOpeningApp(false); }
  }
  function openPanel(panel: PanelRef) {
    setLocalPanel(null);
    if (!work) return;
    if (panel.kind === "app" && panel.appId === "memory") {
      setMemoryPinned(true);
      setMemoryScope(rootOf(work.id, state?.conversations || []));
    } else setMemoryPinned(false);
    setPanelHidden(false);
    if (view !== "apps") setView("task");
    void mutate(`/conversations/${work.id}`, "PATCH", { panel }).catch(
      () => {},
    );
  }
  function openMemory(scope?: string) {
    setMemoryNavigationKey(key=>key+1);
    navigationVersion.current++;
    const firstTopic=state?.sections?.[0];
    const targetScope=scope ?? lastMemoryScope.current ?? (firstTopic ? `section:${firstTopic.id}` : "all");
    lastMemoryScope.current=targetScope;
    setMemoryScope(targetScope);
    setMemoryPinned(true);
    setPanelHidden(false);
    setView("memory");
    setExpanded(false);
    setMemorySelected(undefined);
    setMemorySelectedMessage(undefined);
    setMobileMenu(false);
  }
  function navigateMemory(id: string, messageId?: string) {
    select(id);
    if (state) setMemoryScope(rootOf(id,state.conversations));
    setFocusMessageId(messageId);
  }
  function fork(id: string, messageId: string) {
    setForkTarget({ id, messageId });
    setForkTitle("");
  }
  function openWork(item: Work) {
    navigationVersion.current++;
    if (view === "overview") {
      setOverviewGoalId(item.id);
      setPanelHidden(true);
      return;
    }
    setMemoryPinned(false);
    setTargetWorkId(undefined);
    setSelectedId(item.conversationId);
    setPanelHidden(false);
    setExpanded(false);
    void mutate(`/conversations/${item.conversationId}`, "PATCH", {
      panel: { kind: "work", workId: item.id },
    }).catch(() => {});
  }
  function track(item?: Work) {
    setArrangingWork(item || null);
    setDialog("track");
  }
  function discuss(item: Work) {
    select(item.conversationId);
    setTargetWorkId(item.id);
    setPanelHidden(false);
  }
  async function updateObject(
    object: AppObject,
    data: Record<string, unknown>,
  ) {
    await mutate(`/objects/${object.id}`, "PATCH", {
      version: object.version,
      data,
    });
  }
  async function demoEvent() {
    if (!work) return;
    try {
      const result = await mutate<{ detail: string }>(
        `/conversations/${work.id}/demo-event`,
        "POST",
        {},
      );
      notify(result.detail);
    } catch {}
  }
  function action(workId: string, value: "pause" | "resume" | "end") {
    void mutate(`/works/${workId}/action`, "POST", { action: value }).catch(
      () => {},
    );
  }
  if (!state)
    return (
      <div className="loading-screen">
        <OrbitMark size={48} />
        <h1>Orbit</h1>
        <p>{error || "正在打开你的工作空间…"}</p>
        {error ? (
          <button className="button secondary" onClick={() => void refresh()}>
            重新连接
          </button>
        ) : (
          <LoaderCircle size={18} className="spin" />
        )}
      </div>
    );
  const effectivePanel: PanelRef | null = memoryPinned
    ? { kind: "app", appId: "memory" }
    : localPanel?.conversationId === work?.id ? localPanel!.panel : work?.panel || null;
  const showWorkspace =
    work &&
    !panelHidden &&
    (view === "task" || (view === "apps" && work.panel?.kind === "app"));
  const overviewGoal = state.works.find(w => w.id === overviewGoalId) || state.works.find(w => w.showcase) || state.works.find(w => !["paused", "completed"].includes(w.status)) || state.works[0];
  const selectedRound = memorySelected && memorySelectedMessage ? conversationRounds(memorySelected,state.messages).find(r=>r.messages.some(m=>m.id===memorySelectedMessage)) : undefined;
  const selectedQuestion = selectedRound ? validTurn(selectedRound,state.memories?.find(m=>m.conversationId===memorySelected)?.discussion?.turns)?.question || plainExcerpt(selectedRound.questions.map(m=>m.content).join(' ')) : undefined;
  const targetWork = state.works.find(
    (w) => w.id === targetWorkId && w.conversationId === work?.id,
  );
  return (
    <div
      className={`orbit-app ${collapsed ? "sidebar-collapsed" : ""} ${mobileMenu ? "mobile-menu-open" : ""} ${showWorkspace ? "with-workspace" : ""} ${expanded && showWorkspace ? "workspace-expanded" : ""}`}
    >
      {!collapsed && (
        <Sidebar
          state={state}
          selectedId={work?.id || ""}
          view={view}
          onView={(value) => {
            navigationVersion.current++;
            if (value === "devices") openDevices();
            else if (value === "memory") openMemory();
            else { setView(value); setMemoryPinned(false); setPanelHidden(true); setMobileMenu(false); }
          }}
          onSelect={select}
          activeTopicId={view==="memory"&&memoryScope.startsWith("section:")?memoryScope.slice(8):undefined}
          onOpenTopic={(id)=>{navigationVersion.current++;openMemory(`section:${id}`);}}
          onNew={(section) => void createConversation(section)}
          onMutation={mutate}
          onSearch={() => {
            setSearch("");
            setDialog("search");
          }}
          onCollapse={() => {
            setCollapsed(true);
            setMobileMenu(false);
          }}
          onAbout={() => setDialog("about")}
          onGuide={() => setGuideOpen(true)}
        />
      )}
      {mobileMenu && (
        <button
          className="mobile-menu-shade"
          aria-label="关闭导航"
          onClick={() => setMobileMenu(false)}
        />
      )}
      <main className={`main-pane ${view !== "task" ? "global-surface" : ""}`}>
        <header className={`main-header ${view !== "task" ? "global-header" : ""}`}>
          <div className="header-left">
            <IconButton
              label="打开导航"
              className="mobile-nav-button"
              onClick={() => {
                setCollapsed(false);
                setMobileMenu(true);
              }}
            >
              <PanelLeft size={18} />
            </IconButton>
            {collapsed && (
              <IconButton
                label="展开侧边栏"
                onClick={() => setCollapsed(false)}
              >
                <PanelLeft size={18} />
              </IconButton>
            )}
            {view === "task" && work && appOrigins[work.id] && <button className="app-origin-back" aria-label={appOrigins[work.id]!.view === "apps" ? "返回应用中心" : "返回新对话"} onClick={() => {
              const origin = appOrigins[work.id]!;
              navigationVersion.current++;
              setView(origin.view); setStartSection(origin.section);
              setPanelHidden(true); setExpanded(false); setMemoryPinned(false); setTargetWorkId(undefined);
            }}><ArrowLeft size={15}/><span>{appOrigins[work.id]!.view === "apps" ? "应用中心" : "新对话"}</span></button>}
            <div className="header-title">
              {view === "task" && work ? (
                <>
                  <button
                    onClick={() => {
                      setEditingWork(work);
                      setDialog("edit");
                    }}
                  >
                    {work.title}
                    <ChevronDown size={12} />
                  </button>
                  <span>{work.project || "个人工作"}</span>
                </>
              ) : (
                null
              )}
            </div>
          </div>
          <div className="header-actions">
            {view === "task" && (
            <button
              className="environment-chip"
              aria-label="本地执行，查看当前设备"
              onClick={() => setDialog("environment")}
            >
              <Laptop size={14} />
              <span>本地执行</span>
              <span className={`connection-dot ${online ? "" : "offline"}`} />
            </button>
            )}
            {view === "task" && work && (
              <>
                <IconButton
                  label={showWorkspace ? "收起工作区" : "打开工作区"}
                  className={showWorkspace ? "active" : ""}
                  onClick={() => setPanelHidden(!panelHidden)}
                >
                  <PanelRight size={18} />
                </IconButton>
              </>
            )}
          </div>
        </header>
        {(!online || error || !state.configured) && (
          <div className="connection-banner">
            <AlertCircle size={14} />
            {!state.configured
              ? "模型尚未配置，请在服务端 .env.local 中设置 API Key 后重启。"
              : error || "正在重新连接本地服务，已有内容会保留。"}
          </div>
        )}
        {view === "start" ? (
          <StartView apps={state.apps} project={startSection} busy={intakeBusy || openingApp} configured={state.configured}
            onSubmit={intake} onClearProject={() => setStartSection(undefined)}
            onOpenApp={appId => void launchApp(appId)}
            onApps={() => { navigationVersion.current++; setView("apps"); setPanelHidden(true); }}/>
        ) : view === "task" && work ? (
          <>
            <ChatView
              visible={!expanded && !mobileMenu}
              onRead={() => { if(work.unread) void request(`/conversations/${work.id}`, "PATCH", {unread:false}).then(refresh).catch(()=>{}); }}
              focusMessageId={focusMessageId}
              onFork={(messageId) => fork(work.id, messageId)}
              onOpenConversation={id => { setMemoryPinned(false); select(id); }}
              work={work}
              workspaceVisible={showWorkspace}
              state={state}
              stream={streams[work.id]}
              sending={sending}
              onSend={send}
              onStop={() =>
                void mutate(`/conversations/${work.id}/stop`, "POST", {}).catch(
                  () => {},
                )
              }
              onOpenArtifact={(artifactId) =>
                openPanel({ kind: "artifact", artifactId })
              }
              onOpenApps={() => { navigationVersion.current++; setView("apps"); setPanelHidden(true); }}
              onOpenApp={appId => void launchApp(appId, false)}
              onOpenSubagent={(agentId) =>
                openPanel({
                  kind: "subagents",
                  ...(agentId ? { agentId } : {}),
                })
              }
              onOpenWork={openWork}
              targetWork={targetWork}
              onClearTarget={() => setTargetWorkId(undefined)}
            />
          </>
        ) : view === "devices" ? (
          <DevicesView {...deviceState} online={online} onNotify={notify}/>
        ) : view === "memory" ? (
          <div className="global-memory-page">
            <MemoryPanel
              key={memoryNavigationKey}
              work={work || {id:"", title:"",project:"",pinned:false,archived:false,goal:"",status:"idle",summary:"",continuous:false,unread:false,createdAt:"",updatedAt:"",panel:null}}
              snapshot={state} objects={state.objects} object={null}
              memoryScope={memoryScope} onMemoryScope={scope=>{lastMemoryScope.current=scope;setMemoryScope(scope);}}
              onNavigate={navigateMemory} onFork={fork}
              onSelection={(id,messageId)=>{setMemorySelected(id);setMemorySelectedMessage(messageId);}}
              onUpdate={updateObject} onSend={sendFromPanel}
              onOpenApp={(appId) => openPanel({kind:"app", appId})}
              onDemoEvent={demoEvent}
            />
          </div>
        ) : view === "overview" ? (
          <GoalsView state={state} selected={overviewGoal}
            onSelect={id => { navigationVersion.current++; setOverviewGoalId(id); }}
            onCreate={() => track()} onConversation={select}
            onAction={(id, action) => mutate(`/works/${id}/action`, "POST", {action})}/>
        ) : (
          <GlobalViews
            state={state}
            onOpenApp={(appId) => void launchApp(appId)}
            onAppInfo={(app) => {
              setAppInfo(app);
              setDialog("app");
            }}
            onNotify={notify}
          />
        )}
        {(view === "memory" || view === "overview" || view === "apps") && <FloatingComposer
          key={view}
          state={state} streams={streams}
          context={{view, ...(view === "memory" && memorySelected ? {conversationId: memorySelected,messageId:memorySelectedMessage} : view === "memory" && memoryScope.startsWith("section:") ? {sectionId:memoryScope.slice(8)} : {}), ...(view === "overview" && overviewGoal ? {workId:overviewGoal.id} : {}), ...(view === "apps" && showWorkspace && work?.panel?.kind === "app" ? {appId:work.panel.appId} : {})}}
          contextLabel={view === "memory" ? (memorySelected ? selectedQuestion || state.conversations.find(c=>c.id===memorySelected)?.title || "对话纪要" : state.sections?.find(s=>`section:${s.id}`===memoryScope)?.name || "对话纪要") : view === "overview" ? (overviewGoal?.title || "长期目标") : (showWorkspace ? state.apps.find(a=>work?.panel?.kind === "app" && a.id===work.panel.appId)?.name || "应用中心" : "应用中心")}
          onOpen={select} onRefresh={refresh} onError={notify}
        />}
      </main>
      {showWorkspace && (
        <WorkspacePanel
          state={state}
          work={work}
          panel={effectivePanel}
          memoryScope={memoryPinned ? memoryScope : rootOf(work.id, state.conversations)}
          onMemoryScope={setMemoryScope}
          onNavigate={navigateMemory}
          onFork={fork}
          expanded={expanded}
          sidebarCollapsed={collapsed}
          onResize={() => setExpanded(false)}
          onExpand={() => setExpanded(!expanded)}
          onClose={() => {
            setPanelHidden(true);
            setExpanded(false);
          }}
          onPanel={openPanel}
          onUpdate={updateObject}
          onSend={sendFromPanel}
          onDemoEvent={demoEvent}
          onTrack={track}
          onAction={action}
          onOpenWork={openWork}
          onConversation={(id) => {
            select(id);
            setPanelHidden(false);
          }}
          onDiscuss={discuss}
          onRunWork={(id) =>
            void mutate(`/works/${id}/run`, "POST", {}).catch(() => {})
          }
          onDelegate={send}
          onContinueSubagent={async (id, instructions) => {
            await mutate(
              `/conversations/${work.id}/subagents/${id}/continue`,
              "POST",
              { instructions },
            );
          }}
          onStopSubagent={async (id) => {
            await mutate(
              `/conversations/${work.id}/subagents/${id}/stop`,
              "POST",
              {},
            );
          }}
          onToggleTrigger={(id, enabled) =>
            void mutate(`/triggers/${id}`, "PATCH", { enabled }).catch(() => {})
          }
        />
      )}
      {guideOpen && <DemoGuide state={state} onClose={closeGuide}
        onExample={(id, appId) => { setGuideOpen(false); select(id); setLocalPanel({conversationId:id,panel:appId?{kind:"app",appId}:{kind:"subagents"}}); setPanelHidden(false); }}
        onGoal={() => { setGuideOpen(false); navigationVersion.current++; setView("overview"); setMemoryPinned(false); setPanelHidden(true); setMobileMenu(false); setOverviewGoalId(state.works.find(w=>w.showcase)?.id); }}/>}
      {forkTarget && (
        <Modal title="展开分支对话" onClose={closeFork}>
          <form
            className="modal-body fork-dialog"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!forkTitle.trim() || forkBusy) return;
              setForkBusy(true);
              try {
                const child = await mutate<Conversation>(
                  `/conversations/${forkTarget.id}/fork`,
                  "POST",
                  { messageId: forkTarget.messageId, title: forkTitle.trim() },
                );
                setForkTarget(null);
                select(child.id);
                setMemoryScope(rootOf(child.id, [...state.conversations, child]));
                setMemoryPinned(true);
                if (window.innerWidth < 960) setPanelHidden(true);
                notify("已创建分支，来源背景已带入");
              } catch {
              } finally {
                setForkBusy(false);
              }
            }}
          >
            <p>带入截至这条消息的讨论背景，在新的对话中继续探索。</p>
            <label>
              分支名称
              <input
                autoFocus
                maxLength={160}
                placeholder="接下来想展开什么？"
                value={forkTitle}
                onChange={(e) => setForkTitle(e.target.value)}
              />
            </label>
            <div className="fork-preview">
              {state.messages
                .find((m) => m.id === forkTarget.messageId)
                ?.content.slice(0, 180)}
            </div>
            <button
              className="button primary"
              disabled={forkBusy || !forkTitle.trim()}
            >
              {forkBusy ? (
                <>
                  <LoaderCircle size={14} className="spin" />
                  正在整理分支背景…
                </>
              ) : (
                "创建分支"
              )}
            </button>
          </form>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Info size={16} />
          <span>{toast}</span>
          <IconButton label="关闭提示" onClick={() => setToast("")}>
            <X size={14} />
          </IconButton>
        </div>
      )}
      {dialog === "search" && (
        <Modal title="搜索对话" onClose={closeDialog}>
          <div className="modal-body">
            <div className="search-input">
              <Search size={17} />
              <input
                autoFocus
                placeholder="搜索标题、项目或目标…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <kbd>⌘ K</kbd>
            </div>
            <div className="search-results">
              {state.conversations
                .filter((w) => !w.draft)
                .filter((w) =>
                  `${w.title} ${w.project} ${w.goal}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((w) => (
                  <button
                    key={w.id}
                    onClick={() => {
                      if (w.archived)
                        void mutate(`/conversations/${w.id}`, "PATCH", {
                          archived: false,
                        })
                          .then(() => select(w.id))
                          .catch(() => {});
                      else select(w.id);
                    }}
                  >
                    <span>
                      <strong>{w.title}</strong>
                      <small>
                        {w.project}
                        {w.archived ? " · 已归档，点击恢复" : ""}
                      </small>
                    </span>
                    <Status status={w.status} compact />
                  </button>
                ))}
            </div>
          </div>
        </Modal>
      )}
      {dialog === "edit" && editingWork && (
        <EditWork
          work={editingWork}
          onClose={closeDialog}
          onSave={async (patch) => {
            await mutate(`/conversations/${editingWork.id}`, "PATCH", patch);
            closeDialog();
          }}
          onArchive={async () => {
            await mutate(`/conversations/${editingWork.id}`, "DELETE");
            closeDialog();
            notify("对话已删除");
          }}
        />
      )}
      {dialog === "track" && work && (
        <TrackWork
          conversations={state.conversations.filter((c) => !c.archived && (!c.draft || c.id === work?.id))}
          conversation={view === "overview" ? state.conversations.find(c => c.id === overviewGoal?.conversationId) || work : work}
          work={arrangingWork}
          onClose={closeDialog}
          onSave={async (input) => {
            if (arrangingWork) {
              await mutate(`/works/${arrangingWork.id}/trigger`, "POST", input);
              closeDialog();
              notify("已添加后续安排");
            } else {
              const created = await mutate<Work>("/works", "POST", input);
              closeDialog();
              openWork(created);
              notify("已创建长期目标");
            }
          }}
        />
      )}
      {dialog === "environment" && <CurrentDeviceDialog {...deviceState} online={online} onClose={closeDialog} onManage={openDevices}/>}
      {dialog === "app" && appInfo && <AppDetails app={installedDetails(appInfo)} onClose={closeDialog} busy={openingApp} onAction={() => {setDialog(null);void launchApp(appInfo.id);}}/>}
      {dialog === "about" && (
        <AboutDialog
          model={state.model}
          configured={state.configured}
          onClose={closeDialog}
          onReset={async () => {
            await mutate("/demo/reset", "POST", {});
            select("work-feedback");
            notify("演示任务已恢复初始状态，其他内容已保留");
          }}
        />
      )}
    </div>
  );
}

function EditWork({work,onClose,onSave}: {work: Conversation;onClose:()=>void;onSave:(patch:Partial<Conversation>)=>Promise<void>;onArchive:()=>Promise<void>}) {
  const [title,setTitle]=useState(work.title), [busy,setBusy]=useState(false);
  return <Modal title="重命名对话" onClose={onClose}><form className="modal-body form-stack" onSubmit={async e=>{e.preventDefault();setBusy(true);try{await onSave({title:title.trim()});}catch{}finally{setBusy(false);}}}><input autoFocus aria-label="对话名称" value={title} maxLength={160} onChange={e=>setTitle(e.target.value)}/><div className="simple-dialog-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={busy||!title.trim()}>保存</button></div></form></Modal>;
}

function TrackWork({
  conversations,
  conversation,
  work,
  onClose,
  onSave,
}: {
  conversations: Conversation[];
  conversation: Conversation;
  work: Work | null;
  onClose: () => void;
  onSave: (input: unknown) => Promise<void>;
}) {
  const [conversationId, setConversationId] = useState(conversation.id);
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [completionCriteria, setCompletionCriteria] = useState("");
  const [kind, setKind] = useState(work ? "event" : "manual");
  const [minutes, setMinutes] = useState(30);
  const [instructions, setInstructions] = useState(work?.goal || "");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={work ? "添加后续安排" : "创建长期目标"} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSave({
              ...(!work
                ? { conversationId, title: title.trim(), goal: goal.trim(), completionCriteria: completionCriteria.trim() }
                : {}),
              ...(kind !== "manual"
                ? {
                    kind,
                    instructions: instructions.trim() || goal.trim(),
                    ...(kind === "interval"
                      ? { intervalMinutes: minutes }
                      : {}),
                  }
                : {}),
            });
          } catch {
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body form-stack">
          {work ? (
            <p className="track-work-name">{work.title}</p>
          ) : (
            <>
              <label>
                目标名称
                <input
                  autoFocus
                  placeholder="例如：持续跟踪用户反馈"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={160}
                  required
                />
              </label>
              <label>
                目标说明
                <textarea
                  rows={3}
                  placeholder="希望 Orbit 持续推进什么，做到什么程度？"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  maxLength={4000}
                  required
                />
              </label>
              <label>
                完成要求
                <textarea rows={2} placeholder="完成或停止的条件，可以稍后补充" value={completionCriteria} maxLength={4000} onChange={e => setCompletionCriteria(e.target.value)}/>
              </label>
              <label>
                来源对话
                <select
                  value={conversationId}
                  onChange={(e) => setConversationId(e.target.value)}
                >
                  {conversations.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <label>
            何时继续
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {!work && <option value="manual">先保存目标，按需推进</option>}
              <option value="event">收到新反馈时</option>
              <option value="interval">按固定时间检查</option>
            </select>
          </label>
          {kind === "interval" && (
            <label>
              检查间隔（分钟）
              <input
                type="number"
                min={1}
                max={525600}
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
                required
              />
            </label>
          )}
          {kind !== "manual" && (
            <label>
              每次执行的要求
              <textarea
                rows={3}
                placeholder={
                  work ? "这项安排需要做什么？" : "留空则按目标说明执行"
                }
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                maxLength={4000}
                required={Boolean(work)}
              />
            </label>
          )}
          <p className="modal-note">
            {work
              ? "安排属于这个目标，可独立启用或停用。自动执行需要本地服务保持运行。"
              : "同一段对话可以关联多个长期目标，各自的进展和后续安排独立保存。"}
          </p>
        </div>
        <div className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            取消
          </button>
          <button
            className="button primary"
            disabled={busy || (!work && (!title.trim() || !goal.trim()))}
          >
            {busy ? "保存中…" : work ? "添加安排" : "创建长期目标"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function AboutDialog({
  model,
  configured,
  onClose,
  onReset,
}: {
  model: string;
  configured: boolean;
  onClose: () => void;
  onReset: () => Promise<void>;
}) {
  const [resetConfirm, setResetConfirm] = useState(false),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="关于 Orbit" onClose={onClose}>
      <div className="modal-body">
        <div className="about-brand">
          <OrbitMark size={48} />
          <h2>Orbit</h2>
          <p>Your work, in motion.</p>
        </div>
        <p>围绕目标组织对话、应用和持续执行的 Agent 工作空间。</p>
        <div className="info-line">
          <span>模型</span>
          <strong>
            {model} · {configured ? "已配置" : "未配置"}
          </strong>
        </div>
        <div className="info-line">
          <span>Agent Harness</span>
          <strong>Pi SDK · 本地 Node 服务</strong>
        </div>
        <div className="info-line">
          <span>数据</span>
          <strong>本地 SQLite · 会话持久化</strong>
        </div>
        <p className="modal-note">
          反馈台与机会看板使用示例数据；对话、工具调用、子任务、对象编辑和事件续接均实际执行。云端电脑尚未接入。
        </p>
        <div className="reset-area">
          {resetConfirm ? (
            <>
              <p>
                恢复初始示例反馈与看板，并清除该演示任务的消息、执行和安排。其他内容会保留。
              </p>
              <button
                className="button secondary small"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onReset();
                  } catch {
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "正在恢复…" : "确认重置演示任务"}
              </button>
              <button
                className="quiet-button"
                onClick={() => setResetConfirm(false)}
              >
                取消
              </button>
            </>
          ) : (
            <button
              className="quiet-button"
              onClick={() => setResetConfirm(true)}
            >
              重置演示任务
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
