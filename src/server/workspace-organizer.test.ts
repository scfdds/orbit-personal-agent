import test from "node:test";
import assert from "node:assert/strict";
import { OrbitStore } from "./store.ts";
import { ProjectService } from "./projects.ts";
import { WorkspaceOrganizer, type OrganizerGenerator, type OrganizerHost } from "./workspace-organizer.ts";

function fixture(generate?: OrganizerGenerator, demoMode = false) {
  const store = new OrbitStore(":memory:");
  const projects = new ProjectService(store, () => {}, async () => ({ items: [] }));
  let busy = false; let active = false; let refreshes = 0;
  const host: OrganizerHost = { store, projects, isMain: id => id === "orbit-assistant", isBusy: () => busy, isActive: () => active, changed() {}, demoMode, async refreshContext() { refreshes++; } };
  const organizer = new WorkspaceOrganizer(host, generate ?? (async () => ({ actions: [] })));
  const conversation = store.createConversation("登录功能");
  const user = store.addMessage(conversation.id, "user", "继续开发个人网站，第一版需要邮箱登录");
  const answer = store.addMessage(conversation.id, "assistant", "邮箱登录属于个人网站的首版范围。");
  const project = projects.create({ name: "个人网站", summary: "开发个人网站" });
  const move = (targetId = project.id, confidence = 0.98) => ({ actions: [{ kind: "move", projectId: targetId, reason: "用户明确在讨论个人网站的登录功能", sourceIds: [user.id, answer.id], confidence }] });
  return { store, projects, organizer, conversation, user, answer, project, move, host, setBusy(value: boolean) { busy = value; }, setActive(value: boolean) { active = value; }, get refreshes() { return refreshes; }, async close() { await organizer.close(); await projects.close(); store.close(); } };
}

test("disabled queue persists, enabling discovers history and automatically organizes without changing messages", async () => {
  const h = fixture();
  try {
    const messages = h.store.list("messages");
    h.organizer.generate = async () => h.move();
    h.organizer.schedule(h.conversation.id);
    assert.equal(h.organizer.state().status, "idle");
    assert.equal(h.organizer.state().pendingCount, 1);
    await h.organizer.processNow();
    assert.equal(h.refreshes, 0);
    h.organizer.configure({ enabled: true });
    await h.organizer.processNow();
    assert.equal(h.store.require("conversations", h.conversation.id).projectId, h.project.id);
    assert.equal(h.organizer.state().actions[0]?.state, "applied");
    assert.equal(h.organizer.state().actions[0]?.automatic, true);
    assert.equal(h.organizer.state().pendingCount, 0);
    assert.equal(h.refreshes, 2, "context is refreshed before decision and after membership changes");
    assert.deepEqual(h.store.list("messages"), messages);
    await h.organizer.processNow();
    assert.equal(h.refreshes, 2, "unchanged input isn't reprocessed");
    h.organizer.configure({ enabled: false });
    h.organizer.undo(h.organizer.state().actions[0]!.id);
    assert.equal(h.store.require("conversations", h.conversation.id).projectId, undefined);
  } finally { await h.close(); }
});

test("manual scan works while automatic mode is off and keep decisions still refresh context", async () => {
  const h = fixture();
  try {
    h.organizer.scan(); await h.organizer.processNow();
    assert.equal(h.refreshes, 1);
    assert.equal(h.organizer.state().settings.enabled, false);
    assert.equal(h.organizer.state().pendingCount, 0);
    assert.deepEqual(h.organizer.state().actions, []);
    assert.ok(h.organizer.state().lastRunAt);
  } finally { await h.close(); }
});

