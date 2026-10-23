import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OrbitStore } from "./store.ts";
import { OrbitRuntime } from "./runtime.ts";
import { createOrbitServer } from "./http.ts";

test("organization API keeps settings isolated, protects manual moves and exposes actual state to main bot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "orbit-organizer-api-"));
  const store = new OrbitStore(":memory:");
  const runtime = new OrbitRuntime(store, [], dir);
  runtime.initialize({ seed: false });
  runtime.projects.generate = async () => ({ items: [] });
  runtime.memory.schedule = async () => {};
  runtime.discussion.schedule = async () => {};
  const server = createOrbitServer(runtime, dir, { authToken: "organizer-test" });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address() as { port: number };
  let revision = "";
  const request = async (path: string, method = "GET", body?: unknown, token = "organizer-test", requestRevision = revision) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`, {
      method, headers: { "Content-Type": "application/json", "X-Orbit-Token": token, ...(requestRevision ? { "X-Orbit-Workspace": requestRevision } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() as any };
  };
  try {
    revision = (await request("/workspace-mode")).data.revision;
    assert.equal((await request("/organizer", "GET", undefined, "invalid")).status, 401);
    assert.equal((await request("/organizer")).data.settings.enabled, false);
    assert.equal((await request("/organizer/settings", "PATCH", { intervalMinutes: 3 })).status, 400);
    assert.equal((await request("/organizer/settings", "PATCH", { mode: "review" })).status, 400);
    assert.equal((await request("/organizer/settings", "GET")).status, 405);
    const first = runtime.projects.create({ name: "网站开发" });
    const second = runtime.projects.create({ name: "金融学习" });
    const conversation = runtime.createConversation("网站登录");
    const source = store.addMessage(conversation.id, "user", "这个网站需要支持邮箱登录");
    const answer = store.addMessage(conversation.id, "assistant", "先完成邮箱验证码流程。");
    assert.equal((await request(`/conversations/${conversation.id}/project`, "PUT", { projectId: first.id })).status, 200);
    runtime.organizer.generate = async () => ({ actions: [{ kind: "move", projectId: second.id, sourceIds: [source.id, answer.id], reason: "测试人工保护", confidence: 0.99 }] });
    await request("/organizer/settings", "PATCH", { enabled: true, intervalMinutes: 15 });
    await runtime.organizer.processNow();
    assert.equal(store.require("conversations", conversation.id).projectId, first.id);
    assert.equal(runtime.organizer.state().actions.length, 0);
    const mainContext = runtime.contextSummary(runtime.assistant.getState().conversationId);
    assert.match(mainContext, /"backgroundOrganization":\{"enabled":true/);
    assert.equal((await request("/organizer/actions/missing/undo", "POST", {})).status, 404);
    const realRevision = revision;
    const toDemo = await request("/workspace-mode", "POST", { demo: true, revision });
    assert.equal(toDemo.status, 200); revision = toDemo.data.revision;
    assert.equal((await request("/organizer")).data.settings.enabled, false);
    await request("/organizer/settings", "PATCH", { intervalMinutes: 240 });
    assert.equal((await request("/organizer/settings", "PATCH", { enabled: false }, "organizer-test", realRevision)).status, 409);
    assert.equal(runtime.organizer.state().settings.enabled, true);
    let called = false;
    runtime.organizer.generate = async () => { called = true; return { actions: [] }; };
    store.addMessage(conversation.id, "user", "先保留手工归类");
    runtime.organizer.schedule(conversation.id);
    await runtime.organizer.processNow();
    assert.equal(called, false, "inactive real workspace must not organize while demo is shown");
    const toReal = await request("/workspace-mode", "POST", { demo: false, revision });
    revision = toReal.data.revision;
    const restored = (await request("/organizer")).data;
    assert.deepEqual(restored.settings, { enabled: true, intervalMinutes: 15 });
    await request("/organizer/settings", "PATCH", { enabled: false });
    assert.equal((await request("/organizer")).data.status, "idle", "disabled queue remains available for manual scans");
    const dissolved = runtime.createConversation("旧分组中的讨论");
    runtime.projects.assignConversation(dissolved.id, second.id);
    const u = store.addMessage(dissolved.id, "user", "把这个旧分组解散，先不用归类。");
    const a = store.addMessage(dissolved.id, "assistant", "保留这段讨论。");
    assert.equal((await request(`/projects/${second.id}`, "DELETE")).status, 200);
    runtime.organizer.generate = async () => ({ actions: [{ kind: "move", projectId: first.id, sourceIds: [u.id, a.id], reason: "测试解散后的归属保护", confidence: 0.99 }] });
    await request("/organizer/settings", "PATCH", { enabled: true });
    await runtime.organizer.processNow();
    assert.equal(store.require("conversations", dissolved.id).projectId, undefined, "dissolving a project preserves the user's ungrouping");
  } finally {
    await server.closeWorkspaces(); await runtime.close();
    server.close(); server.closeAllConnections(); store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
