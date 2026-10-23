import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { OrbitStore } from "./store.ts";
import { OrbitRuntime } from "./runtime.ts";
import { createOrbitServer } from "./http.ts";
import { sharedMemoryReader } from "./personal-tools.ts";
import { conversationRounds } from "../shared/discussion.ts";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "orbit-personal-test-"));
  const store = new OrbitStore(":memory:");
  const runtime = new OrbitRuntime(store, [], dir);
  runtime.pump = () => {};
  runtime.initialize({ seed: false });
  runtime.projects.generate = async () => ({ items: [] });
  runtime.memory.schedule = async () => {};
  runtime.discussion.schedule = async () => {};
  return { dir, store, runtime, async close() { await runtime.close(); store.close(); await rm(dir, { recursive: true, force: true }); } };
}

test("project and memory HTTP routes preserve identity, reject stale edits and never expose notifications in snapshot", async () => {
  const h = await fixture();
  const server = createOrbitServer(h.runtime, h.dir, { authToken: "local-test-token" });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address() as { port: number };
  const api = async (path: string, method = "GET", body?: unknown, authenticated = true) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`, { method, headers: { "Content-Type": "application/json", ...(authenticated ? { "X-Orbit-Token": "local-test-token" } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, value: await response.json() as any };
  };
  try {
    assert.equal((await api("/projects", "GET", undefined, false)).status, 401);
    const project = (await api("/projects", "POST", { name: "个人网站", summary: "先完成可访问的作品集" })).value;
    const discussion = (await api(`/projects/${project.id}/conversations`, "POST", { title: "首页设计" })).value;
    assert.equal(discussion.projectId, project.id);
    const source = h.store.addMessage(discussion.id, "user", "第一版不做账户登录");
    const saved = await api(`/projects/${project.id}/memory`, "PATCH", { version: 0, text: "第一版不做账户登录", kind: "decision", sourceIds: [source.id] });
    assert.equal(saved.status, 200);
    assert.equal((await api(`/projects/${project.id}/memory`, "PATCH", { version: 0, text: "旧版覆盖" })).status, 409);
    const renamed = await api(`/projects/${project.id}`, "PATCH", { name: "作品网站" });
    assert.equal(renamed.value.id, project.id);
    assert.equal(h.store.require("conversations", discussion.id).project, "作品网站");
    assert.equal((await api("/memory/global", "PATCH", { version: 0, text: "第一版不做登录", kind: "decision" })).status, 400);
    const document = (await api("/memory/global/document")).value;
    const markdown = "# 交流习惯\n\n先给结论，再用一个例子解释。\n";
    const editedDocument = await api("/memory/global/document", "PATCH", { version: document.version, content: markdown });
    assert.equal(editedDocument.status, 200);
    assert.equal(editedDocument.value.content, markdown);
    assert.equal(await readFile(editedDocument.value.path, "utf8"), markdown);
    assert.equal((await api("/memory/global/document", "PATCH", { version: document.version, content: "stale" })).status, 409);
    const memoryFiles = (await api(`/projects/${project.id}/memory/files`)).value;
    assert.deepEqual(memoryFiles.map((file: any) => file.name), ["MEMORY.md", "INDEX.md", `recaps/${discussion.id}.md`]);
    const index = await api(`/projects/${project.id}/memory/files/INDEX.md`);
    assert.equal(index.value.readonly, true);
    assert.match(index.value.content, /首页设计/);
    assert.equal((await api(`/projects/${project.id}/memory/files/INDEX.md`, "PATCH", { content: "写入" })).status, 405);
    const recapFile = await api(`/projects/${project.id}/memory/files/recaps/${discussion.id}.md`);
    assert.equal(recapFile.status, 200);
    assert.ok(recapFile.value.content.includes(source.id));
    assert.equal((await api(`/projects/${project.id}/memory/files`, "GET", undefined, false)).status, 401);
    assert.equal((await api(`/conversations/${h.runtime.assistant.getState().conversationId}/project`, "PUT", { projectId: project.id })).status, 400);
    h.runtime.wechat.context.import({ messages: [{ id: "private-message", chatId: "private-chat", chatTitle: "PRIVATE_CONTACT_932", sender: "测试联系人", direction: "unknown", text: "PRIVATE_NOTIFICATION_832", timestamp: new Date().toISOString() }] }, "notification");
    const snapshot = (await api("/state")).value;
    assert.equal(snapshot.projects.some((p: any) => p.id === project.id), true);
    assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE_CONTACT_932|PRIVATE_NOTIFICATION_832/);
    const wechat = (await api("/wechat")).value;
    assert.equal(wechat.enabled, false); assert.equal(wechat.messageCount, 1);
    assert.equal((await api(`/wechat/chats/${wechat.chats[0].id}/interpret`, "POST", {})).status, 403);
    const destination = (await api("/projects", "POST", { name: "归档项目" })).value;
    const disposable = (await api(`/projects/${project.id}/conversations`, "POST", { title: "待移动讨论" })).value;
    h.store.addMessage(disposable.id, "user", "LEGACY_MOVE_SOURCE");
    const beforeMove = (await api(`/projects/${project.id}/memory/files/recaps/${disposable.id}.md`)).value;
    assert.equal((await api(`/conversations/${disposable.id}`, "PATCH", { project: destination.name })).status, 200);
    await assert.rejects(readFile(beforeMove.path, "utf8"), /ENOENT/);
    const destinationIndex = join(h.dir, "memory", "projects", destination.id, "INDEX.md");
    assert.match(await readFile(destinationIndex, "utf8"), /LEGACY_MOVE_SOURCE/);
    const beforeDelete = (await api(`/projects/${destination.id}/memory/files/recaps/${disposable.id}.md`)).value;
    assert.equal((await api(`/conversations/${disposable.id}`, "DELETE")).status, 200);
    await assert.rejects(readFile(beforeDelete.path, "utf8"), /ENOENT/);
    assert.doesNotMatch(await readFile(destinationIndex, "utf8"), /LEGACY_MOVE_SOURCE/);
    assert.equal(await readFile(editedDocument.value.path, "utf8"), markdown);
    const moved = await api(`/conversations/${discussion.id}/project`, "PUT", { projectId: null });
    assert.equal(moved.status, 200); assert.equal(moved.value.projectId, undefined);
    assert.equal((await api(`/projects/${project.id}/memory`)).value.items.length, 0);
    await api(`/projects/${project.id}`, "DELETE");
    assert.equal(h.store.require("messages", source.id).content, "第一版不做账户登录");
    assert.equal((await api("/wechat", "DELETE")).value.messageCount, 0);
  } finally { server.close(); server.closeAllConnections(); await h.close(); }
});

test("new discussions inherit only their project memory; editing or moving invalidates an old model session", async () => {
  const h = await fixture();
  try {
    const a = h.runtime.projects.create({ name: "网站开发" });
    const b = h.runtime.projects.create({ name: "金融学习" });
    const original = h.runtime.createConversation("首页"); h.runtime.projects.assignConversation(original.id, a.id);
    const next = h.runtime.createConversation("上线"); h.runtime.projects.assignConversation(next.id, a.id);
    const unrelated = h.runtime.createConversation("现金流"); h.runtime.projects.assignConversation(unrelated.id, b.id);
    const source = h.store.addMessage(original.id, "user", "SITE_ONLY: 首版不做登录");
    h.runtime.projects.updateMemory(a.id, 0, { text: "SITE_ONLY: 首版不做登录", kind: "decision", sourceIds: [source.id] });
    h.runtime.projects.updateMemory(undefined, 0, { text: "GENERAL_ONLY: 喜欢先用例子说明", kind: "preference" });
    assert.match(h.runtime.contextSummary(next.id), /SITE_ONLY|GENERAL_ONLY/);
    assert.match(h.runtime.contextSummary(unrelated.id), /GENERAL_ONLY/);
    assert.doesNotMatch(h.runtime.contextSummary(unrelated.id), /SITE_ONLY/);
    h.store.setMetadata(`session:${next.id}`, join(h.dir, "old-session.jsonl"));
    const before = h.runtime.sessionMemoryState(next.id);
    assert.equal(before.reset, true, "legacy sessions without a scope signature must rebuild once");
    assert.equal(before.sessionFile, undefined);
    h.store.setMetadata(`${before.key}:memory-scope`, before.signature);
    assert.equal(h.runtime.sessionMemoryState(next.id).reset, false);
    const memory = h.runtime.projects.getMemory(a.id);
    h.runtime.projects.updateMemory(a.id, memory.version, { itemId: memory.items[0]!.id, text: "SITE_CORRECTED: 首版改为仅邀请登录" });
    const after = h.runtime.sessionMemoryState(next.id);
    assert.equal(after.reset, true); assert.equal(after.sessionFile, undefined);
    assert.match(h.runtime.contextSummary(next.id), /SITE_CORRECTED/);
    assert.doesNotMatch(h.runtime.contextSummary(next.id), /SITE_ONLY/);
    h.runtime.projects.assignConversation(next.id, b.id);
    assert.doesNotMatch(h.runtime.contextSummary(next.id), /SITE_ONLY|SITE_CORRECTED/);
    assert.equal(h.runtime.sessionMemoryState(next.id).sessionFile, undefined);
  } finally { await h.close(); }
});

test("main assistant can organize a project without dispatching work or navigating", async () => {
  const h = await fixture();
  try {
    const main = h.runtime.assistant.getState().conversationId;
    h.runtime.home.generate = async () => ({ action: "answer" });
    const submitted = await h.runtime.home.submit({ requestId: "organize", content: "建一个个人网站项目，把首页讨论放进去" });
    const run = h.store.require("runs", submitted.runId);
    const active = { run, cancelled: false, pendingSteers: [], children: new Set<AgentSession>(), childSlots: 0, text: "" };
    const tools = h.runtime.hostTools(main, active, () => undefined);
    const call = async (name: string, args: any) => {
      const block = (await tools.find(t => t.name === name)!.execute("test", args, new AbortController().signal, undefined, {} as any)).content[0];
      assert.equal(block?.type, "text");
      if (block?.type !== "text") throw new Error("Expected tool text");
      return JSON.parse(block.text);
    };
    const project = await call("project_create", { name: "个人网站" });
    const discussion = await call("conversation_organize", { projectId: project.id, title: "首页讨论" });
    assert.equal(discussion.projectId, project.id);
    assert.equal(h.store.list("runs").filter(r => r.conversationId === discussion.id).length, 0);
    assert.equal(h.runtime.assistant.currentWorkspace().tabs.length, 0);
    assert.deepEqual(await call("wechat_search", { query: "最近消息" }), []);
    const another = await call("project_create", { name: "另一个项目" });
    await assert.rejects(call("conversation_organize", { conversationId: discussion.id, projectId: another.id, title: "  " }), /标题/);
    assert.equal(h.store.require("conversations", discussion.id).projectId, project.id);
  } finally { await h.close(); }
});

test("text answers finish without an additional speech-generation call", async () => {
  const h = await fixture();
  const previousMode = process.env.ORBIT_SPOKEN_DELIVERY; delete process.env.ORBIT_SPOKEN_DELIVERY;
  try {
    h.runtime.projects.schedule = async () => {};
    h.runtime.home.generate = async () => ({ action: "answer" });
    let speechCalls = 0;
    h.runtime.deliveries.generate = async () => { speechCalls++; throw new Error("text mode must not synthesize a separate introduction"); };
    h.runtime.openSession = (async () => {
      let notify: (event: any) => void = () => {};
      return { session: { sessionManager: { getSessionFile: () => undefined }, subscribe: (fn: typeof notify) => { notify = fn; }, prompt: async () => notify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "可以，先从首页的内容结构开始。" }] } }), dispose() {}, async abort() {} } };
    }) as unknown as OrbitRuntime["openSession"];
    const submitted = await h.runtime.home.submit({ requestId: "text-only", content: "今天从哪里开始" });
    const run = h.store.require("runs", submitted.runId);
    const active = { run, cancelled: false, pendingSteers: [], children: new Set<AgentSession>(), childSlots: 0, text: "" };
    h.runtime.active.set(run.conversationId, active);
    await h.runtime.execute(active, h.store.pending().find(p => p.runId === run.id)!);
    assert.equal(speechCalls, 0);
    assert.equal(h.store.require("runs", run.id).status, "completed");
    assert.equal(h.store.list("messages").filter(m => m.runId === run.id && m.role === "assistant").length, 1);
  } finally { if (previousMode === undefined) delete process.env.ORBIT_SPOKEN_DELIVERY; else process.env.ORBIT_SPOKEN_DELIVERY = previousMode; await h.close(); }
});

test("a project conversation can read its complete Markdown file but not another project's file", async () => {
  const h = await fixture();
  try {
    const a = h.runtime.projects.create({ name: "网站" }), b = h.runtime.projects.create({ name: "私有学习", summary: "OTHER_PROJECT_SECRET" });
    const conversation = h.runtime.createConversation("首页"); h.runtime.projects.assignConversation(conversation.id, a.id);
    const original = h.runtime.projects.readDocument(a.id);
    const content = "背景".repeat(7000) + "\nFULL_DOCUMENT_END";
    h.runtime.projects.saveDocument(a.id, original.version, content);
    assert.equal(h.runtime.projects.context(conversation.id).project?.documentTruncated, true);
    const tool = sharedMemoryReader(h.runtime, () => {}, conversation.id);
    const call = (projectId?: string) => tool.execute("read", { projectId }, new AbortController().signal, undefined, {} as any);
    const block = (await call(a.id)).content[0];
    assert.equal(block?.type, "text");
    if (block?.type === "text") assert.match(block.text, /FULL_DOCUMENT_END/);
    await call();
    await assert.rejects(call(b.id), /当前项目/);
    const index = await tool.execute("index", { file: "INDEX.md" }, new AbortController().signal, undefined, {} as any);
    assert.doesNotMatch(JSON.stringify(index), /OTHER_PROJECT_SECRET/);
    const available = await tool.execute("files", { projectId: a.id, list: true }, new AbortController().signal, undefined, {} as any);
    assert.match(JSON.stringify(available), /INDEX.md/);
    assert.doesNotMatch(JSON.stringify(available), /FULL_DOCUMENT_END|OTHER_PROJECT_SECRET/);
    await assert.rejects(tool.execute("foreign-index", { projectId: b.id, file: "INDEX.md" }, new AbortController().signal, undefined, {} as any), /当前项目/);
    const mainReader = sharedMemoryReader(h.runtime, () => {});
    const globalIndex = await mainReader.execute("all-projects", { file: "INDEX.md" }, new AbortController().signal, undefined, {} as any);
    assert.match(JSON.stringify(globalIndex), /OTHER_PROJECT_SECRET/);
  } finally { await h.close(); }
});

test("main session invalidates old project tool results after another project's core or recap sources change", async () => {
  const h = await fixture();
  try {
    const a = h.runtime.projects.create({ name: "网站" }), b = h.runtime.projects.create({ name: "旅行" });
    const main = h.runtime.assistant.getState().conversationId;
    const aConversation = h.runtime.createConversation("首页"); h.runtime.projects.assignConversation(aConversation.id, a.id);
    const bConversation = h.runtime.createConversation("酒店"); h.runtime.projects.assignConversation(bConversation.id, b.id);
    const aDoc = h.runtime.projects.readDocument(a.id);
    h.runtime.projects.saveDocument(a.id, aDoc.version, "项目正文".repeat(600) + "OLD_TAIL");
    const before = h.runtime.sessionMemoryState(main);
    h.store.setMetadata(before.key, join(h.dir, "main-session.jsonl"));
    h.store.setMetadata(`${before.key}:memory-scope`, before.signature);
    const unrelatedBefore = h.runtime.sessionMemoryState(bConversation.id).signature;
    const current = h.runtime.projects.readDocument(a.id);
    await writeFile(current.path, "项目正文".repeat(600) + "CORRECTED_TAIL");
    const after = h.runtime.sessionMemoryState(main);
    assert.equal(after.reset, true);
    assert.equal(h.runtime.sessionMemoryState(bConversation.id).signature, unrelatedBefore);
    assert.doesNotMatch(h.runtime.contextSummary(main), /CORRECTED_TAIL|OLD_TAIL/);
    h.store.setMetadata(`${before.key}:memory-scope`, after.signature);
    h.store.addMessage(aConversation.id, "user", "INDEX_SOURCE_CHANGE");
    assert.equal(h.runtime.sessionMemoryState(main).reset, true);
    assert.equal(h.runtime.sessionMemoryState(bConversation.id).signature, unrelatedBefore);
  } finally { await h.close(); }
});

test("project and main sessions survive consecutive normal turns but rebuild after historical edits or deletion", async () => {
  const h = await fixture();
  try {
    const project = h.runtime.projects.create({ name: "作品网站" });
    const current = h.runtime.createConversation("首页"); h.runtime.projects.assignConversation(current.id, project.id);
    const other = h.runtime.createConversation("上线"); h.runtime.projects.assignConversation(other.id, project.id);
    h.store.put("conversations", { ...h.store.require("conversations", current.id), updatedAt: "2026-01-01T00:00:00Z" });
    h.store.put("conversations", { ...h.store.require("conversations", other.id), updatedAt: "2026-01-02T00:00:00Z" });
    await h.runtime.projects.schedule(current.id);
    const main = h.runtime.assistant.getState().conversationId;
    for (const conversationId of [current.id, main]) {
      const original = h.store.addMessage(conversationId, "user", "先看看首页");
      h.store.addMessage(conversationId, "assistant", "首页可以先展示作品。");
      await h.runtime.projects.schedule(conversationId);
      const before = h.runtime.sessionMemoryState(conversationId);
      const sessionFile = join(h.dir, `${conversationId}-session.jsonl`);
      h.store.setMetadata(before.key, sessionFile);
      h.store.setMetadata(`${before.key}:memory-scope`, before.signature);

      for (let turn = 1; turn <= 2; turn++) {
        h.store.addMessage(conversationId, "user", `继续讨论第 ${turn} 轮`);
        assert.equal(h.runtime.sessionMemoryState(conversationId).reset, false, "new user input belongs to the existing session");
        h.store.addMessage(conversationId, "assistant", `可以，接着看第 ${turn} 个部分。`);
        h.store.put("conversations", { ...h.store.require("conversations", conversationId), updatedAt: `2026-01-0${turn + 2}T00:00:00Z` });
        const rounds = conversationRounds(conversationId, h.store.list("messages"));
        h.store.put("memories", { id: conversationId, conversationId, version: turn, status: "ready", summary: "后台轮次摘要", items: [], updatedAt: new Date().toISOString(),
          discussion: { version: turn, status: "ready", turns: rounds.map(round => ({ id: round.id, sourceKey: round.sourceKey, question: "首页讨论", answer: "继续完善作品内容" })) } });
        // Fake generator consumes evidence but does not invent shared facts.
        await h.runtime.projects.schedule(conversationId);
        const after = h.runtime.sessionMemoryState(conversationId);
        assert.equal(after.signature, before.signature, "append, recency and automatic recap changes must preserve the shared scope signature");
        assert.equal(after.reset, false);
        assert.equal(after.sessionFile, sessionFile);
      }

      h.store.put("messages", { ...original, content: "先看联系页面" });
      const edited = h.runtime.sessionMemoryState(conversationId);
      assert.equal(edited.reset, true, "editing canonical history must revoke the cached session");
      h.store.setMetadata(`${before.key}:memory-scope`, edited.signature);
      h.store.db.prepare("DELETE FROM messages WHERE id=?").run(original.id);
      assert.equal(h.runtime.sessionMemoryState(conversationId).reset, true, "deleting canonical history must revoke the cached session");
    }
  } finally { await h.close(); }
});
