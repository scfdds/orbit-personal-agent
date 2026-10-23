import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { useWorkspaceRequest } from "../api.ts";
import type { Conversation } from "../../shared/types.ts";
import MatterHeader from "./MatterHeader.tsx";
import OrbitAvatar from "./OrbitAvatar.tsx";
import { discussionRecap, shouldIntroduceDiscussion, markDiscussionIntroduced } from "./discussion-recap.ts";
import type { AssistantWorkspaceTab } from "../../shared/assistant.ts";
import type { AssistantDelivery } from "../../shared/delivery.ts";
import type { useDesktopWorkspace } from "./useDesktopWorkspace.ts";
import type { VoiceController } from "./useVoice.ts";
import { referenceTitle } from "./workspace-state.ts";
import Composer from "./Composer.tsx";
import Transcript from "./Transcript.tsx";
import "./matter-workspace.css";

type Props = {
  workspace: ReturnType<typeof useDesktopWorkspace>;
  textOnly?: boolean;
  onProject(id: string): void;
  voice: VoiceController;
  delivery: AssistantDelivery | null;
  onReady: (id: string, matched: boolean) => void;
  onHome: () => void;
  onOverview: () => void;
  overviewOpen: boolean;
  onSource: (conversationId: string, messageId: string) => void;
  call?: ReactNode;
  notice?: ReactNode;
};