test("manual assignment and title are sticky; false fields never remove earlier protection", async () => {
  const h = fixture();
  try {
    h.organizer.generate = async () => h.move();
    h.organizer.protect(h.conversation.id, { project: true });
    h.organizer.protect(h.conversation.id, { project: false, title: true });
    h.organizer.configure({ enabled: true }); await h.organizer.processNow();
    assert.equal(h.store.require("conversations", h.conversation.id).projectId, undefined);
    assert.equal(h.organizer.state().actions.length, 0);
    h.store.addMessage(h.conversation.id, "user", "继续完善登录功能");
    h.organizer.generate = async () => ({ actions: [{ ...h.move().actions[0], kind: "rename", title: "新标题" }] });
    await h.organizer.processNow();
    assert.equal(h.store.require("conversations", h.conversation.id).title, "登录功能");
    assert.equal(h.refreshes, 2);
  } finally { await h.close(); }
});

test("existing automatic grouping may be corrected; undo preserves IDs and prevents repeated regrouping", async () => {
  const h = fixture();
  try {
    const old = h.projects.create({ name: "软件学习" });
    h.projects.assignConversation(h.conversation.id, old.id);
    h.organizer.generate = async () => h.move();
    h.organizer.configure({ enabled: true }); await h.organizer.processNow();
    const action = h.organizer.state().actions[0]!;
    assert.equal(action.fromLabel, "软件学习");
    h.organizer.undo(action.id);
    assert.equal(h.store.require("conversations", h.conversation.id).projectId, old.id);
    h.store.addMessage(h.conversation.id, "user", "网站再加一个登录按钮");
    await h.organizer.processNow();
    assert.equal(h.store.require("conversations", h.conversation.id).projectId, old.id);
    assert.equal(h.organizer.state().actions.length, 1);
  } finally { await h.close(); }
});

test("source changes during generation invalidate result and keep job for a fresh pass", async () => {
  const h = fixture();
  try {
    h.organizer.generate = async () => { h.store.addMessage(h.conversation.id, "user", "这其实是另一个客户的网站"); return h.move(); };
    h.organizer.configure({ enabled: true }); await h.organizer.processNow();
    assert.equal(h.organizer.state().pendingCount, 1);
    assert.equal(h.organizer.state().actions.length, 0);
    assert.equal(h.store.require("conversations", h.conversation.id).projectId, undefined);
  } finally { await h.close(); }
});

test("hallucinated project or source cannot mutate grouping or lose queued work", async () => {
  const h = fixture();
  try {
    h.organizer.generate = async () => h.move("made-up-project");
    h.organizer.configure({ enabled: true }); await h.organizer.processNow();
    assert.equal(h.organizer.state().status, "error");
    assert.equal(h.organizer.state().pendingCount, 1);
    assert.equal(h.organizer.state().actions.length, 0);
    h.organizer.generate = async () => ({ actions: [{ ...h.move().actions[0], sourceIds: [h.user.id, "fake-source"] }] });
    await h.organizer.processNow();
    assert.equal(h.store.require("conversations", h.conversation.id).projectId, undefined);
    assert.equal(h.organizer.state().pendingCount, 1);
    h.organizer.generate = async () => h.move(undefined, 0.86);
    await h.organizer.processNow();
    assert.equal(h.organizer.state().pendingCount, 0);
    assert.equal(h.organizer.state().actions.length, 0, "uncertain decisions are silently kept, not review tasks");
  } finally { await h.close(); }
});

test("pausing during a model call prevents late writes and restart resumes persisted work", async () => {
  const h = fixture();
  let complete!: (value: unknown) => void; let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  try {
    h.organizer.generate = async () => { entered(); return new Promise(resolve => { complete = resolve; }); };
    h.organizer.configure({ enabled: true }); const running = h.organizer.processNow();
    await started; h.organizer.configure({ enabled: false }); await running;
    complete(h.move());
    assert.equal(h.organizer.state().pendingCount, 1);
    assert.equal(h.store.require("conversations", h.conversation.id).projectId, undefined);
    const restarted = new WorkspaceOrganizer(h.host, async () => h.move());
    try {
      assert.equal(restarted.state().pendingCount, 1);
      restarted.configure({ enabled: true }); await restarted.processNow();
      assert.equal(h.store.require("conversations", h.conversation.id).projectId, h.project.id);
    } finally { await restarted.close(); }
  } finally { await h.close(); }
});

