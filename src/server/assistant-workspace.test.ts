import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { OrbitStore, HttpError, now } from "./store.ts";
import { OrbitRuntime } from "./runtime.ts";
import { createOrbitServer } from "./http.ts";
import { loadApps } from "../apps/registry.ts";
import { seedAssistantVrShowcase } from "./showcases/assistant-vr.ts";
import type { AssistantContextSnapshot, AssistantMessageContext, AssistantState } from "../shared/assistant.ts";
import type { AppObject } from "../shared/types.ts";
import type { AgentSession, ExtensionContext } from "@earendil-works/pi-coding-agent";

async function harness() {
  const dir = await mkdtemp(join(tmpdir(), "orbit-assistant-test-"));
  const store = new OrbitStore(":memory:");
  const runtime = new OrbitRuntime(store, await loadApps(), dir);
  let dispatches = 0;
  // Replace dispatch before initialization, including recovery of queued work.
  runtime.pump = () => { dispatches++; };
  runtime.home.generate = async () => ({ action: "answer", reason: "仅回顾资料" });
  runtime.initialize();
  const server = createOrbitServer(runtime);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const request = (path: string, value?: unknown) => fetch(
    `http://127.0.0.1:${address.port}/api/assistant${path}`,
    {
      method: value === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      ...(value === undefined ? {} : { body: JSON.stringify(path === "/messages" ? { requestId: randomUUID(), ...(value as object) } : value) }),
    },
  );
  const state = async () => {
    const response = await request("");
    assert.equal(response.status, 200);
    return await response.json() as AssistantState;
  };
  return {
    store, runtime, request, state,
    dispatches: () => dispatches,
    async close() {
      await runtime.close();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      store.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function toolCaller(runtime: OrbitRuntime, conversationId: string, runId: string) {
  const active = {
    run: { id: runId, conversationId, parentId: null, title: "主助手请求", status: "running" as const, startedAt: now(), summary: "" },
    cancelled: false, pendingSteers: [], children: new Set<AgentSession>(), childSlots: 0, text: "",
  };
  const tools = runtime.hostTools(conversationId, active, () => undefined);
  return (name: string, args: Record<string, unknown>) => {
    const tool = tools.find(item => item.name === name);
    assert.ok(tool, `${name} must be available to the main assistant`);
    return tool.execute(name, args, undefined, undefined, {} as ExtensionContext);
  };
}

test("the assistant retains its conversation, session metadata and workspace after restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "orbit-assistant-persist-"));
  const path = join(dir, "orbit.sqlite");
  const apps = await loadApps();
  let store = new OrbitStore(path);
  let runtime = new OrbitRuntime(store, apps, dir);
  runtime.pump = () => {};
  runtime.initialize();
  try {
    const first = runtime.assistant.getState();
    const count = store.list("conversations").length;
    assert.ok(store.get("conversations", first.conversationId));
    assert.deepEqual(runtime.assistant.getState(), first);
    assert.equal(store.list("conversations").length, count);
    const source = runtime.createConversation("持续保留的资料");
    const message = store.addMessage(first.conversationId, "user", "保留主对话历史");
    const sessionFile = join(dir, "sessions", "test-session.jsonl");
    store.setMetadata(`session:${first.conversationId}`, sessionFile);
    runtime.assistant.workspace({ action: "open", conversationId: source.id });
    const saved = runtime.assistant.getState();
    await runtime.close();
    store.close();

    store = new OrbitStore(path);
    runtime = new OrbitRuntime(store, apps, dir);
    runtime.pump = () => {};
    runtime.initialize();
    assert.deepEqual(runtime.assistant.getState(), saved);
    assert.equal(store.metadata(`session:${first.conversationId}`), sessionFile);
    assert.deepEqual(store.require("messages", message.id), message);
    assert.equal(store.list("conversations").length, count + 1);
    assert.equal(store.list("runs").length, 0);
  } finally {
    await runtime.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("workspace navigation is idempotent and never submits a conversation or model request", async () => {
  const h = await harness();
  try {
    const initial = await h.state();
    const first = h.runtime.createConversation("第一份资料");
    const second = h.runtime.createConversation("第二份资料");
    const firstMessage = h.store.addMessage(first.id, "assistant", "资料已有内容");
    const contentBefore = {
      messages: h.store.list("messages"),
      runs: h.store.list("runs"),
      pending: h.store.pending(),
      artifacts: h.store.list("artifacts"),
      objects: h.store.list("objects"),
    };
    const open = { action: "open", conversationId: first.id };
    assert.equal((await h.request("/workspace", open)).status, 200);
    const opened = await h.state();
    assert.equal(opened.conversationId, initial.conversationId);
    assert.equal(opened.workspace.tabs.length, 1);
    const firstTab = opened.workspace.tabs[0]!;
    assert.equal(firstTab.kind, "conversation");
    assert.equal(firstTab.conversationId, first.id);
    assert.equal(firstTab.title, first.title);
    assert.equal(opened.workspace.activeTabId, firstTab.id);
    assert.ok(opened.workspace.revision > initial.workspace.revision);
    assert.equal((await h.request("/workspace", open)).status, 200);
    assert.deepEqual((await h.state()).workspace, opened.workspace);

    assert.equal((await h.request("/workspace", { action: "open", conversationId: second.id })).status, 200);
    const withSecond = (await h.state()).workspace;
    assert.equal(withSecond.tabs.length, 2);
    const secondTab = withSecond.tabs.find(tab => tab.conversationId === second.id)!;
    assert.equal(withSecond.activeTabId, secondTab.id);
    assert.equal((await h.request("/workspace", { action: "activate", tabId: firstTab.id })).status, 200);
    const activated = (await h.state()).workspace;
    assert.equal(activated.activeTabId, firstTab.id);
    assert.equal((await h.request("/workspace", { action: "activate", tabId: firstTab.id })).status, 200);
    assert.deepEqual((await h.state()).workspace, activated);

    assert.equal((await h.request("/workspace", { action: "close", tabId: firstTab.id })).status, 200);
    const closed = (await h.state()).workspace;
    assert.deepEqual(closed.tabs.map(tab => tab.id), [secondTab.id]);
    assert.equal(closed.activeTabId, secondTab.id);
    assert.equal((await h.request("/workspace", { action: "close", tabId: firstTab.id })).status, 200);
    assert.deepEqual((await h.state()).workspace, closed);
    assert.equal((await h.request("/workspace", { action: "clear" })).status, 200);
    const cleared = (await h.state()).workspace;
    assert.deepEqual(cleared.tabs, []);
    assert.equal(cleared.activeTabId, null);
    assert.equal((await h.request("/workspace", { action: "clear" })).status, 200);
    assert.deepEqual((await h.state()).workspace, cleared);
    assert.equal((await h.state()).conversationId, initial.conversationId);
    assert.deepEqual(h.store.require("messages", firstMessage.id), firstMessage);
    assert.deepEqual({
      messages: h.store.list("messages"),
      runs: h.store.list("runs"),
      pending: h.store.pending(),
      artifacts: h.store.list("artifacts"),
      objects: h.store.list("objects"),
    }, contentBefore);
    assert.equal(h.dispatches(), 0);
  } finally { await h.close(); }
});

test("invalid workspace references fail without changing the workspace or dispatching work", async () => {
  const h = await harness();
  try {
    const source = h.runtime.createConversation("有效资料");
    await h.request("/workspace", { action: "open", conversationId: source.id });
    const original = await h.state();
    const invalid: Array<[unknown, number]> = [
      [{ action: "open", conversationId: "missing" }, 404],
      [{ action: "open" }, 400],
      [{ action: "open", kind: "unknown", conversationId: source.id }, 400],
      [{ action: "activate", tabId: "missing-tab" }, 404],
      [{ action: "unknown" }, 400],
    ];
    for (const [input, status] of invalid) {
      assert.equal((await h.request("/workspace", input)).status, status, JSON.stringify(input));
      assert.deepEqual(await h.state(), original);
    }
    assert.equal(h.store.list("messages").length, 0);
    assert.equal(h.store.list("runs").length, 0);
    assert.equal(h.dispatches(), 0);
  } finally { await h.close(); }
});

test("opening a source message focuses its conversation and validates message ownership", async () => {
  const h = await harness();
  try {
    const owner = h.runtime.createConversation("原文所在对话");
    const other = h.runtime.createConversation("无关对话");
    const message = h.store.addMessage(owner.id, "assistant", "需要定位的原文");
    assert.equal((await h.request("/workspace", {
      action: "open", conversationId: owner.id, messageId: message.id,
    })).status, 200);
    const opened = await h.state();
    assert.equal(opened.workspace.tabs.length, 1);
    assert.equal(opened.workspace.tabs[0]?.messageId, message.id);
    assert.equal(opened.workspace.tabs[0]?.conversationId, owner.id);
    assert.equal((await h.request("/workspace", {
      action: "open", conversationId: other.id, messageId: message.id,
    })).status, 403);
    assert.equal((await h.request("/workspace", {
      action: "open", conversationId: owner.id, messageId: "missing",
    })).status, 404);
    assert.deepEqual(await h.state(), opened);
    assert.equal(h.store.list("runs").length, 0);
    assert.equal(h.dispatches(), 0);
  } finally { await h.close(); }
});

test("artifact and app tabs enforce both conversation and app ownership", async () => {
  const h = await harness();
  try {
    const owner = h.runtime.createConversation("资料所属对话");
    const other = h.runtime.createConversation("另一对话");
    const artifact = h.store.put("artifacts", {
      id: "assistant-test-artifact", conversationId: owner.id,
      title: "已保存笔记", content: "只属于原对话", format: "markdown", updatedAt: now(),
    });
    const object = h.store.list("objects").find(item => item.conversationId === owner.id && item.appId === "contracts")!;
    assert.ok(object);
    assert.equal((await h.request("/workspace", {
      action: "open", kind: "artifact", conversationId: owner.id, artifactId: artifact.id,
    })).status, 200);
    assert.equal((await h.request("/workspace", {
      action: "open", kind: "app", conversationId: owner.id, appId: "contracts", objectId: object.id,
    })).status, 200);
    const saved = await h.state();
    assert.equal(saved.workspace.tabs.length, 2);
    assert.equal(saved.workspace.tabs.find(tab => tab.kind === "artifact")?.artifactId, artifact.id);
    assert.equal(saved.workspace.tabs.find(tab => tab.kind === "app")?.objectId, object.id);
    const invalid: Array<[unknown, number]> = [
      [{ action: "open", kind: "artifact", conversationId: other.id, artifactId: artifact.id }, 403],
      [{ action: "open", kind: "artifact", conversationId: owner.id, artifactId: "missing" }, 404],
      [{ action: "open", kind: "app", conversationId: other.id, appId: "contracts", objectId: object.id }, 403],
      [{ action: "open", kind: "app", conversationId: owner.id, appId: "feedback", objectId: object.id }, 403],
      [{ action: "open", kind: "app", conversationId: owner.id, appId: "not-installed" }, 404],
    ];
    for (const [input, status] of invalid) {
      assert.equal((await h.request("/workspace", input)).status, status, JSON.stringify(input));
      assert.deepEqual(await h.state(), saved);
    }
    assert.deepEqual(h.store.require("artifacts", artifact.id), artifact);
    assert.equal(h.store.list("runs").length, 0);
    assert.equal(h.dispatches(), 0);
  } finally { await h.close(); }
});

test("saving a note updates only an artifact owned by the requested conversation", async () => {
  const h = await harness();
  try {
    const owner = h.runtime.createConversation("笔记所属对话");
    const other = h.runtime.createConversation("另一对话");
    const saved = h.runtime.assistant.saveNote({ conversationId: owner.id, title: "调研笔记", content: "初稿" });
    assert.equal(saved.conversationId, owner.id);
    assert.equal(saved.content, "初稿");
    const revised = h.runtime.assistant.saveNote({ conversationId: owner.id, artifactId: saved.id, title: "调研笔记", content: "补充后的正文" });
    assert.equal(revised.id, saved.id);
    assert.equal(h.store.require("artifacts", saved.id).content, "补充后的正文");
    const before = h.store.list("artifacts");
    assert.throws(
      () => h.runtime.assistant.saveNote({ conversationId: other.id, artifactId: saved.id, title: "误写", content: "不能覆盖" }),
      (error: unknown) => error instanceof HttpError && error.status === 403,
    );
    assert.deepEqual(h.store.list("artifacts"), before);
    assert.equal(h.store.list("runs").length, 0);
    assert.equal(h.dispatches(), 0);
  } finally { await h.close(); }
});

test("appending a result records it in the selected conversation without resuming that conversation", async () => {
  const h = await harness();
  try {
    const assistant = await h.state();
    const source = h.runtime.createConversation("成果归档对话");
    h.store.updateConversation(source.id, { status: "paused" });
    const previous = h.store.addMessage(source.id, "assistant", "原有成果");
    const saved = h.runtime.assistant.appendNote({ conversationId: source.id, content: "主助手补充的结论" });
    assert.equal(saved.conversationId, source.id);
    assert.equal(saved.role, "assistant");
    assert.equal(saved.content, "主助手补充的结论");
    assert.deepEqual(h.store.list("messages").filter(message => message.conversationId === source.id), [previous, saved]);
    assert.equal(h.store.require("conversations", source.id).status, "paused");
    assert.equal(h.store.list("messages").filter(message => message.conversationId === assistant.conversationId).length, 0);
    const before = h.store.list("messages");
    assert.throws(
      () => h.runtime.assistant.appendNote({ conversationId: "missing", content: "不能保存" }),
      (error: unknown) => error instanceof HttpError && error.status === 404,
    );
    assert.deepEqual(h.store.list("messages"), before);
    assert.equal(h.store.list("runs").length, 0);
    assert.equal(h.store.pending().length, 0);
    assert.equal(h.dispatches(), 0);
  } finally { await h.close(); }
});

test("message context is captured for one turn without changing the source or leaking into the next", async () => {
  const h = await harness();
  try {
    const assistant = await h.state();
    const source = h.runtime.createConversation("本轮参考材料");
    const selected = h.store.addMessage(source.id, "assistant", "selected-snapshot-original-9173");
    h.store.addMessage(source.id, "assistant", "unselected-private-history-5264");
    const sourceBefore = h.store.list("messages").filter(message => message.conversationId === source.id);
    const first = await h.request("/messages", {
      content: "解释所选段落",
      context: { conversationId: source.id, messageId: selected.id, quote: "explicit-quote-this-turn-8426" },
    });
    assert.equal(first.status, 202);
    const { runId } = await first.json() as { runId: string };
    const pending = h.store.pending().find(item => item.runId === runId)!;
    assert.ok(pending);
    assert.equal(pending.conversationId, assistant.conversationId);
    assert.match(pending.prompt, /解释所选段落/);
    assert.match(pending.prompt, /selected-snapshot-original-9173/);
    assert.match(pending.prompt, /explicit-quote-this-turn-8426/);
    assert.ok(!pending.prompt.includes("unselected-private-history-5264"));
    assert.equal(h.store.list("messages").find(message => message.runId === runId)?.content, "解释所选段落");
    assert.deepEqual(h.store.list("messages").filter(message => message.conversationId === source.id), sourceBefore);
    assert.equal(h.store.metadata(`surface:${assistant.conversationId}`), undefined);

    h.store.put("messages", { ...selected, content: "source-edited-after-send-3918" });
    assert.equal(h.store.pending().find(item => item.runId === runId)?.prompt, pending.prompt);
    await h.request("/workspace", { action: "open", conversationId: source.id });
    const second = await h.request("/messages", { content: "开始一个无引用的问题" });
    assert.equal(second.status, 202);
    const secondRun = await second.json() as { runId: string };
    const secondPending = h.store.pending().find(item => item.runId === secondRun.runId)!;
    assert.equal(secondPending.conversationId, assistant.conversationId);
    for (const text of ["selected-snapshot-original-9173", "explicit-quote-this-turn-8426", "source-edited-after-send-3918", "unselected-private-history-5264"])
      assert.ok(!secondPending.prompt.includes(text), `unexpected context in next turn: ${text}`);
    assert.equal(h.store.list("runs").length, 2);
    assert.equal(h.dispatches(), 2);
  } finally { await h.close(); }
});

test("invalid message context is rejected before creating a message or run", async () => {
  const h = await harness();
  try {
    const source = h.runtime.createConversation("有效对话");
    const other = h.runtime.createConversation("不匹配对话");
    const message = h.store.addMessage(source.id, "assistant", "需要归属校验的消息");
    const before = h.store.list("messages");
    const invalid: Array<[unknown, number]> = [
      [{ content: "缺失对话", context: { conversationId: "missing" } }, 404],
      [{ content: "缺失消息", context: { conversationId: source.id, messageId: "missing" } }, 404],
      [{ content: "不匹配", context: { conversationId: other.id, messageId: message.id } }, 403],
      [{ content: "   " }, 400],
    ];
    for (const [input, status] of invalid) {
      assert.equal((await h.request("/messages", input)).status, status, JSON.stringify(input));
      assert.deepEqual(h.store.list("messages"), before);
      assert.equal(h.store.list("runs").length, 0);
      assert.equal(h.store.pending().length, 0);
    }
    assert.equal(h.dispatches(), 0);
  } finally { await h.close(); }
});

test("assistant tools save without navigating, explicitly open an existing matter, and link it once per turn", async () => {
  const h = await harness();
  try {
    const main = (await h.state()).conversationId;
    const source = h.runtime.createConversation("继续讨论的 VR 方案");
    h.store.updateConversation(source.id, { status: "paused" });
    h.store.addMessage(source.id, "user", "原先讨论的要求");
    const originalAnswer = h.store.addMessage(source.id, "assistant", "原先保存的讨论");
    const originalMessages = h.store.list("messages").filter(message => message.conversationId === source.id);
    const firstRun = "assistant-tool-turn-one";
    const call = toolCaller(h.runtime, main, firstRun);
    const links = (runId: string) => h.store.list("messages").filter(message =>
      message.conversationId === main && message.runId === runId && message.kind === "conversation_link" && message.linkedConversationId === source.id,
    );

    await Promise.all([
      call("open_workspace", { conversationId: source.id, messageId: originalAnswer.id }),
      call("open_workspace", { conversationId: source.id, messageId: originalAnswer.id }),
    ]);
    let workspace = h.runtime.assistant.getState().workspace;
    const conversationTab = workspace.tabs.find(tab => tab.conversationId === source.id && tab.kind === "conversation")!;
    assert.ok(conversationTab);
    assert.equal(conversationTab.messageId, originalAnswer.id);
    assert.equal(workspace.activeTabId, conversationTab.id);
    assert.equal(links(firstRun).length, 1);
    assert.deepEqual(h.store.list("messages").filter(message => message.conversationId === source.id), originalMessages);

    const savedResult = await call("save_workspace_note", {
      conversationId: source.id, title: "VR 助手方案", content: "# 可回访工作现场\n\n先验证桌面交互。",
    });
    const artifact = h.store.list("artifacts").find(item => item.title === "VR 助手方案")!;
    assert.ok(artifact);
    assert.equal(artifact.conversationId, source.id);
    assert.equal(artifact.content, "# 可回访工作现场\n\n先验证桌面交互。");
    assert.ok(JSON.stringify(savedResult).includes(artifact.id));
    workspace = h.runtime.assistant.getState().workspace;
    assert.equal(workspace.tabs.some(tab => tab.artifactId === artifact.id), false, "saving does not open the document");
    assert.equal(workspace.activeTabId, conversationTab.id);
    assert.deepEqual(h.store.list("messages").filter(message => message.conversationId === source.id), originalMessages);

    await call("open_workspace", { conversationId: source.id, kind: "artifact", artifactId: artifact.id });
    const resumedTools = toolCaller(h.runtime, main, firstRun);
    await resumedTools("open_workspace", { conversationId: source.id });
    assert.equal(links(firstRun).length, 1);
    const secondRun = "assistant-tool-turn-two";
    const nextCall = toolCaller(h.runtime, main, secondRun);
    await nextCall("open_workspace", { conversationId: source.id });
    await nextCall("open_workspace", { conversationId: source.id });
    assert.equal(links(firstRun).length, 1);
    assert.equal(links(secondRun).length, 1);

    await call("append_conversation_note", { conversationId: source.id, content: "本轮明确保存：先验证桌面交互。" });
    const messages = h.store.list("messages").filter(message => message.conversationId === source.id);
    assert.deepEqual(messages.slice(0, originalMessages.length), originalMessages);
    assert.equal(messages.length, originalMessages.length + 1);
    assert.equal(messages.at(-1)?.role, "assistant");
    assert.equal(messages.at(-1)?.content, "本轮明确保存：先验证桌面交互。");
    assert.equal(messages.filter(message => message.role === "user").length, 1);
    assert.equal(h.store.require("conversations", source.id).status, "paused");
    assert.equal(h.store.list("runs").length, 0);
    assert.equal(h.store.pending().length, 0);
    assert.equal(h.dispatches(), 0);
  } finally { await h.close(); }
});

test("legacy report tools save without opening, while explicit panel tools display results", async () => {
  const h = await harness();
  try {
    const main = (await h.state()).conversationId;
    const call = toolCaller(h.runtime, main, "assistant-legacy-tools");
    const originalPanel = h.store.require("conversations", main).panel;
    await call("save_report", { title: "主助手兼容报告", content: "已实际保存的报告正文" });
    const report = h.store.list("artifacts").find(item => item.title === "主助手兼容报告")!;
    assert.ok(report);
    assert.equal(report.conversationId, main);
    assert.equal(report.content, "已实际保存的报告正文");
    let workspace = h.runtime.assistant.getState().workspace;
    assert.equal(workspace.tabs.length, 0, "save_report only saves the file");

    h.runtime.assistant.workspace({ action: "clear" });
    await call("open_panel", { kind: "artifact", artifactId: report.id });
    workspace = h.runtime.assistant.getState().workspace;
    assert.equal(workspace.tabs.length, 1);
    assert.equal(workspace.tabs[0]?.artifactId, report.id);
    await call("open_panel", { kind: "app", appId: "contracts" });
    workspace = h.runtime.assistant.getState().workspace;
    assert.equal(workspace.tabs.length, 2);
    const appTab = workspace.tabs.find(tab => tab.id === workspace.activeTabId)!;
    assert.equal(appTab.kind, "app");
    assert.equal(appTab.conversationId, main);
    assert.equal(appTab.appId, "contracts");
    assert.deepEqual(h.store.require("conversations", main).panel, originalPanel);

    const other = h.runtime.createConversation("其他事项");
    const foreignReport = h.store.put("artifacts", { id: "legacy-foreign-report", conversationId: other.id, title: "其他事项成果", content: "原内容", format: "markdown", updatedAt: now() });
    const beforeInvalid = h.runtime.assistant.getState();
    await assert.rejects(call("open_panel", { kind: "artifact", artifactId: foreignReport.id }),
      (error: unknown) => error instanceof HttpError && error.status === 403);
    await assert.rejects(call("save_report", { artifactId: foreignReport.id, title: "错误归属", content: "不能覆盖" }),
      (error: unknown) => error instanceof HttpError && error.status === 403);
    await assert.rejects(call("open_panel", { kind: "activity" }),
      (error: unknown) => error instanceof HttpError && error.status === 400);
    assert.deepEqual(h.runtime.assistant.getState(), beforeInvalid);
    assert.deepEqual(h.store.require("artifacts", foreignReport.id), foreignReport);
    assert.equal(h.store.list("messages").length, 0);
    assert.equal(h.store.list("runs").length, 0);
    assert.equal(h.dispatches(), 0);
  } finally { await h.close(); }
});

test("the VR showcase labels its source, seeds usable memory once and preserves edits and deletions", () => {
  const store = new OrbitStore(":memory:");
  try {
    const real = store.createConversation("已有真实讨论");
    const realMessage = store.addMessage(real.id, "user", "我的原始内容");
    seedAssistantVrShowcase(store);
    const example = store.list("conversations").find(conversation => conversation.id !== real.id)!;
    assert.ok(example);
    assert.match(example.showcase?.notice || "", /示例/);
    assert.match(example.showcase?.notice || "", /并非.*原始聊天记录/);
    const memory = store.require("memories", example.id);
    assert.equal(memory.status, "ready");
    assert.ok(memory.summary.trim());
    assert.ok(memory.items.length > 0);
    for (const item of memory.items) {
      assert.ok(item.sourceIds.length > 0);
      for (const sourceId of item.sourceIds) {
        const source = store.require("messages", sourceId);
        assert.equal(source.conversationId, example.id);
        assert.equal(source.role, "assistant");
      }
    }
    const seeded = { conversations: store.list("conversations"), messages: store.list("messages"), memories: store.list("memories") };
    seedAssistantVrShowcase(store);
    assert.deepEqual({ conversations: store.list("conversations"), messages: store.list("messages"), memories: store.list("memories") }, seeded);

    const edited = store.updateConversation(example.id, { title: "我改写后的 VR 方案", summary: "保留我的新方向" });
    const source = store.require("messages", memory.items[0]!.sourceIds[0]!);
    const editedMessage = store.put("messages", { ...source, content: "用户修订的原文" });
    const editedMemory = store.put("memories", { ...memory, summary: "用户修订的记忆", summaryEdited: true });
    seedAssistantVrShowcase(store);
    assert.deepEqual(store.require("conversations", example.id), edited);
    assert.deepEqual(store.require("messages", source.id), editedMessage);
    assert.deepEqual(store.require("memories", example.id), editedMemory);

    store.deleteConversation(example.id);
    seedAssistantVrShowcase(store);
    assert.equal(store.get("conversations", example.id), undefined);
    assert.equal(store.get("memories", example.id), undefined);
    assert.equal(store.list("messages").some(message => message.conversationId === example.id), false);
    assert.deepEqual(store.require("conversations", real.id), real);
    assert.deepEqual(store.require("messages", realMessage.id), realMessage);
    assert.equal(store.list("runs").length, 0);
    assert.equal(store.list("triggers").length, 0);
    assert.equal(store.pending().length, 0);
  } finally { store.close(); }
});

test("main assistant app tools require an explicit scope for each read and write and open that matter", async () => {
  const h = await harness();
  try {
    const main = (await h.state()).conversationId;
    h.runtime.seedObjects(main);
    const first = h.runtime.createConversation("第一份持仓事项");
    const second = h.runtime.createConversation("第二份持仓事项");
    const prepare = (conversationId: string, title: string) => {
      const context = h.runtime.appContext(conversationId);
      const object = context.getObjects("portfolio")[0]!;
      assert.ok(object);
      return context.saveObject({ ...object, expectedVersion: object.version, title, data: { ...object.data, title } });
    };
    const mainObject = prepare(main, "主对话的持仓对象");
    const firstObject = prepare(first.id, "第一个事项的持仓对象");
    const secondObject = prepare(second.id, "第二个事项的持仓对象");
    const tools = h.runtime.executionAppTools(main, "scoped-app-tool-run", () => {});
    const call = (name: string, args: Record<string, unknown>) => {
      const tool = tools.find(candidate => candidate.name === name);
      assert.ok(tool);
      return tool.execute(name, args, undefined, undefined, {} as ExtensionContext);
    };
    const read = async (conversationId: string) => {
      const result = await call("portfolio_read", { conversationId, input: {} });
      const text = result.content.find(item => item.type === "text");
      assert.ok(text && text.type === "text");
      return (JSON.parse(text.text) as { object: AppObject }).object;
    };
    // Even a read without objectId must resolve inside the explicit target.
    assert.deepEqual(await read(first.id), firstObject);
    assert.deepEqual(await read(main), mainObject);
    await call("portfolio_upsert_observation", {
      conversationId: first.id,
      input: { objectId: firstObject.id, expectedVersion: firstObject.version, userRequest: "为第一份事项记录观察", patch: { title: "仅属于第一份事项的观察" } },
    });
    const savedFirst = h.store.require("objects", firstObject.id);
    assert.equal(savedFirst.version, firstObject.version + 1);
    assert.equal((savedFirst.data.observations as Array<{ title: string }>).at(-1)?.title, "仅属于第一份事项的观察");
    assert.deepEqual(h.store.require("objects", mainObject.id), mainObject);
    assert.deepEqual(h.store.require("objects", secondObject.id), secondObject);
    let workspace = h.runtime.assistant.getState().workspace;
    let opened = workspace.tabs.find(tab => tab.id === workspace.activeTabId)!;
    assert.equal(opened.kind, "app");
    assert.equal(opened.appId, "portfolio");
    assert.equal(opened.conversationId, first.id);
    assert.equal(opened.objectId, firstObject.id);
    assert.equal(h.store.require("conversations", first.id).panel, null);

    const beforeInvalid = { objects: h.store.list("objects"), workspace };
    for (const foreign of [mainObject, secondObject]) {
      await assert.rejects(call("portfolio_read", { conversationId: first.id, input: { objectId: foreign.id } }), /不属于当前对话/);
      await assert.rejects(call("portfolio_upsert_observation", {
        conversationId: first.id,
        input: { objectId: foreign.id, expectedVersion: foreign.version, userRequest: "不能跨事项改写", patch: { title: "越界观察" } },
      }), /不属于当前对话/);
    }
    await assert.rejects(call("portfolio_read", { input: { objectId: firstObject.id } }),
      (error: unknown) => error instanceof HttpError && error.status === 400);
    await assert.rejects(call("portfolio_upsert_observation", {
      input: { objectId: firstObject.id, expectedVersion: savedFirst.version, userRequest: "缺少归属", patch: { title: "不能默认写入" } },
    }), (error: unknown) => error instanceof HttpError && error.status === 400);
    assert.deepEqual({ objects: h.store.list("objects"), workspace: h.runtime.assistant.getState().workspace }, beforeInvalid);

    // Reuse the same tool definitions after another window has become active.
    assert.deepEqual(await read(second.id), secondObject);
    await call("portfolio_upsert_observation", {
      conversationId: second.id,
      input: { objectId: secondObject.id, expectedVersion: secondObject.version, userRequest: "为第二份事项记录观察", patch: { title: "仅属于第二份事项的观察" } },
    });
    const savedSecond = h.store.require("objects", secondObject.id);
    assert.equal(savedSecond.version, secondObject.version + 1);
    assert.equal((savedSecond.data.observations as Array<{ title: string }>).at(-1)?.title, "仅属于第二份事项的观察");
    assert.deepEqual(h.store.require("objects", firstObject.id), savedFirst);
    assert.deepEqual(h.store.require("objects", mainObject.id), mainObject);
    assert.deepEqual(await read(first.id), savedFirst);
    workspace = h.runtime.assistant.getState().workspace;
    opened = workspace.tabs.find(tab => tab.id === workspace.activeTabId)!;
    assert.equal(opened.conversationId, second.id);
    assert.equal(opened.objectId, secondObject.id);
    assert.deepEqual(workspace.tabs.map(tab => tab.objectId), [firstObject.id, secondObject.id]);
    assert.equal(h.store.list("messages").length, 0);
    assert.equal(h.store.list("runs").length, 0);
    assert.equal(h.store.pending().length, 0);
    assert.equal(h.dispatches(), 0);
  } finally { await h.close(); }
});

test("existing conversation app tools retain their original input contract and local panel", async () => {
  const h = await harness();
  try {
    const source = h.runtime.createConversation("原有持仓对话");
    const object = h.runtime.appContext(source.id).getObjects("portfolio")[0]!;
    assert.ok(object);
    const workspace = h.runtime.assistant.getState().workspace;
    const tools = h.runtime.executionAppTools(source.id, "legacy-app-tool-run", () => {});
    const call = (name: string, args: Record<string, unknown>) => {
      const tool = tools.find(candidate => candidate.name === name);
      assert.ok(tool);
      return tool.execute(name, args, undefined, undefined, {} as ExtensionContext);
    };
    const result = await call("portfolio_read", { objectId: object.id });
    const text = result.content.find(item => item.type === "text");
    assert.ok(text && text.type === "text");
    assert.deepEqual((JSON.parse(text.text) as { object: AppObject }).object, object);
    await call("portfolio_upsert_observation", {
      objectId: object.id, expectedVersion: object.version, userRequest: "保留旧对话应用操作", patch: { title: "旧对话中的观察记录" },
    });
    assert.equal(h.store.require("objects", object.id).version, object.version + 1);
    assert.deepEqual(h.store.require("conversations", source.id).panel, { kind: "app", appId: "portfolio", objectId: object.id });
    assert.deepEqual(h.runtime.assistant.getState().workspace, workspace);
    assert.equal(h.dispatches(), 0);
  } finally { await h.close(); }
});

async function submitContextSnapshot(h: Awaited<ReturnType<typeof harness>>, context: AssistantMessageContext) {
  const response = await h.request("/messages", { content: "仅使用这次明确引用的资料", context });
  assert.equal(response.status, 202);
  const { runId } = await response.json() as { runId: string };
  const pending = h.store.pending().find(item => item.runId === runId)!;
  assert.ok(pending);
  const snapshotLine = pending.prompt.split("\n").find(line => line.startsWith('{"conversation":'))!;
  const snapshot = JSON.parse(snapshotLine) as AssistantContextSnapshot;
  return { runId, pending, snapshot };
}

test("precise artifact references include only the selected result and retain the submitted snapshot", async () => {
  const h = await harness();
  try {
    const source = h.runtime.createConversation("同一事项的两份方案");
    const selected = h.store.put("artifacts", {
      id: "precise-artifact-selected", conversationId: source.id, title: "本轮所选方案",
      content: "selected-artifact-body-5317", format: "markdown", updatedAt: now(),
    });
    const unselected = h.store.put("artifacts", {
      id: "precise-artifact-unselected", conversationId: source.id, title: "未选择的另一份方案",
      content: "unselected-artifact-body-8249", format: "markdown", updatedAt: now(),
    });
    const historicalMessage = h.store.addMessage(source.id, "assistant", "unselected-source-history-6523");
    h.runtime.assistant.workspace({ action: "open", kind: "artifact", conversationId: source.id, artifactId: unselected.id });
    const queued = await submitContextSnapshot(h, { conversationId: source.id, artifactId: selected.id });
    assert.deepEqual(queued.snapshot.conversation, { id: source.id, title: source.title });
    assert.deepEqual(queued.snapshot.artifact, { id: selected.id, title: selected.title, content: selected.content });
    assert.equal(queued.snapshot.object, undefined);
    assert.equal(queued.snapshot.message, undefined);
    for (const excluded of [unselected.id, unselected.title, unselected.content, historicalMessage.content])
      assert.ok(!queued.pending.prompt.includes(excluded), `unselected material entered the prompt: ${excluded}`);

    h.runtime.assistant.workspace({ action: "open", kind: "artifact", conversationId: source.id, artifactId: selected.id });
    h.store.put("artifacts", { ...selected, title: "发送后改写的标题", content: "artifact-changed-after-submit-3741", updatedAt: now() });
    h.runtime.assistant.workspace({ action: "clear" });
    assert.equal(h.store.pending().find(item => item.runId === queued.runId)?.prompt, queued.pending.prompt);
    assert.equal(h.store.list("messages").find(message => message.runId === queued.runId)?.content, "仅使用这次明确引用的资料");
    assert.deepEqual(h.store.list("messages").filter(message => message.conversationId === source.id), [historicalMessage]);
    assert.equal(h.dispatches(), 1);
  } finally { await h.close(); }
});

test("precise app references capture the selected object version and never infer an object for app-only context", async () => {
  const h = await harness();
  try {
    const source = h.runtime.createConversation("应用引用事项");
    const seed = h.runtime.appContext(source.id).getObjects("portfolio")[0]!;
    const selected = h.store.saveObject(source.id, {
      ...seed, expectedVersion: seed.version, title: "本轮选择的应用对象",
      data: { ...seed.data, focus: "selected-object-focus-7931", observations: [{ id: "T001", positionId: "", title: "所选对象的观察", detail: "nested-object-detail-8641", evidence: "", dueDate: "", status: "open" }] },
    });
    const unselected = h.store.saveObject(source.id, {
      appId: "portfolio", type: "portfolio-book", title: "同事项的另一应用对象",
      data: { ...seed.data, focus: "unselected-object-focus-5298" },
    });
    const manifest = h.runtime.apps.find(app => app.manifest.id === "portfolio")!.manifest;
    h.runtime.assistant.workspace({ action: "open", kind: "app", conversationId: source.id, appId: "portfolio", objectId: unselected.id });
    const queued = await submitContextSnapshot(h, { conversationId: source.id, appId: "portfolio", objectId: selected.id });
    assert.deepEqual(queued.snapshot.app, { id: manifest.id, name: manifest.name });
    assert.deepEqual(queued.snapshot.object, {
      id: selected.id, title: selected.title, appId: selected.appId, version: selected.version, data: selected.data,
    });
    assert.ok(!queued.pending.prompt.includes(unselected.id));
    assert.ok(!queued.pending.prompt.includes("unselected-object-focus-5298"));
    h.store.saveObject(source.id, {
      ...selected, expectedVersion: selected.version, title: "发送之后更新的对象",
      data: { ...selected.data, focus: "object-changed-after-submit-6923", observations: [] },
    });
    h.runtime.assistant.workspace({ action: "open", kind: "app", conversationId: source.id, appId: "portfolio", objectId: selected.id });
    h.runtime.assistant.workspace({ action: "clear" });
    assert.equal(h.store.pending().find(item => item.runId === queued.runId)?.prompt, queued.pending.prompt);
    assert.equal(queued.snapshot.object?.version, selected.version);
    assert.deepEqual(queued.snapshot.object?.data, selected.data);

    const appOnly = await submitContextSnapshot(h, { conversationId: source.id, appId: "portfolio" });
    assert.deepEqual(appOnly.snapshot, {
      conversation: { id: source.id, title: source.title }, app: { id: manifest.id, name: manifest.name },
    });
    for (const excluded of [selected.id, unselected.id, "selected-object-focus-7931", "object-changed-after-submit-6923", "unselected-object-focus-5298"])
      assert.ok(!appOnly.pending.prompt.includes(excluded), `app-only context implicitly selected object content: ${excluded}`);
    assert.equal(h.store.list("messages").filter(message => message.conversationId === source.id).length, 0);
    assert.equal(h.dispatches(), 2);
  } finally { await h.close(); }
});

test("precise context rejects cross-matter, wrong-app and mixed references before creating a run", async () => {
  const h = await harness();
  try {
    const source = h.runtime.createConversation("引用来源事项");
    const other = h.runtime.createConversation("另一个事项");
    const message = h.store.addMessage(source.id, "assistant", "已有消息");
    const artifact = h.store.put("artifacts", {
      id: "precise-context-owned-artifact", conversationId: source.id, title: "已有方案", content: "原方案内容", format: "markdown", updatedAt: now(),
    });
    const object = h.runtime.appContext(source.id).getObjects("portfolio")[0]!;
    const initial = { messages: h.store.list("messages"), objects: h.store.list("objects"), artifacts: h.store.list("artifacts"), state: await h.state() };
    const invalid: Array<[Record<string, unknown>, number]> = [
      [{ artifactId: artifact.id }, 400],
      [{ appId: "portfolio" }, 400],
      [{ appId: "portfolio", objectId: object.id }, 400],
      [{ conversationId: source.id, objectId: object.id }, 400],
      [{ conversationId: other.id, artifactId: artifact.id }, 403],
      [{ conversationId: other.id, appId: "portfolio", objectId: object.id }, 403],
      [{ conversationId: source.id, appId: "contracts", objectId: object.id }, 403],
      [{ conversationId: source.id, appId: "not-installed" }, 404],
      [{ conversationId: source.id, artifactId: "missing-artifact" }, 404],
      [{ conversationId: source.id, appId: "portfolio", objectId: "missing-object" }, 404],
      [{ conversationId: source.id, artifactId: artifact.id, appId: "portfolio" }, 400],
      [{ conversationId: source.id, artifactId: artifact.id, objectId: object.id }, 400],
      [{ conversationId: source.id, artifactId: artifact.id, messageId: message.id }, 400],
      [{ conversationId: source.id, appId: "portfolio", messageId: message.id }, 400],
      [{ conversationId: source.id, appId: "portfolio", objectId: object.id, messageId: message.id }, 400],
    ];
    for (const [context, status] of invalid) {
      const response = await h.request("/messages", { content: "验证非法引用", context });
      assert.equal(response.status, status, JSON.stringify(context));
      assert.equal(h.store.list("runs").length, 0);
      assert.equal(h.store.pending().length, 0);
      assert.deepEqual({ messages: h.store.list("messages"), objects: h.store.list("objects"), artifacts: h.store.list("artifacts"), state: await h.state() }, initial);
    }
    assert.equal(h.dispatches(), 0);
  } finally { await h.close(); }
});

test("precise context bounds artifact and object snapshots without truncating the saved source", async () => {
  const h = await harness();
  try {
    const source = h.runtime.createConversation("长资料引用事项");
    const artifact = h.store.put("artifacts", {
      id: "precise-context-long-artifact", conversationId: source.id, title: "长产物",
      content: "文".repeat(12000), format: "markdown", updatedAt: now(),
    });
    const exactArtifact = await submitContextSnapshot(h, { conversationId: source.id, artifactId: artifact.id });
    assert.equal(exactArtifact.snapshot.artifact?.content, artifact.content);
    assert.equal(exactArtifact.snapshot.artifact?.contentTruncated, undefined);
    const longArtifact = h.store.put("artifacts", { ...artifact, content: `${artifact.content}artifact-tail-must-not-enter-4527` });
    const clippedArtifact = await submitContextSnapshot(h, { conversationId: source.id, artifactId: artifact.id });
    assert.equal(clippedArtifact.snapshot.artifact?.content.length, 12000);
    assert.equal(clippedArtifact.snapshot.artifact?.content, artifact.content);
    assert.equal(clippedArtifact.snapshot.artifact?.contentTruncated, true);
    assert.ok(!clippedArtifact.pending.prompt.includes("artifact-tail-must-not-enter-4527"));
    assert.equal(h.store.require("artifacts", artifact.id).content, longArtifact.content);

    const data = { documentId: "bounded-reference-contract", title: "长度边界合同", source: "paste", requirements: "", clauses: [{ id: "C001", text: "" }], suggestions: [] };
    data.clauses[0]!.text = "字".repeat(12000 - JSON.stringify(data).length);
    assert.equal(JSON.stringify(data).length, 12000);
    const object = h.store.saveObject(source.id, { appId: "contracts", type: "contract-review", title: data.title, data });
    const exactObject = await submitContextSnapshot(h, { conversationId: source.id, appId: "contracts", objectId: object.id });
    assert.deepEqual(exactObject.snapshot.object?.data, data);
    assert.equal(exactObject.snapshot.object?.dataTruncated, undefined);
    const largeData = structuredClone(data);
    largeData.clauses[0]!.text += "扩".repeat(100) + "object-tail-must-not-enter-5139";
    const largeObject = h.store.saveObject(source.id, { ...object, expectedVersion: object.version, data: largeData });
    const clippedObject = await submitContextSnapshot(h, { conversationId: source.id, appId: "contracts", objectId: object.id });
    assert.equal(clippedObject.snapshot.object?.data, JSON.stringify(largeData).slice(0, 12000));
    assert.equal(clippedObject.snapshot.object?.dataTruncated, true);
    assert.equal(clippedObject.snapshot.object?.version, largeObject.version);
    assert.ok(!clippedObject.pending.prompt.includes("object-tail-must-not-enter-5139"));
    assert.deepEqual(h.store.require("objects", object.id).data, largeData);
    assert.equal(h.store.list("messages").filter(message => message.conversationId === source.id).length, 0);
    assert.equal(h.dispatches(), 4);
  } finally { await h.close(); }
});
