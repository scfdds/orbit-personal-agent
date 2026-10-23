import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OrbitStore } from "./store.ts";
import { OrbitRuntime } from "./runtime.ts";
import { createOrbitServer } from "./http.ts";
import { loadApps } from "../apps/registry.ts";
import { buildMatterGroups, findMatterGroup } from "../shared/matter-groups.ts";
import type { Conversation } from "../shared/types.ts";

test("HTTP opens an independent discussion in the same matter without copying history or launching work", async () => {
  const dir = await mkdtemp(join(tmpdir(), "orbit-matter-discussion-"));
  const store = new OrbitStore(":memory:");
  const runtime = new OrbitRuntime(store, await loadApps({ installedOnly: true }), dir);
  runtime.initialize({ seed: false });
  let dispatches = 0;
  runtime.pump = () => { dispatches++; };
  const source = store.createConversation("客户官网方案", { project: "体验示例", goal: "准备官网改版", summary: "范围已确定，报价待讨论" });
  const other = store.createConversation("杭州旅行", { project: "体验示例", summary: "不相关背景" });
  const question = store.addMessage(source.id, "user", "SOURCE_HISTORY_NOT_TO_COPY");
  store.addMessage(other.id, "assistant", "UNRELATED_HISTORY_NOT_TO_COPY");
  const originalSource = store.require("conversations", source.id);
  const beforeMessages = store.list("messages");
  const server = createOrbitServer(runtime);
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const request = (id: string, title: unknown) => fetch(`http://127.0.0.1:${address.port}/api/conversations/${id}/discussions`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }),
  });
  try {
    const response = await request(source.id, "  报价与交付范围  ");
    assert.equal(response.status, 201);
    const child = await response.json() as Conversation;
    assert.notEqual(child.id, source.id);
    assert.equal(child.title, "报价与交付范围");
    assert.equal(child.project, source.project);
    assert.equal(child.parentId, undefined);
    assert.equal(child.matterId, `thread:${source.id}`);
    assert.equal(child.matterTitle, source.title);
    assert.deepEqual(child.inheritedSources, [question.id]);
    assert.match(child.inheritedContext!, /准备官网改版/);
    assert.match(child.inheritedContext!, /范围已确定/);
    assert.doesNotMatch(child.inheritedContext!, /HISTORY_NOT_TO_COPY/);
    assert.equal(store.require("conversations", source.id).updatedAt, originalSource.updatedAt);
    assert.equal(store.require("conversations", source.id).summary, originalSource.summary);
    assert.deepEqual(store.require("conversations", other.id), other);
    assert.deepEqual(store.list("messages"), beforeMessages);
    assert.equal(store.list("runs").length, 0);
    assert.equal(store.pending().length, 0);
    assert.equal(dispatches, 0);
    const snapshot = runtime.snapshot();
    const mainId = runtime.assistant.getState().conversationId;
    const groups = buildMatterGroups(snapshot.conversations, mainId);
    assert.equal(findMatterGroup(groups, child.id)?.id, findMatterGroup(groups, source.id)?.id);
    assert.notEqual(findMatterGroup(groups, child.id)?.id, findMatterGroup(groups, other.id)?.id);
    const response2 = await request(child.id, "合同条款");
    assert.equal(response2.status, 201);
    const sibling = await response2.json() as Conversation;
    assert.equal(sibling.matterId, child.matterId);
    assert.match(sibling.inheritedContext!, /准备官网改版/);
    assert.doesNotMatch(sibling.inheritedContext!, /HISTORY_NOT_TO_COPY/);

    const beforeRejected = store.list("conversations").length;
    for (const title of ["", "   ", "x".repeat(161), 4, { text: "a" }, "bad\u0000title"])
      assert.equal((await request(source.id, title)).status, 400);
    assert.equal((await request(mainId, "Wrong scope")).status, 400);
    assert.equal((await request("missing", "Missing")).status, 404);
    store.updateConversation(source.id, { archived: true });
    assert.equal((await request(source.id, "Archived")).status, 409);
    assert.equal(store.list("conversations").length, beforeRejected);
  } finally {
    await runtime.close(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    store.close(); await rm(dir, { recursive: true, force: true });
  }
});