/** The active discussion occupies the center. Documents are independent right-hand resources. */
export default function MatterWorkspace({ workspace, textOnly = false, onProject, voice, delivery, onReady, onHome, onOverview, overviewOpen, onSource, call, notice }: Props) {
  const request = useWorkspaceRequest();
  const { state, selectedId, conversation, messages, run, view, draft, focusMessage } = workspace;
  const project = state?.projects?.find(item => item.id === conversation?.projectId);
  const recap = useMemo(() => state && conversation ? discussionRecap(state, conversation) : { text: "", sourceKey: "" }, [state?.messages, conversation]);
  const [recapOpen, setRecapOpen] = useState(() => !!conversation && shouldIntroduceDiscussion(selectedId, recap.sourceKey));
  useEffect(() => { if (conversation) markDiscussionIntroduced(selectedId, recap.sourceKey); }, [selectedId, recap.sourceKey]);
  const [located, setLocated] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const atBottom = useRef(false);
  const followSend = useRef(false);
  const acknowledged = useRef(new Set<string>());
  const focusedRequests = useRef(new Set<number>());
  const latest = useRef({ selectedId, delivery, onReady, workspace });
  latest.current = { selectedId, delivery, onReady, workspace };
  const stream = workspace.streams[selectedId]?.runId === run?.id ? workspace.streams[selectedId]?.text || "" : "";

  useLayoutEffect(() => {
    const area = scroll.current;
    if (!area) return;
    area.scrollTop = view.scrollTop;
    atBottom.current = area.scrollHeight - area.scrollTop - area.clientHeight < 100;
    followSend.current = false;
  }, [selectedId]);
  useLayoutEffect(() => {
    const area = scroll.current;
    if (!area || (!atBottom.current && !followSend.current)) return;
    area.scrollTop = area.scrollHeight;
    followSend.current = false;
  }, [selectedId, messages.length, stream]);
  useEffect(() => {
    const area = scroll.current, body = content.current;
    if (!area || !body) return;
    const observer = new ResizeObserver(() => { if (atBottom.current) area.scrollTop = area.scrollHeight; });
    observer.observe(body);
    return () => observer.disconnect();
  }, [selectedId]);

  // Attribution opens at the answer clicked. A sidebar visit restores reading position.
  useLayoutEffect(() => {
    if (!focusMessage || focusMessage.conversationId !== selectedId || focusedRequests.current.has(focusMessage.revision)) return;
    const area = scroll.current;
    const node = area && [...area.querySelectorAll<HTMLElement>("[data-message-id]")].find(element => element.dataset.messageId === focusMessage.messageId);
    if (!area || !node) return;
    focusedRequests.current.add(focusMessage.revision);
    if (focusedRequests.current.size > 100) focusedRequests.current.delete(focusedRequests.current.values().next().value!);
    atBottom.current = false;
    area.scrollTop = Math.max(0, area.scrollTop + node.getBoundingClientRect().top - area.getBoundingClientRect().top - 96);
    workspace.changeView({ scrollTop: area.scrollTop }, selectedId);
    setLocated(true); setRecapOpen(true);
  }, [selectedId, focusMessage?.revision, messages.length]);

  useEffect(() => {
    const active = delivery;
    if (!conversation || !active || active.target?.kind !== "conversation" || active.target.conversationId !== selectedId || acknowledged.current.has(active.id)) return;
    let cancelled = false, secondFrame = 0, clearFocus = 0;
    let focused: HTMLElement | undefined;
    const firstFrame = requestAnimationFrame(() => { secondFrame = requestAnimationFrame(() => {
      const current = latest.current, area = scroll.current;
      if (cancelled || !area?.isConnected || !area.clientHeight || current.selectedId !== active.target!.conversationId || current.delivery?.id !== active.id) return;
      const focus = active.target?.focus;
      if (focus?.messageId) focused = [...area.querySelectorAll<HTMLElement>("[data-message-id]")].find(node => node.dataset.messageId === focus.messageId);
      if (!focused && focus?.heading) focused = [...area.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")].find(node => node.textContent?.trim() === focus.heading?.trim());
      if (focus?.messageId && !focused) return;
      if (focused) {
        area.scrollTop = Math.max(0, area.scrollTop + focused.getBoundingClientRect().top - area.getBoundingClientRect().top - 96);
        atBottom.current = false;
        current.workspace.changeView({ scrollTop: area.scrollTop }, selectedId);
        setLocated(true); setRecapOpen(true);
      }
      acknowledged.current.add(active.id);
      current.onReady(active.id, !!focused);
    }); });
    return () => { cancelled = true; cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame); clearTimeout(clearFocus); focused?.classList.remove("dt-delivery-focus"); };
  }, [delivery?.id, selectedId, conversation?.id, messages.length, messages.at(-1)?.content]);

  if (!state || !conversation) return <section className="dt-matter-workspace dt-focused-matter" aria-label="项目对话" data-conversation-id={selectedId}><div className="dt-matter-unavailable"><p>这件事暂时无法打开。</p><button onClick={onHome}>回到主对话</button></div></section>;

  const relatedIds = new Set([conversation.id]);
  const resources: AssistantWorkspaceTab[] = [
    ...state.artifacts.filter(item => relatedIds.has(item.conversationId)).map(item => ({ id: `artifact:${item.id}`, kind: "artifact" as const, conversationId: item.conversationId, artifactId: item.id, title: item.title })),
    ...state.objects.filter(item => relatedIds.has(item.conversationId) && !item.seed).map(item => ({ id: `app:${item.id}`, kind: "app" as const, conversationId: item.conversationId, appId: item.appId, objectId: item.id, title: item.title })),
  ];
  function interruptExplanation() { window.dispatchEvent(new Event("orbit-delivery-interrupt")); voice.stopPlayback(); }
  function openArtifact(id: string) {
    const artifact = state!.artifacts.find(item => item.id === id);
    if (artifact) { interruptExplanation(); workspace.openResource({ id: `artifact:${id}`, kind: "artifact", conversationId: artifact.conversationId, artifactId: id, title: artifact.title }); }
  }
  function send() {
    if (!draft.text.trim() || workspace.routing) return;
    interruptExplanation(); atBottom.current = true; followSend.current = true;
    void workspace.send();
  }
  return <section className="dt-matter-workspace dt-focused-matter" aria-label="项目对话" data-conversation-id={selectedId}>
    <MatterHeader project={project} projects={state.projects || []} conversation={conversation} resources={resources} activeResource={view.resource?.id} busy={workspace.busy} onHome={onHome} onProject={onProject} onRefresh={workspace.refresh} overviewOpen={overviewOpen} onOverview={onOverview} onCreate={async title => {
      if (!project) return;
      const created = await request<Conversation>(`/projects/${encodeURIComponent(project.id)}/conversations`, "POST", { title });
      await workspace.refresh(); workspace.navigate(created.id);
    }} onResource={resource => { interruptExplanation(); workspace.openResource(resource); }}/>
    <div className="dt-discussion-intro-slot">
      {recapOpen && <aside className="dt-discussion-recap" aria-label="Orbit 讨论回顾"><OrbitAvatar size={27}/><p>{located ? "已定位到这段讨论，可以从这里接着看。" : recap.text}</p><button className="dt-intro-overview" onClick={onOverview}>概览</button><button className="dt-icon" aria-label="收起讨论回顾" onClick={() => setRecapOpen(false)}><X size={13}/></button></aside>}
    </div>
    <div className="dt-matter-scroll" ref={scroll} onWheel={() => setRecapOpen(false)} onTouchMove={() => setRecapOpen(false)} onScroll={event => {
      const area = event.currentTarget;
      if (!area.clientHeight) return;
      atBottom.current = area.scrollHeight - area.scrollTop - area.clientHeight < 100;
      workspace.changeView({ scrollTop: area.scrollTop }, selectedId);
    }}><div className="dt-matter-transcript" ref={content}>
      {!messages.length && !stream && !recapOpen && <p className="dt-matter-empty">从这个主题开始聊吧。</p>}
      <Transcript variant="matter" onSource={onSource} data={state} messages={messages} stream={stream} run={run} activities={state.activities.filter(item => item.runId === run?.id)} onOpen={workspace.navigate} onReference={workspace.reference} onArtifact={openArtifact} voice={textOnly ? undefined : voice}/>
    </div></div>
    {call && <div className="dt-inline-call">{call}</div>}
    <div className="dt-matter-composer-dock" onFocusCapture={() => setRecapOpen(false)}><div className="dt-focus-composer-inner">{notice}
      <Composer draft={draft} onChange={workspace.changeDraft} onSend={send} onStop={() => { interruptExplanation(); void workspace.stop(); }} title="当前讨论" referenceTitle={referenceTitle(draft.reference, state)} isHome={false} busy={workspace.busy} routing={workspace.routing} configured={state.configured} onSettings={() => workspace.setSettings(true)} focusKey={workspace.focusKey} inputLabel="事项对话输入" placeholder="继续讨论…" autoFocus={false} voice={textOnly || voice.callActive ? undefined : voice}/>
    </div></div>
  </section>;
}
