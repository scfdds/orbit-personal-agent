import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OrbitStore } from "../store.ts";
import { OrbitRuntime } from "../runtime.ts";
import { recapSource } from "../../shared/recap.ts";
import { buildHomeTimeline } from "../../client/desktop/home-timeline.ts";
import { seedWorkspaceDemo, workspaceDemoMarker, workspaceDemoProjectId, workspaceDemoConversationId } from "./workspace-demo.ts";

function harness() {
  const dir = mkdtempSync(join(tmpdir(), "orbit-workspace-fixture-"));
  const store = new OrbitStore(join(dir, "orbit.sqlite"));
  const runtime = new OrbitRuntime(store, [], dir);
  let modelCalls = 0;
  const noModel = async () => { modelCalls++; throw new Error("Fixtures must not invoke a model"); };
  runtime.wechatPersonal.generate = noModel;
  runtime.projects.generate = noModel;
  return { dir, store, runtime, calls: () => modelCalls, async close() {
    await runtime.close(); store.close(); rmSync(dir, { recursive: true, force: true });
  } };
}

test("workspace fixtures are coherent native projects, memories and sourced notification topics", async () => {
  const h = harness();
  try {
    seedWorkspaceDemo(h.runtime);
    const snapshot = h.runtime.snapshot();
    const projects = snapshot.projects || [];
    assert.equal(projects.length, 5);
    assert.equal(snapshot.conversations.length, 13);
    assert.equal(snapshot.messages.length, 51);
    const mainId = h.runtime.assistant.getState().conversationId;
    assert.equal(snapshot.conversations.find(c => c.id === mainId)?.projectId, undefined);
    for (const project of projects) {
      const conversations = snapshot.conversations.filter(c => c.projectId === project.id);
      assert.ok(conversations.length >= 2 && conversations.length <= 3);
      const document = h.runtime.projects.readDocument(project.id);
      assert.ok(document.content.length > 100);
      assert.equal(readFileSync(document.path, "utf8"), document.content);
      const index = h.runtime.projects.readFile(project.id, "INDEX.md");
      for (const conversation of conversations) {
        assert.match(index.content, new RegExp(conversation.id));
        const memory = h.store.require("memories", conversation.id);
        assert.equal(memory.recap?.sourceKey, recapSource(conversation.id, snapshot.messages, snapshot.conversations).key);
        const messages = snapshot.messages.filter(m => m.conversationId === conversation.id);
        assert.deepEqual(messages.map(m => m.role), ["user", "assistant", "user", "assistant"]);
        assert.ok(memory.items.every(item => item.sourceIds.every(id => messages.some(m => m.id === id))));
        assert.equal(conversation.status, "idle");
        assert.equal(conversation.continuous, false);
      }
    }
    const state = h.runtime.wechatPersonal.state();
    assert.equal(state.contacts.length, 3);
    for (const contact of state.contacts) {
      assert.equal(contact.count, 3);
      assert.equal(contact.enabled, true);
      assert.equal(contact.context.watching, false);
      assert.ok(contact.context.projectId && projects.some(p => p.id === contact.context.projectId));
      assert.equal(contact.topic?.sources.length, 3);
      const captured = h.runtime.wechat.read(contact.id).messages;
      assert.ok(contact.topic!.sources.every(source => captured.some(record => record.id === source.id && record.text === source.text)));
    }
    assert.equal(h.runtime.wechat.state().collector.status, "stopped");
    assert.equal(h.calls(), 0);
    assert.equal(h.store.list("runs").length, 0);
    assert.equal(h.store.list("triggers").length, 0);
    assert.equal(h.store.pending().length, 0);
  } finally { await h.close(); }
});

test("main history displays the canonical project reply without duplicating the answer", async () => {
  const h = harness();
  try {
    seedWorkspaceDemo(h.runtime);
    const snapshot = h.runtime.snapshot();
    const mainId = h.runtime.assistant.getState().conversationId;
    const timeline = buildHomeTimeline({ snapshot, mainId });
    const target = workspaceDemoConversationId("cafe-preview");
    const answer = h.store.require("messages", `${target}-a2`);
    assert.ok(timeline.messages.some(m => m.id === answer.id));
    assert.equal(timeline.assignments[answer.id]?.conversationId, target);
    assert.equal(snapshot.messages.filter(m => m.content === answer.content).length, 1);
    assert.equal(timeline.messages.filter(m => m.role === "user").length, 2);
  } finally { await h.close(); }
});

test("re-entering the demo preserves edits and does not restore deleted fixtures", async () => {
  const h = harness();
  try {
    seedWorkspaceDemo(h.runtime);
    const projectId = workspaceDemoProjectId("cafe");
    const document = h.runtime.projects.readDocument(projectId);
    h.runtime.projects.saveDocument(projectId, document.version, "用户在演示中把交付日期改为下周。\n");
    h.store.deleteConversation(workspaceDemoConversationId("finance-valuation"));
    h.store.addMessage(h.runtime.assistant.getState().conversationId, "user", "继续讨论刚才的问题。");
    const before = h.runtime.snapshot();
    seedWorkspaceDemo(h.runtime);
    assert.deepEqual(h.runtime.snapshot(), before);
    assert.equal(h.runtime.projects.readDocument(projectId).content, "用户在演示中把交付日期改为下周。\n");
    assert.equal(h.store.get("conversations", workspaceDemoConversationId("finance-valuation")), undefined);
    assert.ok(h.store.metadata(workspaceDemoMarker));
  } finally { await h.close(); }
});

test("the fixture refuses a workspace containing user conversations or just personal memory", async () => {
  const h = harness();
  try {
    h.store.createConversation("不可覆盖的原对话");
    const before = h.store.snapshot([], "", false);
    assert.throws(() => seedWorkspaceDemo(h.runtime), /独立的空工作空间/);
    assert.deepEqual(h.store.snapshot([], "", false), before);
    assert.equal(h.store.metadata(workspaceDemoMarker), undefined);
  } finally { await h.close(); }

  const memoryOnly = harness();
  try {
    const document = memoryOnly.runtime.projects.readDocument();
    memoryOnly.runtime.projects.saveDocument(undefined, document.version, "需要保留的个人记忆。\n");
    assert.throws(() => seedWorkspaceDemo(memoryOnly.runtime), /独立的空工作空间/);
    assert.equal(memoryOnly.runtime.projects.readDocument().content, "需要保留的个人记忆。\n");
  } finally { await memoryOnly.close(); }
});