test("workspace suspension prevents collection or mutation in inactive real workspace", async () => {
  const h = fixture();
  try {
    h.organizer.generate = async () => h.move();
    h.organizer.configure({ enabled: true }); h.organizer.setSuspended(true);
    await h.organizer.processNow(); assert.equal(h.refreshes, 0);
    h.organizer.setSuspended(false); h.setBusy(true);
    await h.organizer.processNow(); assert.equal(h.refreshes, 0);
    h.setBusy(false); await h.organizer.processNow();
    assert.equal(h.store.require("conversations", h.conversation.id).projectId, h.project.id);
  } finally { await h.close(); }
});

test("new projects require repeated user evidence and an exact ongoing goal, then reuse existing project", async () => {
  const h = fixture();
  try {
    h.organizer.generate = async () => ({ actions: [{ ...h.move().actions[0], kind: "create_project", projectName: "摄影学习", goalQuote: "继续开发个人网站" }] });
    h.organizer.configure({ enabled: true }); await h.organizer.processNow();
    assert.equal(h.projects.list().length, 1, "single user turn doesn't spawn a project");
    h.store.addMessage(h.conversation.id, "user", "接下来持续完善这个网站，每周推进一些功能");
    await h.organizer.processNow();
    const created = h.projects.list().find(project => project.name === "摄影学习")!;
    assert.ok(created);
    assert.equal(h.store.require("conversations", h.conversation.id).projectId, created.id);
    h.organizer.undo(h.organizer.state().actions[0]!.id);
    assert.equal(h.store.require("conversations", h.conversation.id).projectId, undefined);
    assert.ok(h.store.get("projects", created.id), "undo leaves the created container rather than deleting it");
  } finally { await h.close(); }
});

test("subsequent user edits, project changes and active runs block stale undo", async () => {
  const h = fixture();
  try {
    h.organizer.generate = async () => h.move(); h.organizer.configure({ enabled: true }); await h.organizer.processNow();
    const action = h.organizer.state().actions[0]!;
    h.setActive(true); assert.throws(() => h.organizer.undo(action.id), /回复完成/); h.setActive(false);
    h.store.addMessage(h.conversation.id, "user", "我补充了一些新内容");
    assert.throws(() => h.organizer.undo(action.id), /后续变化/);
    assert.equal(h.store.require("conversations", h.conversation.id).projectId, h.project.id);
  } finally { await h.close(); }
});

test("failed context consolidation preserves job, including after successful move", async () => {
  const h = fixture(); let calls = 0;
  try {
    h.organizer.generate = async () => h.move();
    h.host.refreshContext = async () => { if (++calls === 2) throw new Error("项目记忆暂不可用"); };
    h.organizer.configure({ enabled: true }); await h.organizer.processNow();
    assert.equal(h.organizer.state().status, "error");
    assert.equal(h.organizer.state().pendingCount, 1);
    assert.equal(h.organizer.state().actions[0]?.state, "applied");
    assert.equal(h.store.require("conversations", h.conversation.id).projectId, h.project.id);
    h.organizer.generate = async () => ({ actions: [] }); await h.organizer.processNow();
    assert.equal(h.organizer.state().pendingCount, 0);
    assert.equal(h.organizer.state().actions.length, 1);
  } finally { await h.close(); }
});

test("all-history scan excludes main, archived and showcase records and uses bounded batches", async () => {
  const h = fixture();
  try {
    h.store.createConversation("主对话", { id: "orbit-assistant" });
    h.store.createConversation("旧对话", { archived: true });
    h.store.createConversation("示例", { showcase: { title: "示例", period: "", notice: "模拟数据" } });
    for (let index = 0; index < 8; index++) {
      const conversation = h.store.createConversation(`讨论 ${index}`);
      h.store.addMessage(conversation.id, "user", `问题 ${index}`); h.store.addMessage(conversation.id, "assistant", `回答 ${index}`);
    }
    h.organizer.scan(); await h.organizer.processNow();
    assert.equal(h.organizer.state().pendingCount, 5);
    await h.organizer.processNow(); assert.equal(h.organizer.state().pendingCount, 1);
    await h.organizer.processNow(); assert.equal(h.organizer.state().pendingCount, 0);
    assert.equal(h.refreshes, 9);
  } finally { await h.close(); }
});

