import type { AssistantMessageContext, AssistantWorkspaceTab } from "../../shared/assistant.ts";
import type { Conversation } from "../../shared/types.ts";
import type { OrbitDesktopPreferences } from "../../shared/desktop.d.ts";

export interface Draft { text: string; reference: AssistantMessageContext | null }
export interface ViewState { resource: AssistantWorkspaceTab | null; scrollTop: number; overview: boolean; scrollLayout?: "continuous-v2" }
let demoStorage = false;
let prefix = "orbit.desktop.v1";
let demoPreferences: Partial<OrbitDesktopPreferences> = {};
export function setWorkspaceStorageMode(demo: boolean) {
  demoStorage = demo;
  prefix = demo ? "orbit.desktop.demo.v1" : "orbit.desktop.v1";
  if (demo) { nativeDrafts = null; nativePreferences = null; }
}
const sidebarStorageKey = () => demoStorage ? "orbit-demo-sidebar-compact-v1" : "orbit-sidebar-compact-v2";
const emptyDraft: Draft = { text: "", reference: null };
const emptyView: ViewState = { resource: null, scrollTop: 0, overview: true };
let nativeDrafts: Record<string, Draft> | null = null;
let nativePreferences: OrbitDesktopPreferences | null = null;

/** Native storage has a stable location even when the local HTTP port changes. */
export async function hydrateDrafts() {
  const bridge = typeof window !== "undefined" ? window.orbitDesktop : undefined;
  if (!bridge || demoStorage) return;
  const [draftsResult, preferencesResult] = await Promise.allSettled([bridge.readDrafts(), bridge.readPreferences()]);
  if (demoStorage) return;
  if (draftsResult.status === "fulfilled") {
    const saved = draftsResult.value;
    nativeDrafts = Object.fromEntries(Object.entries(saved).map(([id, draft]) => [id, {
      text: typeof draft.text === "string" ? draft.text : "", reference: referenceFromStorage(draft.reference),
    }]));
  } else nativeDrafts = null;
  nativePreferences = preferencesResult.status === "fulfilled" ? preferencesResult.value : null;
}

