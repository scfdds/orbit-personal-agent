import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryService } from "./memory.ts";
import { OrbitStore, HttpError } from "./store.ts";
import { OrbitRuntime } from "./runtime.ts";
import { loadApps } from "../apps/registry.ts";
import { createOrbitServer } from "./http.ts";

function setup() {
  const store = new OrbitStore(":memory:");
  const conversation = store.createConversation("产品讨论", {
    project: "Orbit",
  });
  const first = store.addMessage(
    conversation.id,
    "user",
    "产品名叫 Orbit，使用白色界面。",
  );
  const second = store.addMessage(
    conversation.id,
    "assistant",
    "已确认名称，可以考虑星图导航。",
  );
  const memory = new MemoryService(
    store,
    () => {},
    async () => ({
      summary: "讨论名称和界面",
      items: [
        {
          id: "mem-name",
          kind: "decision",
          text: "产品名为 Orbit",
          sourceIds: [first.id],
        },
        {
          id: "mem-map",
          kind: "idea",
          text: "可以考虑星图导航",
          sourceIds: [second.id],
        },
      ],
    }),
  );
  return { store, conversation, first, second, memory };
}
test("LLM summaries persist, validate source IDs and preserve the last valid memory on failure", async () => {
  const { store, conversation, memory } = setup();
  await memory.schedule(conversation.id);
  assert.equal(memory.get(conversation.id).status, "ready");
  assert.equal(memory.effective(conversation.id).items.length, 2);
  memory.generate = async () => ({
    summary: "错误摘要",
    items: [{ kind: "decision", text: "不存在", sourceIds: ["fake"] }],
  });
  await memory.schedule(conversation.id);
  assert.equal(memory.get(conversation.id).status, "failed");
  assert.equal(memory.get(conversation.id).summary, "讨论名称和界面");
  await memory.close();
  store.close();
});
test("manual correction and forgetting survive delayed model writes and reject stale edits", async () => {
  const { store, conversation, memory } = setup();
  await memory.schedule(conversation.id);
  let release!: () => void;
  let entered!: () => void;
  const start = new Promise<void>((r) => (entered = r));
  let calls = 0;
  memory.generate = async () => {
    if (++calls === 1) {
      entered();
      await new Promise<void>((r) => (release = r));
    }
    return {
      summary: "新概述",
      items: [
        {
          id: "mem-name",
          kind: "decision",
          text: "旧结论",
          sourceIds: [memory.get(conversation.id).items[0]!.sourceIds[0]],
        },
        {
          id: "mem-new-map",
          kind: "idea",
          text: "换措辞的星图建议",
          sourceIds: [memory.get(conversation.id).items[1]!.sourceIds[0]],
        },
      ],
    };
  };
  const job = memory.schedule(conversation.id);
  await start;
  memory.edit(conversation.id, 1, {
    itemId: "mem-name",
    text: "用户修正：产品名是 Orbit II",
  });
  assert.throws(
    () =>
      memory.edit(conversation.id, 1, { itemId: "mem-name", text: "不应覆盖" }),
    HttpError,
  );
  memory.edit(conversation.id, 2, { itemId: "mem-map", deleted: true });
  release();
  await job;
  assert.equal(memory.effective(conversation.id).items.length, 1);
  assert.match(memory.effective(conversation.id).items[0]!.text, /Orbit II/);
  assert.equal(
    memory.get(conversation.id).items.find((i) => i.id === "mem-map")?.deleted,
    true,
  );
  await memory.close();
  store.close();
});
test("fork inherits only through its source message and does not clone jobs or future messages", async () => {
  const { store, conversation, first, memory } = setup();
  store.addMessage(conversation.id, "user", "后来的秘密，不得进入早期分支");
  let input = "";
  memory.generate = async (text) => {
    input = text;
    return {
      summary: "产品名 Orbit",
      items: [{ kind: "decision", text: "名称", sourceIds: [first.id] }],
    };
  };
  const child = await memory.fork(conversation.id, first.id, "视觉方向");
  assert.equal(child.parentId, conversation.id);
  assert.equal(child.forkMessageId, first.id);
  assert.deepEqual(child.inheritedSources, [first.id]);
  assert.ok(!input.includes("后来的秘密"));
  assert.equal(memory.messages(child.id).length, 0);
  assert.equal(store.list("works").length, 0);
  assert.match(JSON.stringify(memory.context(child.id)), /产品名 Orbit/);
  await assert.rejects(
    () => memory.fork(child.id, first.id, "错误来源"),
    HttpError,
  );
  await memory.close();
  store.close();
});
test("summary queue consumes messages that arrive during generation", async () => {
  const { store, conversation, first, memory } = setup();
  let calls = 0;
  memory.generate = async () => {
    if (++calls === 1)
      store.addMessage(conversation.id, "user", "还有一个新要求");
    return {
      summary: "已整理",
      items: [{ kind: "fact", text: "名称", sourceIds: [first.id] }],
    };
  };
  await memory.schedule(conversation.id);
  assert.equal(calls, 2);
  assert.equal(
    memory.get(conversation.id).coveredMessageId,
    memory.messages(conversation.id).at(-1)!.id,
  );
  await memory.close();
  store.close();
});
test("refresh rereads the complete bounded conversation, including early explanations beyond the last twelve messages", async () => {
  const { store, conversation, first, memory } = setup();
  for (let i=0;i<18;i++) store.addMessage(conversation.id,i%2?'assistant':'user',`后续澄清 ${i}`);
  await memory.schedule(conversation.id);
  let input: {previous:{summary:string};messages:{id:string;content:string}[]} | undefined;
  memory.generate = async raw => {
    input=JSON.parse(raw);
    return {summary:'包含早期回答与后续澄清的完整回顾',items:[]};
  };
  await memory.schedule(conversation.id);
  assert.equal(input?.messages.length,20);
  assert.equal(input?.messages[0]?.id,first.id);
  assert.equal(input?.previous.summary,"");
  assert.equal(memory.get(conversation.id).coveredMessageId,memory.messages(conversation.id).at(-1)!.id);
  await memory.close();store.close();
});
test("memory is a real app and HTTP edits reach Agent tools and survive reopen", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-memory-test-"));
  const path = join(dir, "orbit.sqlite");
  let store = new OrbitStore(path);
  const apps = await loadApps();
  const runtime = new OrbitRuntime(store, apps, dir);
  const c = runtime.createConversation("测试");
  const msg = store.addMessage(c.id, "user", "使用极简风格");
  runtime.memory.generate = async () => ({
    summary: "设计偏好",
    items: [
      {
        id: "mem-style",
        kind: "decision",
        text: "极简风格",
        sourceIds: [msg.id],
      },
    ],
  });
  const server = createOrbitServer(runtime);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}/api`;
  try {
    const response = await fetch(
      `${base}/conversations/${c.id}/memory/refresh`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    );
    assert.equal(response.status, 202);
    await runtime.memory.schedule(c.id);
    const edited = await fetch(`${base}/conversations/${c.id}/memory`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: runtime.memory.get(c.id).version,
        itemId: "mem-style",
        text: "极简，使用暖白色",
      }),
    });
    assert.equal(edited.status, 200);
    const tools = apps
      .find((a) => a.manifest.id === "memory")!
      .createTools(runtime.appContext(c.id));
    const result = await tools
      .find((t) => t.name === "memory_read")!
      .execute(
        "t",
        { conversationId: c.id },
        undefined,
        undefined,
        {} as never,
      );
    assert.match(JSON.stringify(result), /暖白色/);
    assert.match(runtime.contextSummary(c.id), /暖白色/);
    await runtime.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
    store = new OrbitStore(path);
    assert.match(store.get("memories", c.id)!.items[0]!.text, /暖白色/);
  } finally {
    await runtime.close();
    server.closeAllConnections();
    server.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("branch memory may cite inherited evidence while unrelated source IDs remain invalid", async () => {
  const { store, conversation, first, memory } = setup();
  memory.generate = async () => ({
    summary: "名称决定",
    items: [
      { kind: "decision", text: "产品名是 Orbit", sourceIds: [first.id] },
    ],
  });
  const child = await memory.fork(conversation.id, first.id, "分支");
  store.addMessage(child.id, "user", "继续这一方向");
  memory.generate = async () => ({
    summary: "继续沿用名称决定",
    items: [
      { kind: "decision", text: "产品名是 Orbit", sourceIds: [first.id] },
    ],
  });
  await memory.schedule(child.id);
  assert.equal(memory.get(child.id).status, "ready");
  assert.equal(
    memory.source(child.id, first.id).conversationId,
    conversation.id,
  );
  const unrelated = store.createConversation("无关");
  const foreign = store.addMessage(unrelated.id, "user", "无关内容");
  assert.throws(() => memory.source(child.id, foreign.id), HttpError);
  await memory.close();
  store.close();
});
