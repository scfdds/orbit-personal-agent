import { buildMatterGroups, findMatterGroup } from "../../shared/matter-groups.ts";
import { markLatency } from "./latency.ts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspaceRequest, useOrbit } from "../api.ts";
import type { AssistantState, AssistantOverview, AssistantDispatchResult, AssistantMessageContext, AssistantWorkspaceTab } from "../../shared/assistant.ts";
import type { Conversation } from "../../shared/types.ts";
import type { AssistantDelivery } from "../../shared/delivery.ts";
import type { OrbitDesktopNavigation } from "../../shared/desktop.d.ts";
import { deliveryTab, eligibleDelivery, visibleContext, type DeliveryOwner } from "./delivery-state.ts";
import { newRequestId, prepareOneFlowWorkspace, readDraft, readLocation, readRecentMatters, readView, saveDraft, saveLocation, saveRecentMatters, saveView, visitRecentMatter, visibleRecentMatters, type Draft } from "./workspace-state.ts";
import { buildHomeTimeline } from "./home-timeline.ts";

export function useDesktopWorkspace(quick: boolean) {
  const request = useWorkspaceRequest();
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const orbit = useOrbit();
  const [assistant, setAssistant] = useState<AssistantState | null>(null);
  const [overview, setOverview] = useState<AssistantOverview | null>(null);
  const [selected, setSelected] = useState<string | null>(() => {
    if (quick) return null;
    prepareOneFlowWorkspace();
    return readLocation();
  });
  const mainId = assistant?.conversationId || "orbit-assistant";
  const selectedId = quick ? mainId : selected || mainId;
  const draftKey = quick ? "quick-entry" : selectedId;
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [views, setViews] = useState<Record<string, ReturnType<typeof readView>>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [settings, setSettings] = useState(false);
  const [focus, setFocus] = useState(0);
  const [mainFocus, setMainFocus] = useState(0);
  const [focusMessage, setFocusMessage] = useState<{ conversationId: string; messageId: string; revision: number } | null>(null);
  const focusRevision = useRef(0);
  const [recentIds, setRecentIds] = useState(readRecentMatters);
  const recentRef = useRef(recentIds); recentRef.current = recentIds;
  const [delivery, setDelivery] = useState<AssistantDelivery | null>(null);
  const [voiceContinuation, setVoiceContinuation] = useState(0);
  const [interaction, setInteraction] = useState<{ conversationId: string; runId: string } | null>(null);
  const voiceActive = useRef(false);
  const delivered = useRef(new Set<string>());
  const inFlight = useRef(new Set<string>());
  const location = useRef(selectedId); location.current = selectedId;
  const generation = useRef(0);
  const foreground = useRef<DeliveryOwner | null>(null);
  const latestGlobalRequest = useRef<string | null>(null);
  const restored = useRef(false);
  const retry = useRef(new Map<string, { signature: string; requestId: string }>());
  const mainDraftKey = quick ? "quick-entry" : mainId;
  const mainDraft = drafts[mainDraftKey] || readDraft(mainDraftKey);
  const draft = drafts[draftKey] || readDraft(draftKey);
  const assistantDraftKey = quick ? "quick-entry" : "assistant-entry";
  const assistantDraft = drafts[assistantDraftKey] || readDraft(assistantDraftKey);
  const view = views[selectedId] || readView(selectedId);
  const mainView = views[mainId] || readView(mainId);
  const recentMatterIds = useMemo(() => visibleRecentMatters(recentIds, orbit.state?.conversations || [], mainId), [recentIds, orbit.state?.conversations, mainId]);

  const groupCatalog = useRef(orbit.state?.conversations || []); groupCatalog.current = orbit.state?.conversations || [];
  function recordMatterVisit(previous: string[], id: string) {
    const groups = buildMatterGroups(groupCatalog.current, mainId);
    const target = findMatterGroup(groups, id);
    const existing = target && previous.findIndex(value => target.conversations.some(item => item.id === value));
    if (typeof existing === "number" && existing >= 0) return previous.map((value,index) => index === existing ? id : value).filter((value,index,array) => array.indexOf(value) === index);
    return visitRecentMatter(previous, id);
  }
  function rememberMatter(id: string) {
    if (quick || id === mainId) return;
    const next = recordMatterVisit(recentRef.current, id);
    if (JSON.stringify(next) === JSON.stringify(recentRef.current)) return;
    recentRef.current = next; setRecentIds(next); saveRecentMatters(next);
  }

  function presentTab(tab: AssistantWorkspaceTab) {
    // Routing selects execution context, not a destination for the user's eyes.
    // A global run's own conversation is already projected into the main flow.
    const owner = foreground.current;
    if (tab.kind === "conversation" && owner?.global && owner.conversationId !== mainId && tab.conversationId === owner.conversationId) return;
    if (tab.kind === "conversation") {
      const destination = tab.conversationId;
      location.current = destination; setSelected(destination); saveLocation(destination); rememberMatter(destination);
      setFocusMessage(tab.messageId ? { conversationId: destination, messageId: tab.messageId, revision: ++focusRevision.current } : null);
      void request(`/conversations/${encodeURIComponent(destination)}`, "PATCH", { unread: false }).catch(() => {});
      return;
    }
    // A document or app is a reference alongside the current discussion. Its
    // owning conversation is retained on the tab for data access, not navigation.
    const destination = location.current;
    setViews(previous => {
      const state = { ...(previous[destination] || readView(destination)), resource: tab };
      saveView(destination, state); return { ...previous, [destination]: state };
    });
  }

  function showDelivery(next: AssistantDelivery) {
    if (delivered.current.has(next.id)) return;
    const tab = deliveryTab(next);
    delivered.current.add(next.id);
    if (delivered.current.size > 200) delivered.current.delete(delivered.current.values().next().value!);
    if (quick && tab && window.orbitDesktop) {
      foreground.current = null;
      void window.orbitDesktop.openMain({ view: "home", conversationId: next.conversationId, runId: next.runId,
        ...(next.requestId ? { requestId: next.requestId } : {}), deliveryId: next.id, generation: next.generation,
        ...(voiceActive.current ? { voiceInput: true } : {}) }).catch(() => setError("工作空间暂时无法打开，请点击右上角重试。"));
      return;
    }
    markLatency(next.kind === "preview" ? "preview-received" : "delivery-received", { runId: next.runId, ...(next.requestId ? { requestId: next.requestId } : {}) });
    setDelivery(next);
    if (next.target?.kind === "conversation") presentTab({ id: `conversation:${next.target.conversationId}`, kind: "conversation", conversationId: next.target.conversationId, title: next.target.title,
      ...(next.target.focus?.messageId ? { messageId: next.target.focus.messageId } : {}) });
    else if (tab) presentTab(tab);
  }

  const refreshAssistant = useCallback(async () => {
    const [next, nextOverview] = await Promise.all([request<AssistantState>("/assistant"), request<AssistantOverview>("/assistant/overview")]);
    if (alive.current) { setAssistant(next); setOverview(nextOverview); }
    return next;
  }, []);
  useEffect(() => {
    const failure = () => setError("草稿暂时无法保存到本机；本次窗口内仍会保留，请勿退出应用。");
    const navigationFailure = () => setError("导航偏好暂时无法保存到本机；本次窗口内仍会保留。");
    window.addEventListener("orbit-draft-error", failure);
    window.addEventListener("orbit-navigation-save-error", navigationFailure);
    return () => { window.removeEventListener("orbit-draft-error", failure); window.removeEventListener("orbit-navigation-save-error", navigationFailure); };
  }, []);
  useEffect(() => {
    // Electron's hidden floating windows do not reliably emit document.visibilitychange.
    // Keep background work running, but revoke this surface's right to present it.
    const hidden = () => {
      generation.current++; foreground.current = null; setDelivery(null);
    };
    // Revoke old work at speech onset, not only after ASR has finalized the new request.
    const speechStart = () => { generation.current++; foreground.current = null; };
    const visibility = () => { if (document.hidden) hidden(); };
    window.addEventListener("orbit-surface-hidden", hidden);
    window.addEventListener("orbit-user-speech-start", speechStart);
    document.addEventListener("visibilitychange", visibility);
    return () => { window.removeEventListener("orbit-surface-hidden", hidden); window.removeEventListener("orbit-user-speech-start", speechStart); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  useEffect(() => {
    let disposed = false;
    void Promise.all([request<AssistantState>("/assistant"), request<AssistantOverview>("/assistant/overview")]).then(([next, nextOverview]) => {
      if (disposed) return;
      setAssistant(next); setOverview(nextOverview);
      const current = foreground.current;
      const nextDelivery = eligibleDelivery(next.deliveries || [], current, generation.current, next.deliveryGeneration || 0, next.workspace.revision);
      if (nextDelivery) { showDelivery(nextDelivery); return; }
      if (!quick && current && current.generation === generation.current && next.presentation?.runId === current.runId && next.workspace.revision > current.revision) {
        const tab = next.workspace.tabs.find(t => t.id === next.workspace.activeTabId);
        if (tab) presentTab(tab);
        current.revision = next.workspace.revision;
      }
    }).catch(e => { if (!disposed) setError(e.message); });
    return () => { disposed = true; };
  }, [orbit.state]);

  const closeMatter = useCallback(() => {
    if (!alive.current) return;
    const current = location.current;
    if (current === mainId) {
      // Focusing the persistent assistant is not a navigation or cancellation.
      setMainFocus(f => f + 1); return;
    }
    generation.current++; foreground.current = null;
    setDelivery(null);
    window.dispatchEvent(new Event("orbit-delivery-interrupt"));
    location.current = mainId; setSelected(mainId); saveLocation(mainId);
    setFocusMessage(null);
    setError(""); setMainFocus(f => f + 1);
  }, [mainId]);
  const navigate = useCallback((id: string, messageId?: string) => {
    if (!alive.current) return;
    if (quick && window.orbitDesktop) { void window.orbitDesktop.openMain({ conversationId: id }); return; }
    if (id === mainId) { closeMatter(); return; }
    generation.current++; foreground.current = null; location.current = id;
    setDelivery(null);
    window.dispatchEvent(new Event("orbit-delivery-interrupt"));
    setSelected(id); saveLocation(id); setError(""); setFocus(f => f + 1);
    setFocusMessage(messageId ? { conversationId: id, messageId, revision: ++focusRevision.current } : null);
    rememberMatter(id);
    void request(`/conversations/${encodeURIComponent(id)}`, "PATCH", { unread: false }).catch(() => {});
  }, [quick, mainId, closeMatter]);

  useEffect(() => {
    if (!orbit.state || restored.current) return;
    restored.current = true;
    if (!selected || selected === mainId) return;
    if (!orbit.state.conversations.some(c => c.id === selected && !c.archived && (!c.draft || !!c.projectId || !!c.matterId))) navigate(mainId);
  }, [orbit.state, selected, mainId, navigate]);
  useEffect(() => {
    if (quick || !orbit.state) return;
    const clean = visibleRecentMatters(recentRef.current, orbit.state.conversations, mainId);
    // A restored selected matter was explicitly visited before this refresh.
    const currentIsMatter = selectedId !== mainId && orbit.state.conversations.some(item => item.id === selectedId && !item.archived && (!item.draft || !!item.projectId || !!item.matterId));
    const next = currentIsMatter ? recordMatterVisit(clean, selectedId) : clean;
    if (JSON.stringify(next) === JSON.stringify(recentRef.current)) return;
    recentRef.current = next; setRecentIds(next); saveRecentMatters(next);
  }, [quick, orbit.state?.conversations, selectedId, mainId]);
  useEffect(() => {
    if (quick) return;
    let disposed = false;
    const unsubscribe = window.orbitDesktop?.onNavigate((target: OrbitDesktopNavigation) => {
      if (target.view === "settings") { setSettings(true); return; }
      const id = target.conversationId || mainId;
      const displayId = target.view === "home" ? mainId : id;
      navigate(displayId);
      const stamp = generation.current;
      // Show the incoming call and reconnect ASR while workspace data refreshes.
      if (target.voiceInput) setVoiceContinuation(value => value + 1);
      void Promise.all([orbit.refresh(), refreshAssistant()]).then(([, next]) => {
        if (disposed || stamp !== generation.current || displayId !== location.current) return;
        if (target.runId) { latestGlobalRequest.current = target.requestId || target.runId; foreground.current = { runId: target.runId, requestId: target.requestId, conversationId: id, revision: next.workspace.revision, generation: stamp, global: true }; setInteraction({ conversationId: id, runId: target.runId }); }
        const candidate = eligibleDelivery(next.deliveries || [], foreground.current, stamp, next.deliveryGeneration || 0, next.workspace.revision);
        if (candidate && (!target.deliveryId || target.deliveryId === candidate.id || next.deliveries.some(d => d.id === target.deliveryId && d.kind === "preview" && d.runId === candidate.runId && d.generation === candidate.generation)) && (target.generation === undefined || target.generation === candidate.generation)) showDelivery(candidate);
      }).catch(() => setError("暂时无法恢复这次交付，请稍后重试。"));
    });
    return () => { disposed = true; unsubscribe?.(); };
  }, [quick, mainId, navigate, orbit.refresh, refreshAssistant]);

  function changeDraft(next: Draft, key = draftKey) {
    if (!alive.current) return;
    saveDraft(key, next); setDrafts(previous => ({ ...previous, [key]: next }));
  }
  function preserveSpokenDraft(text: string, key: string) {
    if (!alive.current) return;
    setDrafts(previous => {
      const existing = previous[key] || readDraft(key);
      const next = { ...existing, text: [existing.text, text].filter(Boolean).join("\n") };
      saveDraft(key, next); return { ...previous, [key]: next };
    });
  }
  function changeView(patch: Partial<ReturnType<typeof readView>>, id = selectedId) {
    if (!alive.current) return;
    setViews(previous => { const next = { ...(previous[id] || readView(id)), ...patch }; saveView(id, next); return { ...previous, [id]: next }; });
  }
  function reference(context: AssistantMessageContext, text?: string) {
    changeDraft({ text: text ?? draft.text, reference: context }); setFocus(f => f + 1);
  }
  function referenceMain(context: AssistantMessageContext, text?: string) {
    changeDraft({ text: text ?? mainDraft.text, reference: context }, mainDraftKey); setMainFocus(f => f + 1);
  }
  function openResource(tab: AssistantWorkspaceTab | null) {
    if (tab?.kind === "conversation") { navigate(tab.conversationId, tab.messageId); return; }
    generation.current++; foreground.current = null;
    setDelivery(null);
    if (tab) presentTab(tab); else changeView({ resource: null });
  }
  const mainConversation = orbit.state?.conversations.find(c => c.id === mainId);
  const mainMessages = orbit.state?.messages.filter(m => m.conversationId === mainId) || [];
  // Main-origin work may execute in a matter. Recover that association from
  // durable provenance, including after reload; it confers no right to open a pane.
  // A finished in-memory request must not hide a newer exchange from another window.
  const homeTimeline = useMemo(() => {
    if (!orbit.state) return undefined;
    const preferred = interaction && orbit.state.runs.find(item => item.id === interaction.runId && ["running", "queued"].includes(item.status));
    return buildHomeTimeline({ snapshot: orbit.state, mainId, ...(preferred ? { preferredRunId: preferred.id } : {}) });
  }, [orbit.state, mainId, interaction?.runId]);
  const mainRun = homeTimeline?.run;
  const conversation = orbit.state?.conversations.find(c => c.id === selectedId);
  const messages = orbit.state?.messages.filter(m => m.conversationId === selectedId) || [];
  const runs = orbit.state?.runs.filter(r => r.conversationId === selectedId && !r.parentId) || [];
  const run = runs.find(r => r.status === "running" || r.status === "queued") || runs.at(-1);
  const interactionRun = mainRun;
  const interactionMessages = interactionRun ? orbit.state?.messages.filter(m => m.conversationId === interactionRun.conversationId && m.runId === interactionRun.id) || [] : [];
  const mainRouting = !!pending.main;
  const routing = quick || selectedId === mainId ? mainRouting : !!pending[selectedId];
  const assistantBusy = mainRouting || !!interactionRun && ["running", "queued"].includes(interactionRun.status);
  const mainBusy = assistantBusy;
  const busy = quick || selectedId === mainId ? mainBusy : routing || !!run && ["running", "queued"].includes(run.status);

  async function dispatch(source: "main" | "matter" | "assistant", spokenInput?: string) {
    const global = source !== "matter" || quick || selectedId === mainId;
    const sourceDraft = source === "assistant" ? assistantDraft : global ? mainDraft : draft;
    const key = source === "assistant" ? assistantDraftKey : global ? mainDraftKey : draftKey;
    const content = spokenInput ?? sourceDraft.text;
    if (!content.trim()) return;
    const target = global ? mainId : selectedId;
    const scope = global ? "main" : target;
    if (inFlight.current.has(scope)) {
      if (spokenInput) { preserveSpokenDraft(spokenInput, key); setError("上一条需求还在接收，这句话已保留在输入框。"); }
      return;
    }
    if (!orbit.state?.configured) { setSettings(true); return; }
    const captured = { text: content, reference: sourceDraft.reference }, origin = location.current;
    const viewed = quick ? undefined : visibleContext(view.resource) || (selectedId !== mainId ? { conversationId: selectedId } : undefined);
    const stamp = ++generation.current;
    foreground.current = null; setDelivery(null);
    const signature = JSON.stringify({ target, ...captured, viewed });
    const previousRetry = retry.current.get(scope);
    const requestId = previousRetry?.signature === signature ? previousRetry.requestId : newRequestId();
    retry.current.set(scope, { signature, requestId }); inFlight.current.add(scope);
    if (global) latestGlobalRequest.current = requestId;
    setPending(previous => ({ ...previous, [scope]: true })); setError("");
    markLatency("request-submitted", { requestId });
    try {
      const result = await request<AssistantDispatchResult>(global ? "/assistant/messages" : `/conversations/${encodeURIComponent(target)}/messages`, "POST", {
        requestId, content: captured.text.trim(), ...(captured.reference ? { context: captured.reference } : {}), ...(viewed ? { visibleContext: viewed } : {}),
      });
      if (!alive.current) return;
      markLatency("dispatch-accepted", { requestId, runId: result.runId });
      retry.current.delete(scope);
      if (spokenInput === undefined) setDrafts(previous => {
        const existing = previous[key] || readDraft(key);
        if (JSON.stringify(existing) !== JSON.stringify(captured)) return previous;
        const empty = { text: "", reference: null }; saveDraft(key, empty); return { ...previous, [key]: empty };
      });
      // Keep the global run observable even after the user closes/swaps a right
      // pane, while withholding its permission to reopen or steal the foreground.
      if (global && latestGlobalRequest.current === requestId) setInteraction({ conversationId: result.conversationId, runId: result.runId });
      if (generation.current === stamp && location.current === origin) {
        if (quick && result.conversationId !== mainId && window.orbitDesktop) {
          await window.orbitDesktop.openMain({ view: "home", conversationId: result.conversationId, runId: result.runId, requestId,
            ...(voiceActive.current ? { voiceInput: true } : {}) });
        }
        else {
          // A global request stays in the main flow. Its canonical matter is a
          // storage/context choice; only explicit navigation or a visual artifact opens it.
          if (!global && result.conversationId !== mainId) {
            location.current = result.conversationId; setSelected(result.conversationId); saveLocation(result.conversationId);
          }
          foreground.current = { runId: result.runId, requestId, conversationId: result.conversationId, revision: assistant?.workspace.revision || 0, generation: stamp, global };
          // Main stays mounted, so accepting a background response must not
          // steal focus from a right-hand input the user has since chosen.
          if (!global) setFocus(f => f + 1);
        }
      }
      await orbit.refresh();
    } catch (e) {
      if (spokenInput) preserveSpokenDraft(spokenInput, key);
      setError(e instanceof Error ? e.message : "发送未完成，请重试。原消息已保留。");
    }
    finally { inFlight.current.delete(scope); setPending(previous => ({ ...previous, [scope]: false })); }
  }
  function send(spokenInput?: string) { return dispatch(quick || selectedId === mainId ? "main" : "matter", spokenInput); }
  function sendMain(spokenInput?: string) { return dispatch("main", spokenInput); }
  async function stop(global = false) {
    generation.current++; foreground.current = null; setDelivery(null);
    const target = global ? interactionRun && ["running", "queued"].includes(interactionRun.status) ? interactionRun.conversationId : mainId : selectedId;
    try { await request(`/conversations/${encodeURIComponent(target)}/stop`, "POST", {}); await orbit.refresh(); }
    catch (e) { setError((e as Error).message); }
  }

  async function installExamples() {
    setImporting(true); setError("");
    try { await request("/desktop/examples", "POST", {}); await orbit.refresh(); await refreshAssistant(); }
    catch (e) { setError((e as Error).message); throw e; }
    finally { setImporting(false); }
  }
  async function createDiscussion(title: string) {
    const source = selectedId, stamp = ++generation.current;
    foreground.current = null; setDelivery(null);
    const created = await request<Conversation>(`/conversations/${encodeURIComponent(source)}/discussions`, "POST", { title });
    await orbit.refresh();
    if (generation.current === stamp && location.current === source) navigate(created.id);
  }

  async function openApp(appId: string) {
    const target = selectedId, stamp = ++generation.current;
    foreground.current = null; setDelivery(null);
    try {
      const result = await request<Conversation>(`/apps/${encodeURIComponent(appId)}/open`, "POST", selectedId === mainId ? {} : { conversationId: selectedId });
      await orbit.refresh();
      const id = result.id;
      if (stamp !== generation.current || location.current !== target) return;
      const tab: AssistantWorkspaceTab = { id: `app:${id}:${appId}`, conversationId: id, kind: "app", appId, title: orbit.state?.apps.find(a => a.id === appId)?.name || "应用" };
      changeView({ resource: tab }, target);
    } catch (e) { setError((e as Error).message); }
  }
  return { ...orbit, assistant, overview, selectedId, mainId, isHome: selectedId === mainId, recentMatterIds, focusMessage, draft, assistantDraft, view, routing, busy, conversation, messages, run, delivery, interactionRun, interactionMessages, assistantBusy,
    mainConversation, mainMessages, mainRun, mainBusy, mainRouting, mainDraft, mainView, mainFocusKey: `${mainId}:${mainFocus}`,
    voiceScope: quick ? "quick" : "main", voiceContinuation, setVoiceActive: (active: boolean) => { voiceActive.current = active; },
    localError: error, clearError: () => setError(""), importing, settings, setSettings, focusKey: `${selectedId}:${focus}`, navigate, closeMatter,
    changeDraft, changeMainDraft: (next: Draft) => changeDraft(next, mainDraftKey), changeAssistantDraft: (next: Draft) => changeDraft(next, assistantDraftKey),
    changeView, changeMainView: (patch: Partial<ReturnType<typeof readView>>) => changeView(patch, mainId), reference, referenceMain, openResource, createDiscussion,
    send, sendMain, sendGlobal: (text?: string) => dispatch(text === undefined ? "assistant" : "main", text), stop, stopMain: () => stop(true), installExamples, openApp };
}