test("empty manual scan does not authorize future background processing while disabled", async () => {
  const h = fixture();
  try {
    h.store.updateConversation(h.conversation.id, { archived: true });
    h.organizer.scan(); await h.organizer.processNow();
    const fresh = h.store.createConversation("新需求");
    h.store.addMessage(fresh.id, "user", "介绍一个概念"); h.store.addMessage(fresh.id, "assistant", "概念说明");
    h.organizer.schedule(fresh.id); await h.organizer.processNow();
    assert.equal(h.organizer.state().status, "idle");
    assert.equal(h.organizer.state().pendingCount, 1);
    assert.equal(h.refreshes, 0);
  } finally { await h.close(); }
});

test("explicit multi-discussion matters retain grouping while context is maintained", async () => {
  const h = fixture();
  try {
    h.store.updateConversation(h.conversation.id, { matterId: "matter-shared" });
    h.store.createConversation("另一段讨论", { matterId: "matter-shared" });
    h.organizer.generate = async () => h.move(); h.organizer.configure({ enabled: true }); await h.organizer.processNow();
    assert.equal(h.store.require("conversations", h.conversation.id).projectId, undefined);
    assert.equal(h.organizer.state().actions.length, 0);
    assert.equal(h.refreshes, 1);
  } finally { await h.close(); }
});

test("a failed grouping write rolls back metadata and remains queued rather than reporting success", async () => {
  const h = fixture();
  try {
    h.organizer.generate = async () => h.move();
    const assign = h.projects.assignConversation.bind(h.projects);
    h.projects.assignConversation = (conversationId, projectId) => { assign(conversationId, projectId); throw new Error("测试索引写入失败"); };
    h.organizer.configure({ enabled: true }); await h.organizer.processNow();
    assert.equal(h.store.require("conversations", h.conversation.id).projectId, undefined);
    assert.equal(h.organizer.state().pendingCount, 1);
    assert.equal(h.organizer.state().actions.some(action => action.state === "applied"), false);
    h.projects.assignConversation = assign; await h.organizer.processNow();
    assert.equal(h.store.require("conversations", h.conversation.id).projectId, h.project.id);
    assert.equal(h.organizer.state().pendingCount, 0);
  } finally { await h.close(); }
});

test("an empty periodic pass advances its deadline without repeated history scans or SSE", async () => {
  const h = fixture();
  try {
    h.organizer.configure({ enabled: true, intervalMinutes: 60 });
    await h.organizer.processNow();
    const persisted = h.store.metadata<Record<string, unknown>>("workspace-organizer:v1")!;
    h.store.setMetadata("workspace-organizer:v1", { ...persisted, nextRunAt: 0 });
    let notifications = 0; let reads = 0;
    h.host.changed = () => { notifications++; };
    const originalList = h.store.list.bind(h.store);
    h.store.list = ((...args: Parameters<typeof h.store.list>) => { reads++; return originalList(...args); }) as typeof h.store.list;
    const before = Date.now();
    await h.organizer.processNow(false);
    const after = h.store.metadata<{ nextRunAt: number }>("workspace-organizer:v1")!;
    assert.ok(after.nextRunAt >= before + 60 * 60_000);
    assert.ok(reads > 0, "the due pass checks for changed history once");
    assert.equal(notifications, 0, "only an internal deadline changed");
    reads = 0;
    await h.organizer.processNow(false);
    assert.equal(reads, 0, "the next timer tick does not hash history again");
    assert.equal(h.store.metadata<{ nextRunAt: number }>("workspace-organizer:v1")!.nextRunAt, after.nextRunAt);
    assert.equal(notifications, 0);
  } finally { await h.close(); }
});