/** The recent list records navigation, never activity or automatic organization. */
export function normalizeRecentMatters(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && !!id && id.length <= 256))].slice(0, 7) : [];
}
export function visitRecentMatter(previous: string[], id: string): string[] {
  const current = normalizeRecentMatters(previous);
  return !id || current.includes(id) ? current : [id, ...current].slice(0, 7);
}
export function visibleRecentMatters(ids: string[], conversations: Pick<Conversation, "id" | "archived" | "draft" | "matterId">[], mainId: string): string[] {
  const available = new Set(conversations.filter(item => item.id !== mainId && !item.archived && (!item.draft || !!item.matterId)).map(item => item.id));
  return normalizeRecentMatters(ids).filter(id => available.has(id));
}
function saveNavigationPreference(value: Partial<OrbitDesktopPreferences>) {
  if (demoStorage) { demoPreferences = { ...demoPreferences, ...value }; return; }
  if (nativePreferences) nativePreferences = { ...nativePreferences, ...value };
  if (typeof window !== "undefined" && window.orbitDesktop) {
    void window.orbitDesktop.writePreferences(value).catch(() => {
      window.dispatchEvent(new CustomEvent("orbit-navigation-save-error"));
    });
  }
}
export function readSidebarCollapsed(): boolean {
  const preferences = demoStorage ? demoPreferences : nativePreferences;
  if (typeof preferences?.sidebarCollapsed === "boolean") return preferences.sidebarCollapsed;
  try { const saved = localStorage.getItem(sidebarStorageKey()); return saved === null ? !demoStorage : saved !== "false"; } catch { return !demoStorage; }
}
export function saveSidebarCollapsed(value: boolean) {
  saveNavigationPreference({ sidebarCollapsed: value });
  try { localStorage.setItem(sidebarStorageKey(), String(value)); } catch { /* The current window still retains the choice. */ }
}
export function readRecentMatters(): string[] {
  const preferences = demoStorage ? demoPreferences : nativePreferences;
  if (preferences?.recentMatterIds) return normalizeRecentMatters(preferences.recentMatterIds);
  try { return normalizeRecentMatters(JSON.parse(localStorage.getItem(`${prefix}.recent-matters`) || "[]")); } catch { return []; }
}
export function saveRecentMatters(value: string[]) {
  const recentMatterIds = normalizeRecentMatters(value);
  saveNavigationPreference({ recentMatterIds });
  try { localStorage.setItem(`${prefix}.recent-matters`, JSON.stringify(recentMatterIds)); } catch { /* Current navigation remains usable. */ }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function referenceFromStorage(value: unknown): AssistantMessageContext | null {
  const source = record(value);
  if (!source) return null;
  const reference: AssistantMessageContext = {};
  for (const key of ["conversationId", "messageId", "artifactId", "appId", "objectId", "quote"] as const) {
    if (source[key] !== undefined && typeof source[key] !== "string") return null;
    if (typeof source[key] === "string" && source[key]) reference[key] = source[key];
  }
  return Object.keys(reference).length ? reference : null;
}
function resourceFromStorage(value: unknown): AssistantWorkspaceTab | null {
  const source = record(value);
  if (!source || typeof source.id !== "string" || !source.id ||
      typeof source.conversationId !== "string" || !source.conversationId ||
      typeof source.title !== "string" || !["conversation", "artifact", "app"].includes(String(source.kind))) return null;
  const resource: AssistantWorkspaceTab = {
    id: source.id, conversationId: source.conversationId, title: source.title,
    kind: source.kind as AssistantWorkspaceTab["kind"],
  };
  for (const key of ["messageId", "artifactId", "appId", "objectId"] as const) {
    if (source[key] !== undefined && typeof source[key] !== "string") return null;
    if (typeof source[key] === "string" && source[key]) resource[key] = source[key];
  }
  if (resource.kind === "artifact" && !resource.artifactId || resource.kind === "app" && !resource.appId) return null;
  return resource;
}

/** Drafts are scoped to both the data origin and the matter. Window navigation never moves them. */
export function readDraft(id: string): Draft {
  if (!demoStorage && nativeDrafts) return nativeDrafts[id] || { ...emptyDraft };
  try {
    const source = record(JSON.parse(localStorage.getItem(`${prefix}.draft.${id}`) || "{}"));
    return { text: typeof source?.text === "string" ? source.text : "", reference: referenceFromStorage(source?.reference) };
  }
  catch { return { ...emptyDraft }; }
}
export function saveDraft(id: string, value: Draft) {
  if (!demoStorage && nativeDrafts) nativeDrafts[id] = value;
  if (!demoStorage && typeof window !== "undefined" && window.orbitDesktop) {
    void window.orbitDesktop.writeDraft(id, value).catch(() => {
      window.dispatchEvent(new CustomEvent("orbit-draft-error"));
    });
  }
  try { localStorage.setItem(`${prefix}.draft.${id}`, JSON.stringify(value)); } catch { /* The in-memory draft remains available. */ }
}
export function readView(id: string): ViewState {
  try {
    const source = record(JSON.parse(sessionStorage.getItem(`${prefix}.view.${id}`) || "{}"));
    return {
      resource: resourceFromStorage(source?.resource),
      scrollTop: typeof source?.scrollTop === "number" && Number.isFinite(source.scrollTop) && source.scrollTop >= 0 ? source.scrollTop : 0,
      overview: typeof source?.overview === "boolean" ? source.overview : true,
      ...(source?.scrollLayout === "continuous-v2" ? { scrollLayout: "continuous-v2" as const } : {}),
    };
  }
  catch { return { ...emptyView }; }
}
export function saveView(id: string, value: ViewState) { try { sessionStorage.setItem(`${prefix}.view.${id}`, JSON.stringify(value)); } catch { /* Session-only UI state. */ } }
/** Retire destinations saved by the old automatic handoff, without touching drafts or history. */
export function prepareOneFlowWorkspace() {
  try {
    if (sessionStorage.getItem(`${prefix}.layout`) === "oneflow-v2") return;
    sessionStorage.removeItem(`${prefix}.location`);
    const keys = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index));
    for (const key of keys) {
      if (!key?.startsWith(`${prefix}.view.`)) continue;
      try {
        const view = record(JSON.parse(sessionStorage.getItem(key) || "{}"));
        if (view) sessionStorage.setItem(key, JSON.stringify({ ...view, resource: null }));
      } catch { /* One malformed old view must not prevent the remaining views from migrating. */ }
    }
    sessionStorage.setItem(`${prefix}.layout`, "oneflow-v2");
  } catch { /* A fresh surface still defaults to main when restoration is unavailable. */ }
}
export function readLocation(): string | null { try { return sessionStorage.getItem(`${prefix}.location`); } catch { return null; } }
export function saveLocation(id: string) { try { sessionStorage.setItem(`${prefix}.location`, id); } catch { /* Optional restoration. */ } }
export function newRequestId() { return crypto.randomUUID(); }

export function referenceTitle(reference: AssistantMessageContext | null, data: { conversations: { id: string; title: string }[]; artifacts: { id: string; title: string }[]; apps: { id: string; name: string }[]; objects: { id: string; title: string }[] }): string {
  if (!reference) return "";
  return data.artifacts.find(a => a.id === reference.artifactId)?.title
    || data.objects.find(a => a.id === reference.objectId)?.title
    || data.apps.find(a => a.id === reference.appId)?.name
    || data.conversations.find(c => c.id === reference.conversationId)?.title
    || "引用资料";
}

export function plainSummary(text: string, length = 125) {
  return text.replace(/^示例资料[。．]\s*/, "").replace(/^#+\s*/gm, "").replace(/\*\*|`/g, "").replace(/\s+/g, " ").trim().slice(0, length);
}

export function dateLabel(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? `今天 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
    : date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}
