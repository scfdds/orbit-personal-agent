import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { OrbitStore } from "./store.ts";
import { OrbitRuntime } from "./runtime.ts";
import { createOrbitServer } from "./http.ts";
import { loadApps } from "../apps/registry.ts";
import type { Conversation } from "../shared/types.ts";

test("opening an app creates an empty scoped conversation without model runs and enables its tools", async () => {
  const store = new OrbitStore(":memory:");
  const runtime = new OrbitRuntime(store, await loadApps(), "/tmp/orbit-app-launch-test");
  runtime.initialize();
  let dispatches = 0;
  runtime.pump = () => { dispatches++; };
  const server = createOrbitServer(runtime);
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert(address && typeof address !== "string");
  const open = (appId: string, data = {}) => fetch(`http://127.0.0.1:${address.port}/api/apps/${appId}/open`, {
    method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify(data),
  });
  try {
    const old = runtime.createConversation("已有讨论");
    const original = structuredClone(store.require("conversations", old.id));
    const response = await open("contracts", {project:"合同资料"});
    assert.equal(response.status, 201);
    const created = await response.json() as Conversation;
    assert.notEqual(created.id, old.id);
    assert.equal(created.project, "合同资料");
    assert.deepEqual(created.panel, {kind:"app",appId:"contracts"});
    assert.deepEqual(store.require("conversations", old.id), original);
    assert.equal(store.list("messages").length, 0);
    assert.equal(store.list("runs").length, 0);
    assert.equal(dispatches, 0);
    assert.equal(runtime.snapshot().conversations.find(c => c.id === created.id)?.draft, true);
    assert(runtime.snapshot().objects.filter(o => o.conversationId === created.id).every(o => o.seed));
    assert(runtime.activeToolNames(created.id, []).includes("contract_read"));
    assert(runtime.contextSummary(created.id).includes('"activePanel":{"kind":"app","appId":"contracts"}'));
    const count = store.list("conversations").length;
    const switched = await open("feedback", {conversationId:created.id});
    assert.equal(switched.status, 200);
    assert.equal((await switched.json() as Conversation).id, created.id);
    assert.equal(store.list("conversations").length, count);
    assert.equal(store.list("messages").length, 0);
    assert.equal(runtime.snapshot().conversations.find(c => c.id === created.id)?.draft, true);
    assert.equal((await open("not-installed")).status, 404);
    assert.equal((await open("contracts", {conversationId:"missing"})).status, 404);
    assert.equal(store.list("conversations").length, count);
    store.updateConversation(created.id, {archived:true});
    assert.equal((await open("contracts", {conversationId:created.id})).status, 400);
  } finally {
    await runtime.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); store.close();
  }
});

test("drafts enter conversation history on the first message or saved app content", async () => {
  const store = new OrbitStore(":memory:");
  const runtime = new OrbitRuntime(store, await loadApps(), "/tmp/orbit-draft-test");
  runtime.initialize();
  const draft = (id: string) => runtime.snapshot().conversations.find(c => c.id === id)?.draft;
  try {
    const chat = runtime.createConversation();
    assert.equal(draft(chat.id), true);
    store.addMessage(chat.id, "user", " ");
    assert.equal(draft(chat.id), true);
    store.addMessage(chat.id, "user", "请帮我审阅合同");
    assert.equal(draft(chat.id), false);

    const gui = runtime.openApp("contracts");
    assert.equal(draft(gui.id), true);
    const object = store.list("objects").find(o => o.conversationId === gui.id && o.appId === "contracts")!;
    const saved = store.saveObject(gui.id, { ...object, expectedVersion: object.version, title: "我的合同" });
    assert.equal(saved.seed, undefined);
    assert.equal(draft(gui.id), false);
    assert.equal(store.list("messages").some(m => m.conversationId === gui.id), false);

    // A newly imported object at version 1 is content too; no update or message is required.
    const imported = runtime.createConversation();
    store.saveObject(imported.id, { appId: "contracts", type: "contract-review", title: "导入合同", data: { text: "合同正文" } });
    assert.equal(draft(imported.id), false);
    const goal = runtime.createConversation();
    store.createWork(goal.id, "跟踪公告", "持续核对公司公告");
    assert.equal(draft(goal.id), false);
    const branch = store.createConversation("分支", { parentId: chat.id, inheritedContext: "已有讨论" });
    assert.equal(draft(branch.id), false);
    runtime.seedObjects(gui.id);
    assert.equal(draft(gui.id), false);
    assert.equal(draft(imported.id), false);
  } finally { await runtime.close(); store.close(); }
});

test("default installation omits legacy feedback apps without deleting historical objects", async () => {
  const store = new OrbitStore(":memory:");
  const all = await loadApps();
  const installed = await loadApps({ installedOnly: true });
  assert(!installed.some(app => ["feedback", "opportunities"].includes(app.manifest.id)));
  const conversation = store.createConversation("旧反馈记录", {panel:{kind:"app",appId:"feedback"}});
  const seed = all.find(app => app.manifest.id === "feedback")!.seed()[0]!;
  const object = store.saveObject(conversation.id, seed);
  store.setMetadata("seeded", true);
  const runtime = new OrbitRuntime(store, installed, "/tmp/orbit-app-launch-test");
  runtime.initialize();
  try {
    assert.equal(store.require("conversations", conversation.id).panel, null);
    assert.deepEqual(store.require("objects", object.id).data, object.data);
    assert.throws(() => runtime.openApp("feedback"));
    assert(!runtime.snapshot().apps.some(app => app.id === "feedback"));
  } finally { await runtime.close(); store.close(); }
});
