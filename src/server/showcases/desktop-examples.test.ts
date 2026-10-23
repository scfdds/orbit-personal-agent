import test from "node:test";
import assert from "node:assert/strict";
import { OrbitStore } from "../store.ts";
import { desktopExamplesMarker, seedDesktopExamples } from "./desktop-examples.ts";

test("desktop examples are opt-in and create linked, clearly labelled idle material", () => {
  const store = new OrbitStore(":memory:");
  try {
    assert.equal(store.list("conversations").length, 0);
    const result = seedDesktopExamples(store);
    assert.equal(result.created.length, 3);
    assert.deepEqual(result.skipped, []);
    for (const conversation of store.list("conversations")) {
      assert.equal(conversation.status, "idle");
      assert.equal(conversation.continuous, false);
      assert.equal(conversation.showcase?.title, "示例");
      assert.match(conversation.showcase!.notice, /示例对话/);
      assert.match(conversation.summary, /背景：.*已确定：.*下一步：/);
      const messages = store.list("messages").filter(message => message.conversationId === conversation.id);
      assert.equal(messages.length, 8);
      for (let index = 0; index < messages.length; index++) {
        assert.equal(messages[index]!.role, index % 2 ? "assistant" : "user");
        assert.equal(messages[index]!.runId, undefined);
      }
      const artifact = store.list("artifacts").find(item => item.conversationId === conversation.id)!;
      assert.equal(artifact.format, "markdown");
      assert.match(artifact.content, /示例/);
      assert.deepEqual(conversation.panel, { kind: "artifact", artifactId: artifact.id });
      const memory = store.require("memories", conversation.id);
      assert.equal(memory.coveredMessageId, messages.at(-1)!.id);
      for (const item of memory.items)
        assert.ok(item.sourceIds.every(id => messages.some(message => message.id === id)));
    }
    for (const table of ["runs", "works", "triggers", "subagents", "activities"] as const)
      assert.equal(store.list(table).length, 0);
    assert.equal(store.pending().length, 0);
  } finally { store.close(); }
});

test("repeated install changes nothing and does not restore deleted examples", () => {
  const store = new OrbitStore(":memory:");
  try {
    const first = seedDesktopExamples(store);
    const editedId = first.created[0]!;
    store.updateConversation(editedId, { title: "我的杭州计划", summary: "用户自己的安排" });
    store.addMessage(editedId, "user", "预算改为 3,000 元。");
    const artifact = store.list("artifacts").find(item => item.conversationId === editedId)!;
    store.put("artifacts", { ...artifact, content: "用户编辑的正文" });
    store.deleteConversation(first.created[1]!);
    const before = store.snapshot([], "", false);
    const second = seedDesktopExamples(store);
    assert.deepEqual(second.created, []);
    assert.equal(second.skipped.length, 3);
    assert.deepEqual(store.snapshot([], "", false), before);
    assert.equal(store.get("conversations", first.created[1]!), undefined);
  } finally { store.close(); }
});

test("existing user conversations and reserved IDs are left untouched", () => {
  const store = new OrbitStore(":memory:");
  try {
    const ordinary = store.createConversation("我的工作", { id: "user-conversation" });
    const collision = store.createConversation("用户导入的资料", {
      id: "desktop-example-hangzhou", project: "我的项目", summary: "不可修改",
    });
    const message = store.addMessage(collision.id, "user", "自己的内容");
    const result = seedDesktopExamples(store);
    assert.equal(result.created.length, 2);
    assert.deepEqual(result.skipped, [collision.id]);
    assert.deepEqual(store.require("conversations", ordinary.id), ordinary);
    assert.deepEqual(store.require("conversations", collision.id), collision);
    assert.deepEqual(store.list("messages").filter(item => item.conversationId === collision.id), [message]);
    assert.equal(store.get("memories", collision.id), undefined);
  } finally { store.close(); }
});

test("child record collision rolls back the entire installation", () => {
  const store = new OrbitStore(":memory:");
  try {
    // Collision in the second example must also roll back insertion of the first.
    const artifact = store.put("artifacts", {
      id: "desktop-example-client-proposal-note", conversationId: "user-conversation",
      title: "保留", content: "原始正文", format: "markdown", updatedAt: "2026-01-01T00:00:00Z",
    });
    assert.throws(() => seedDesktopExamples(store), /未覆盖现有数据/);
    assert.equal(store.list("conversations").length, 0);
    assert.equal(store.list("messages").length, 0);
    assert.equal(store.list("memories").length, 0);
    assert.deepEqual(store.list("artifacts"), [artifact]);
    assert.equal(store.metadata(desktopExamplesMarker), undefined);
  } finally { store.close(); }
});
