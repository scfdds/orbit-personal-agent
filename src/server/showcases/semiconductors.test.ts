import test from "node:test";
import assert from "node:assert/strict";
import { OrbitStore } from "../store.ts";
import { MemoryService } from "../memory.ts";
import {
  createSemiconductorShowcase,
  seedSemiconductorShowcase,
  SEMICONDUCTOR_SHOWCASE_ID,
} from "./semiconductors.ts";

test("showcase imports atomically once and preserves existing chats, edits and removals", () => {
  const store = new OrbitStore(":memory:");
  try {
    const existing = store.createConversation("正在使用的对话");
    store.addMessage(existing.id, "user", "保留原始内容");
    assert.equal(seedSemiconductorShowcase(store).inserted, true);
    const memory = store.require("memories", SEMICONDUCTOR_SHOWCASE_ID);
    memory.items[0].text = "用户重新解释了这个概念";
    memory.items[0].edited = true;
    memory.items[1].deleted = true;
    store.put("memories", memory);
    const before = store.snapshot([], "mock", false);
    assert.equal(seedSemiconductorShowcase(store).inserted, false);
    assert.deepEqual(store.snapshot([], "mock", false), before);
    assert.deepEqual(store.require("conversations", existing.id), existing);
    store.deleteConversation(`${SEMICONDUCTOR_SHOWCASE_ID}-supply`);
    seedSemiconductorShowcase(store);
    assert.equal(
      store.get("conversations", `${SEMICONDUCTOR_SHOWCASE_ID}-supply`),
      undefined,
    );
    assert.equal(store.list("runs").length, 0);
    assert.equal(store.list("triggers").length, 0);
  } finally {
    store.close();
  }
});

test("every mock memory has resolvable original messages; forks cannot inherit the later Q4 revisit", async () => {
  const store = new OrbitStore(":memory:");
  const service = new MemoryService(store, () => {});
  try {
    seedSemiconductorShowcase(store);
    const data = createSemiconductorShowcase();
    assert.equal(data.conversations.length, 4);
    assert.equal(data.messages.length, 42);
    assert.equal(data.memories.flatMap((m) => m.items).length, 24);
    assert.equal(
      new Set(data.messages.map((m) => m.id)).size,
      data.messages.length,
    );
    for (const c of data.conversations) {
      assert.ok(c.showcase?.notice.includes("预置"));
      const memory = store.require("memories", c.id);
      for (const item of memory.items) {
        assert.ok(item.sourceIds.length);
        for (const source of item.sourceIds)
          assert.ok(service.source(c.id, source));
      }
      assert.equal(
        memory.coveredMessageId,
        data.messages.filter((m) => m.conversationId === c.id).at(-1)!.id,
      );
      assert.ok(service.context(c.id).showcase?.notice.includes("实时行情"));
      if (c.parentId) {
        const fork = store.require("messages", c.forkMessageId!);
        assert.equal(fork.conversationId, c.parentId);
        assert.ok(c.inheritedSources?.length);
        for (const source of c.inheritedSources!) {
          const original = service.source(c.id, source);
          assert.equal(original.conversationId, c.parentId);
          assert.ok(original.createdAt <= fork.createdAt);
        }
        assert.throws(
          () => service.source(c.id, `${c.parentId}-a8`),
          /来源不属于/,
        );
        assert.ok(!c.inheritedContext?.includes("0.803"));
      }
    }
  } finally {
    await service.close();
    store.close();
  }
});

test("partial ID collisions refuse the whole import instead of overwriting user data", () => {
  const store = new OrbitStore(":memory:");
  try {
    const existing = store.createConversation("同名 ID 已被使用", {
      id: `${SEMICONDUCTOR_SHOWCASE_ID}-countercase`,
    });
    assert.throws(() => seedSemiconductorShowcase(store), /未覆盖/);
    assert.deepEqual(store.list("conversations"), [existing]);
    assert.equal(store.list("messages").length, 0);
    assert.equal(store.list("memories").length, 0);
  } finally {
    store.close();
  }
});
