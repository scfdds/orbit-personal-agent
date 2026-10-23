import test from "node:test";
import assert from "node:assert/strict";
import { setWorkspaceStorageMode, prepareOneFlowWorkspace, readDraft, readLocation, readRecentMatters, readSidebarCollapsed, readView, saveDraft, saveLocation, saveRecentMatters, saveSidebarCollapsed, saveView, visitRecentMatter, visibleRecentMatters } from "./workspace-state.ts";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

function withStorage(run: (local: Storage, session: Storage) => void) {
  const originals = {
    localStorage: Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
    sessionStorage: Object.getOwnPropertyDescriptor(globalThis, "sessionStorage"),
  };
  const local = new MemoryStorage(), session = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", { value: local, configurable: true });
  Object.defineProperty(globalThis, "sessionStorage", { value: session, configurable: true });
  try { run(local, session); }
  finally {
    for (const key of ["localStorage", "sessionStorage"] as const) {
      const descriptor = originals[key];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

test("draft text and explicit references stay with their own matter and quick entry", () => withStorage(() => {
  const first = { text: "把预算调低一些", reference: { conversationId: "trip", artifactId: "trip-note", quote: "住宿预算" } };
  const second = { text: "这段英文怎么说？", reference: null };
  saveDraft("trip", first);
  saveDraft("english", second);
  saveDraft("quick-entry", { text: "继续准备方案", reference: null });
  saveLocation("english");
  assert.deepEqual(readDraft("trip"), first);
  assert.deepEqual(readDraft("english"), second);
  assert.deepEqual(readDraft("quick-entry"), { text: "继续准备方案", reference: null });
  assert.deepEqual(readDraft("new-matter"), { text: "", reference: null });
  saveDraft("trip", { text: "", reference: null });
  assert.deepEqual(readDraft("english"), second);
  assert.equal(readLocation(), "english");
}));

test("view state is isolated from drafts and from other matters", () => withStorage(() => {
  const view = {
    resource: { id: "artifact:trip-note", kind: "artifact" as const, conversationId: "trip", artifactId: "trip-note", title: "旅行准备" },
    scrollTop: 245, overview: false,
  };
  saveDraft("trip", { text: "尚未发送", reference: null });
  saveView("trip", view);
  assert.deepEqual(readView("trip"), view);
  assert.deepEqual(readView("english"), { resource: null, scrollTop: 0, overview: true });
  assert.deepEqual(readDraft("trip"), { text: "尚未发送", reference: null });
}));

test("invalid JSON and valid JSON with malformed fields both recover safely", () => withStorage((local, session) => {
  for (const value of ["{broken", "null", "[]", '"wrong"', '{"text":42,"reference":{"conversationId":17}}']) {
    local.setItem("orbit.desktop.v1.draft.trip", value);
    assert.deepEqual(readDraft("trip"), { text: "", reference: null });
  }
  for (const value of ["{broken", "null", "[]", '{"resource":{"kind":"artifact"},"scrollTop":-1,"overview":"false"}']) {
    session.setItem("orbit.desktop.v1.view.trip", value);
    assert.deepEqual(readView("trip"), { resource: null, scrollTop: 0, overview: true });
  }
  // One damaged field must not discard a user's still-valid draft or reading position.
  local.setItem("orbit.desktop.v1.draft.trip", JSON.stringify({ text: "保留这段草稿", reference: { quote: 123 } }));
  assert.deepEqual(readDraft("trip"), { text: "保留这段草稿", reference: null });
  session.setItem("orbit.desktop.v1.view.trip", JSON.stringify({ resource: { id: "app:x", kind: "app", conversationId: "trip", title: "缺少应用 ID" }, scrollTop: 20, overview: false }));
  assert.deepEqual(readView("trip"), { resource: null, scrollTop: 20, overview: false });
}));

test("blocked storage never prevents typing or navigation", () => withStorage(() => {
  for (const key of ["localStorage", "sessionStorage"] as const)
    Object.defineProperty(globalThis, key, { get() { throw new Error("Storage is unavailable"); }, configurable: true });
  assert.doesNotThrow(() => saveDraft("trip", { text: "内存中仍可保留", reference: null }));
  assert.doesNotThrow(() => saveView("trip", { resource: null, scrollTop: 10, overview: false }));
  assert.doesNotThrow(() => saveLocation("trip"));
  assert.deepEqual(readDraft("trip"), { text: "", reference: null });
  assert.deepEqual(readView("trip"), { resource: null, scrollTop: 0, overview: true });
  assert.equal(readLocation(), null);
}));

test("one-flow migration retires automatic destinations once and preserves drafts and manual navigation", () => withStorage((_local, session) => {
  const draft = { text: "这段还没发", reference: { artifactId: "note" } };
  const resource = { id: "artifact:note", kind: "artifact" as const, conversationId: "learning", artifactId: "note", title: "学习笔记" };
  saveDraft("learning", draft);
  saveLocation("learning");
  session.setItem("orbit.desktop.v1.view.broken", "{bad");
  saveView("learning", { resource, scrollTop: 123, overview: false });
  prepareOneFlowWorkspace();
  assert.equal(readLocation(), null);
  assert.deepEqual(readView("learning"), { resource: null, scrollTop: 123, overview: false });
  assert.deepEqual(readDraft("learning"), draft);
  saveLocation("learning");
  const manualView = { resource, scrollTop: 432, overview: false, scrollLayout: "continuous-v2" as const };
  saveView("learning", manualView);
  prepareOneFlowWorkspace();
  assert.equal(readLocation(), "learning");
  assert.deepEqual(readView("learning"), manualView);
  assert.deepEqual(readDraft("learning"), draft);
}));

test("recent matters follow explicit visits, stay stable on revisit, and cap at seven", () => withStorage(() => {
  assert.deepEqual(readRecentMatters(), []);
  let visits: string[] = [];
  for (let i = 1; i <= 9; i++) visits = visitRecentMatter(visits, `matter-${i}`);
  assert.deepEqual(visits, ["matter-9", "matter-8", "matter-7", "matter-6", "matter-5", "matter-4", "matter-3"]);
  assert.deepEqual(visitRecentMatter(visits, "matter-6"), visits);
  saveRecentMatters(visits);
  assert.deepEqual(readRecentMatters(), visits);
  // New background conversations do not participate without an explicit visit.
  const conversations = ["new-background", "matter-3", "matter-9", "matter-6"].map(id => ({ id, archived: false }));
  assert.deepEqual(visibleRecentMatters(visits, conversations, "main"), ["matter-9", "matter-6", "matter-3"]);
  assert.deepEqual(visibleRecentMatters(["main", "archived", "draft", "missing", "matter-3"], [
    ...conversations, { id: "main", archived: false }, { id: "archived", archived: true }, { id: "draft", archived: false, draft: true },
  ], "main"), ["matter-3"]);
}));

test("sidebar defaults collapsed and saves a deliberate expanded choice independently of navigation", () => withStorage(() => {
  assert.equal(readSidebarCollapsed(), true);
  saveSidebarCollapsed(false);
  saveLocation("learning");
  saveRecentMatters(["learning"]);
  assert.equal(readSidebarCollapsed(), false);
  saveLocation("main");
  assert.equal(readSidebarCollapsed(), false);
  saveSidebarCollapsed(true);
  assert.equal(readSidebarCollapsed(), true);
}));

test("opening another matter's resource leaves independent view, draft and position storage intact", () => withStorage(() => {
  saveLocation("main");
  saveDraft("main", { text: "还没发的主对话", reference: null });
  saveDraft("learning", { text: "事项草稿", reference: null });
  saveView("main", { scrollTop: 700, overview: false, resource: { id: "artifact:note", kind: "artifact", conversationId: "learning", artifactId: "note", title: "学习笔记" } });
  saveView("learning", { scrollTop: 400, overview: true, resource: null });
  saveLocation("learning");
  assert.equal(readView("learning").scrollTop, 400);
  saveLocation("main");
  assert.equal(readLocation(), "main");
  assert.equal(readView("main").resource?.conversationId, "learning");
  assert.equal(readView("main").scrollTop, 700);
  assert.equal(readDraft("main").text, "还没发的主对话");
  assert.equal(readDraft("learning").text, "事项草稿");
}));

test("demo drafts, navigation, references and sidebar preferences never mix with real workspace", () => withStorage(() => {
  setWorkspaceStorageMode(false);
  const realDraft = { text: "真实未发送草稿", reference: { conversationId: "real-discussion", quote: "真实引用" } };
  saveDraft("orbit-assistant", realDraft);
  saveLocation("real-discussion"); saveRecentMatters(["real-discussion"]); saveSidebarCollapsed(true);
  saveView("orbit-assistant", { resource: { id: "artifact:real", kind: "artifact", artifactId: "real", conversationId: "real-discussion", title: "真实资料" }, scrollTop: 125, overview: false });
  try {
    setWorkspaceStorageMode(true);
    assert.deepEqual(readDraft("orbit-assistant"), { text: "", reference: null });
    assert.equal(readLocation(), null);
    assert.deepEqual(readRecentMatters(), []);
    assert.equal(readView("orbit-assistant").resource, null);
    assert.equal(readSidebarCollapsed(), false);
    saveDraft("orbit-assistant", { text: "演示草稿", reference: null });
    saveLocation("demo-discussion"); saveRecentMatters(["demo-discussion"]); saveSidebarCollapsed(false);
    setWorkspaceStorageMode(false);
    assert.deepEqual(readDraft("orbit-assistant"), realDraft);
    assert.equal(readLocation(), "real-discussion");
    assert.deepEqual(readRecentMatters(), ["real-discussion"]);
    assert.equal(readView("orbit-assistant").resource?.artifactId, "real");
    assert.equal(readSidebarCollapsed(), true);
    setWorkspaceStorageMode(true);
    assert.equal(readDraft("orbit-assistant").text, "演示草稿");
  } finally { setWorkspaceStorageMode(false); }
}));
