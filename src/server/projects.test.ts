import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { OrbitStore } from "./store.ts";
import { ProjectService } from "./projects.ts";
import { SectionService } from "./sections.ts";
import { recapSource } from "../shared/recap.ts";
import { conversationRounds } from "../shared/discussion.ts";

test("legacy project names migrate idempotently; main and unassigned conversations stay outside projects", () => {
  const directory = mkdtempSync(join(tmpdir(), "orbit-project-migration-"));
  const path = join(directory, "test.sqlite");
  try {
    let store = new OrbitStore(path);
    const legacy = store.createConversation("首页", { project: "个人网站" });
    const { projectId, ...withoutId } = legacy;
    store.put("conversations", withoutId);
    store.db.exec("DELETE FROM projects");
    store.put("sections", { id: "section-website", name: "个人网站", pinned: true, order: 2 });
    store.createConversation("随便问问");
    store.createConversation("Orbit 主助手", { id: "orbit-assistant", project: "Orbit" });
    store.close();
    store = new OrbitStore(path);
    const projects = new ProjectService(store, () => {});
    assert.equal(projects.list().length, 1);
    const migrated = projects.list()[0]!;
    assert.equal(migrated.name, "个人网站");
    assert.equal(migrated.pinned, true);
    assert.equal(store.require("conversations", legacy.id).projectId, migrated.id);
    assert.equal(store.require("conversations", "orbit-assistant").projectId, undefined);
    assert.equal(store.list("conversations").find(c => c.title === "随便问问")?.projectId, undefined);
    store.migrateProjects();
    assert.equal(projects.list().length, 1);
    store.close();
    store = new OrbitStore(path);
    assert.equal(store.list("projects")[0]?.id, migrated.id);
    store.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("create, rename, legacy reassignment, dissolve preserve canonical conversation records", () => {
  const store = new OrbitStore(":memory:");
  const service = new ProjectService(store, () => {});
  const project = service.create({ name: "网站", instructions: "先完成可运行版本" });
  const first = store.createConversation("首页", { projectId: project.id });
  const original = store.addMessage(first.id, "user", "不要登录");
  service.update(project.id, { name: "个人网站", icon: "🌐" });
  assert.equal(store.require("conversations", first.id).project, "个人网站");
  assert.equal(store.list("sections")[0]?.name, "个人网站");
  const second = store.createConversation("部署", { project: "个人网站" });
  assert.equal(second.projectId, project.id);
  store.updateConversation(second.id, { project: "旅行" });
  assert.notEqual(store.require("conversations", second.id).projectId, project.id);
  service.delete(project.id);
  assert.equal(store.require("conversations", first.id).projectId, undefined);
  assert.equal(store.require("messages", original.id).content, "不要登录");
  assert.ok(!service.list().some(p => p.id === project.id || p.name === "个人网站"));
  store.close();
});

test("project decisions cross conversations inside one project; general memory contains only user preferences", async () => {
  const store = new OrbitStore(":memory:");
  const a = store.createConversation("首页", { project: "网站" });
  const b = store.createConversation("部署", { project: "网站" });
  const other = store.createConversation("酒店", { project: "旅行" });
  const decision = store.addMessage(a.id, "user", "网站第一版不做登录");
  const preference = store.addMessage(a.id, "user", "以后讲解请先给结论再给理由");
  const inputs: Array<{ scope: string; messages: { id: string; role: string }[] }> = [];
  const service: ProjectService = new ProjectService(store, () => {}, async raw => {
    const input = JSON.parse(raw); inputs.push(input);
    return { items: input.scope === "general"
      ? [{ id: "preference-style", kind: "preference", text: "讲解先给结论再给理由", sourceIds: [preference.id] }]
      : [{ id: "website-login", kind: "decision", text: "网站第一版不做登录", sourceIds: [decision.id] }] };
  });
  await service.schedule(a.id);
  assert.match(JSON.stringify(service.context(b.id)), /第一版不做登录/);
  assert.doesNotMatch(JSON.stringify(service.context(other.id)), /第一版不做登录/);
  assert.match(JSON.stringify(service.context(other.id)), /先给结论/);
  assert.equal(inputs[0]?.scope, "general");
  assert.ok(inputs[0]?.messages.every(message => message.role === "user"));
  const count = inputs.length;
  await service.schedule(a.id);
  assert.equal(inputs.length, count, "unchanged evidence must not trigger another model request");
  await service.close(); store.close();
});

test("generated global facts and assistant-sourced preferences are rejected, prior memory remains", async () => {
  const store = new OrbitStore(":memory:");
  const c = store.createConversation("随问");
  const user = store.addMessage(c.id, "user", "请一直简洁回答");
  const assistant = store.addMessage(c.id, "assistant", "用户的项目需要使用 Java");
  const service = new ProjectService(store, () => {}, async () => ({ items: [{ id: "style", kind: "preference", text: "回答简洁", sourceIds: [user.id] }] }));
  await service.schedule(c.id);
  store.addMessage(c.id, "user", "继续");
  service.generate = async () => ({ items: [{ kind: "fact", text: "网站用 Java", sourceIds: [user.id] }] });
  await service.schedule(c.id);
  assert.equal(service.getMemory().status, "failed");
  assert.equal(service.getMemory().items[0]?.text, "回答简洁");
  service.generate = async () => ({ items: [{ kind: "preference", text: "网站用 Java", sourceIds: [assistant.id] }] });
  await service.schedule(c.id);
  assert.equal(service.getMemory().status, "failed");
  assert.equal(service.getMemory().items[0]?.text, "回答简洁");
  await service.close(); store.close();
});

test("manual correction and forgetting survive in-flight model output and stale writes conflict", async () => {
  const store = new OrbitStore(":memory:");
  const c = store.createConversation("首页", { project: "网站" });
  const source = store.addMessage(c.id, "user", "第一版不做登录");
  const other = store.addMessage(c.id, "user", "使用红色");
  const generated = { items: [{ id: "login", kind: "decision", text: "不做登录", sourceIds: [source.id] }, { id: "color", kind: "decision", text: "使用红色", sourceIds: [other.id] }] };
  const service = new ProjectService(store, () => {}, async raw => JSON.parse(raw).scope === "general" ? { items: [] } : generated);
  await service.schedule(c.id);
  store.addMessage(c.id, "assistant", "接下来可以部署");
  let started!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  service.generate = async raw => {
    if (JSON.parse(raw).scope === "general") return { items: [] };
    started(); await new Promise<void>(resolve => { release = resolve; }); return generated;
  };
  const pending = service.schedule(c.id); await entered;
  const original = service.getMemory(c.projectId);
  service.updateMemory(c.projectId, original.version, { itemId: "login", text: "第二版再做登录" });
  assert.throws(() => service.updateMemory(c.projectId, original.version, { itemId: "login", text: "旧写入" }), /记忆已更新/);
  service.updateMemory(c.projectId, service.getMemory(c.projectId).version, { itemId: "color", deleted: true });
  release(); await pending;
  const items = service.getMemory(c.projectId).items;
  assert.equal(items.find(item => item.id === "login")?.text, "第二版再做登录");
  assert.equal(items.find(item => item.id === "color")?.deleted, true);
  assert.doesNotMatch(JSON.stringify(service.context(c.id)), /使用红色/);
  await service.close(); store.close();
});

test("moving/deleting sources immediately revokes derived memory even through legacy store operations", async () => {
  const store = new OrbitStore(":memory:");
  const sourceConversation = store.createConversation("首页", { project: "网站" });
  const sibling = store.createConversation("部署", { project: "网站" });
  const source = store.addMessage(sourceConversation.id, "user", "网站的特殊结论");
  const service = new ProjectService(store, () => {}, async raw => JSON.parse(raw).scope === "general" ? { items: [] } : { items: [{ id: "fact", kind: "fact", text: "网站的特殊结论", sourceIds: [source.id] }] });
  await service.schedule(sourceConversation.id);
  service.updateMemory(sourceConversation.projectId, service.getMemory(sourceConversation.projectId).version, { itemId: "fact", text: "手动修正的网站结论" });
  store.updateConversation(sourceConversation.id, { project: "旅行" });
  assert.doesNotMatch(JSON.stringify(service.context(sibling.id)), /网站结论/);
  assert.equal(service.getMemory(sibling.projectId).items.length, 0);
  const manual = service.updateMemory(sibling.projectId, service.getMemory(sibling.projectId).version, { text: "手动添加项目约束" });
  assert.equal(manual.items.length, 1);
  store.deleteConversation(sourceConversation.id);
  assert.match(JSON.stringify(service.context(sibling.id)), /手动添加项目约束/);
  await service.close(); store.close();
});

test("source reassignment during generation discards the complete stale response", async () => {
  const store = new OrbitStore(":memory:");
  const a = store.createConversation("A", { project: "项目甲" });
  const sibling = store.createConversation("A2", { project: "项目甲" });
  const source = store.addMessage(a.id, "user", "甲项目独有内容");
  let started!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const service = new ProjectService(store, () => {}, async raw => {
    if (JSON.parse(raw).scope === "general") return { items: [] };
    started(); await new Promise<void>(resolve => { release = resolve; });
    return { items: [{ kind: "fact", text: "甲项目独有内容", sourceIds: [source.id] }] };
  });
  const pending = service.schedule(a.id); await entered;
  store.updateConversation(a.id, { project: "项目乙" });
  release(); await pending;
  assert.equal(service.getMemory(sibling.projectId).items.length, 0);
  assert.doesNotMatch(JSON.stringify(service.context(sibling.id)), /甲项目独有内容/);
  await service.close(); store.close();
});

test("source deletion invalidates existing entries, general memory and generated output", async () => {
  const store = new OrbitStore(":memory:");
  const c = store.createConversation("讨论");
  const s = store.addMessage(c.id, "user", "始终先结论");
  const service = new ProjectService(store, () => {}, async () => ({ items: [{ kind: "preference", text: "始终先结论", sourceIds: [s.id] }] }));
  await service.schedule(c.id);
  store.db.prepare("DELETE FROM messages WHERE id=?").run(s.id);
  assert.equal(service.getMemory().items.length, 0);
  await service.close(); store.close();
});

test("manual sources must belong to project and no-source user entries remain bounded", () => {
  const store = new OrbitStore(":memory:");
  const a = store.createConversation("A", { project: "项目甲" });
  const b = store.createConversation("B", { project: "项目乙" });
  const source = store.addMessage(b.id, "user", "乙的内容");
  const service = new ProjectService(store, () => {});
  assert.throws(() => service.updateMemory(a.projectId, 0, { text: "乙的内容", sourceIds: [source.id] }), /当前范围/);
  for (let index = 0; index < 20; index++) service.updateMemory(a.projectId, index, { text: `约束${index}：${"字".repeat(1000)}` });
  const context = service.context(a.id);
  assert.ok(context.project!.memory.reduce((sum,item) => sum + item.text.length, 0) <= 7000);
  store.close();
});

test("legacy section rename/move/remove keeps stable project identity and revokes old project memory", async () => {
  const store = new OrbitStore(":memory:");
  const conversation = store.createConversation("首页", { project: "网站" });
  const sibling = store.createConversation("部署", { project: "网站" });
  const source = store.addMessage(conversation.id, "user", "第一版不做登录");
  const service = new ProjectService(store, () => {}, async raw => JSON.parse(raw).scope === "general" ? { items: [] } : { items: [{ kind: "decision", text: "第一版不做登录", sourceIds: [source.id] }] });
  const sections = new SectionService(store);
  const section = sections.list().find(section => section.name === "网站")!;
  await service.schedule(conversation.id);
  sections.update(section.id, { name: "个人网站", pinned: true });
  assert.equal(service.list().length, 1);
  assert.equal(store.require("conversations", conversation.id).projectId, conversation.projectId);
  assert.match(JSON.stringify(service.context(sibling.id)), /不做登录/);
  const destination = sections.ensure("旅行");
  sections.move(conversation.id, destination.id);
  service.list();
  assert.equal(store.require("conversations", conversation.id).project, "旅行");
  assert.notEqual(store.require("conversations", conversation.id).projectId, conversation.projectId);
  assert.doesNotMatch(JSON.stringify(service.context(sibling.id)), /不做登录/);
  sections.remove(section.id);
  assert.ok(!service.list().some(project => project.name === "个人网站"));
  await service.close(); store.close();
});

test("general memory sees one canonical user observation when home hands off into a project", async () => {
  const store = new OrbitStore(":memory:");
  const main = store.createConversation("Orbit", { id: "orbit-assistant", project: "Orbit" });
  const c = store.createConversation("首页", { project: "网站" });
  const original = store.addMessage(main.id, "user", "以后回答先讲结论");
  const copy = store.addMessage(c.id, "user", original.content);
  store.put("messages", { ...copy, handoff: { sourceConversationId: main.id, sourceMessageId: original.id, action: "new" } });
  let generalIds: string[] = [];
  let projectIds: string[] = [];
  const service = new ProjectService(store, () => {}, async raw => {
    const input = JSON.parse(raw);
    if (input.scope === "general") generalIds = input.messages.map((m: {id:string}) => m.id);
    else projectIds = input.messages.map((m: {id:string}) => m.id);
    return { items: [] };
  });
  await service.schedule(c.id);
  assert.deepEqual(generalIds, [original.id]);
  assert.deepEqual(projectIds, [copy.id]);
  await service.close(); store.close();
});

test("assistant suggestions cannot be promoted to a confirmed project decision", async () => {
  const store = new OrbitStore(":memory:");
  const c = store.createConversation("首页", { project: "网站" });
  store.addMessage(c.id, "user", "可以怎么做");
  const suggestion = store.addMessage(c.id, "assistant", "可以考虑做会员功能");
  const service = new ProjectService(store, () => {}, async raw => JSON.parse(raw).scope === "general" ? { items: [] } : { items: [{ kind: "decision", text: "决定做会员功能", sourceIds: [suggestion.id] }] });
  await service.schedule(c.id);
  assert.equal(service.getMemory(c.projectId).status, "failed");
  assert.equal(service.getMemory(c.projectId).items.length, 0);
  await service.close(); store.close();
});

test("interrupted consolidation preserves memory and exposes a retryable failure", () => {
  const store = new OrbitStore(":memory:");
  const service = new ProjectService(store, () => {});
  const memory = service.updateMemory(undefined, 0, { text: "回答简洁" });
  store.put("sharedMemories", { ...memory, status: "updating" });
  service.recover();
  assert.equal(service.getMemory().status, "failed");
  assert.equal(service.getMemory().items[0]?.text, "回答简洁");
  store.close();
});

test("store returns the same optional project shape it persists", () => {
  const store = new OrbitStore(":memory:");
  const c = store.createConversation("随问");
  assert.equal(Object.hasOwn(c, "projectId"), false);
  assert.deepEqual(store.require("conversations", c.id), c);
  const assigned = store.updateConversation(c.id, { project: "网站" });
  assert.ok(assigned.projectId);
  const detached = store.updateConversation(c.id, { projectId: undefined });
  assert.equal(Object.hasOwn(detached, "projectId"), false);
  assert.deepEqual(store.require("conversations", c.id), detached);
  store.close();
});

test("moving an existing discussion automatically consolidates the destination project", async () => {
  const store = new OrbitStore(":memory:");
  const original = store.createConversation("首页", { project: "旧项目" });
  const source = store.addMessage(original.id, "user", "首版不做登录");
  let finished!: () => void;
  const generated = new Promise<void>(resolve => { finished = resolve; });
  const service = new ProjectService(store, () => {}, async raw => {
    const input = JSON.parse(raw);
    assert.equal(input.scope, "project", "assignment only refreshes the destination scope");
    finished();
    return { items: [{ id: "login", kind: "decision", text: "首版不做登录", sourceIds: [source.id] }] };
  });
  const target = service.create({ name: "新项目" });
  const next = store.createConversation("上线", { projectId: target.id });
  service.assignConversation(original.id, target.id);
  await generated;
  // Await the already-enqueued scope job without launching a second generation.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(service.getMemory(target.id).status, "ready");
  assert.match(JSON.stringify(service.context(next.id)), /首版不做登录/);
  await service.close(); store.close();
});

test("long migrated history is consumed oldest-first in bounded batches before marking all evidence covered", async () => {
  const store = new OrbitStore(":memory:");
  const old = store.createConversation("早期决定", { project: "网站" });
  const source = store.addMessage(old.id, "user", "唯一关键约束：首版不做登录");
  const recent = store.createConversation("近期讨论", { project: "网站" });
  for (let index = 0; index < 170; index++) store.addMessage(recent.id, index % 2 ? "assistant" : "user", `普通讨论${index}`);
  const batches: string[][] = [];
  let firstBatchCommitted = false;
  const service: ProjectService = new ProjectService(store, () => {}, async raw => {
    const input = JSON.parse(raw);
    if (input.scope === "general") return { items: [] };
    batches.push(input.messages.map((message: { id: string }) => message.id));
    assert.ok(input.messages.length <= 160);
    assert.ok(input.messages.reduce((size: number, message: { content: string }) => size + message.content.length, 0) <= 32000);
    if (batches.length === 2) {
      assert.equal(service.getMemory(old.projectId).sourceKey, undefined, "partial consumption must not mark all history covered");
      assert.equal(service.getMemory(old.projectId).status, "updating");
      firstBatchCommitted = true;
    }
    return { items: input.messages.some((message: { id: string }) => message.id === source.id)
      ? [{ id: "login", kind: "decision", text: "首版不做登录", sourceIds: [source.id] }]
      : input.previous };
  });
  // Simulate the old truncated implementation's full-evidence marker without a cursor.
  const memory = service.getMemory(old.projectId);
  const oldHash = createHash("sha256").update(JSON.stringify(store.list("messages"))).digest("hex");
  store.put("sharedMemories", { ...memory, status: "ready", sourceKey: oldHash });
  await service.schedule(recent.id);
  assert.equal(firstBatchCommitted, true);
  assert.equal(batches[0]?.[0], source.id);
  assert.equal(new Set(batches.flat()).size, 171);
  assert.equal(service.getMemory(old.projectId).status, "ready");
  assert.match(JSON.stringify(service.context(recent.id)), /首版不做登录/);
  await service.schedule(old.id);
  assert.equal(batches.length, 2, "fully consumed history is idempotent");
  await service.close(); store.close();
});

test("long message suffixes are consumed and a failed later batch resumes from committed coverage", async () => {
  const store = new OrbitStore(":memory:");
  const c = store.createConversation("完整说明", { project: "网站" });
  const source = store.addMessage(c.id, "assistant", `${"说明".repeat(9000)}最后确认：采用静态页面`);
  const offsets: number[] = [];
  let fail = true;
  const service = new ProjectService(store, () => {}, async raw => {
    const input = JSON.parse(raw);
    if (input.scope === "general") return { items: [] };
    offsets.push(input.messages[0].fragmentStart);
    if (input.messages[0].fragmentStart === 8000 && fail) throw new Error("temporary failure");
    if (input.messages[0].content.includes("采用静态页面")) return { items: [{ id: "static", kind: "fact", text: "采用静态页面", sourceIds: [source.id] }] };
    return { items: input.previous };
  });
  await service.schedule(c.id);
  assert.equal(service.getMemory(c.projectId).status, "failed");
  assert.deepEqual(offsets, [0, 8000]);
  fail = false;
  await service.schedule(c.id);
  assert.deepEqual(offsets, [0, 8000, 8000, 16000]);
  assert.equal(service.getMemory(c.projectId).status, "ready");
  assert.match(JSON.stringify(service.context(c.id)), /采用静态页面/);
  await service.close(); store.close();
});

function documentFixture() {
  const directory = mkdtempSync(join(tmpdir(), "orbit-memory-document-"));
  const store = new OrbitStore(":memory:");
  const service = new ProjectService(store, () => {}, async () => ({ items: [] }), directory);
  return { directory, store, service, async close() {
    await service.close(); store.close(); rmSync(directory, { recursive: true, force: true });
  } };
}

test("every project and general scope has a real Markdown file, with exact whole-file editing and versions", async () => {
  const f = documentFixture();
  try {
    const project = f.service.create({ name: "网站" });
    const other = f.service.create({ name: "旅行" });
    f.service.recover();
    const general = f.service.readDocument();
    const initial = f.service.readDocument(project.id);
    assert.equal(general.path, join(f.directory, "memory", "general", "MEMORY.md"));
    assert.equal(initial.path, join(f.directory, "memory", "projects", project.id, "MEMORY.md"));
    assert.equal(readFileSync(initial.path, "utf8"), initial.content);
    assert.ok(existsSync(f.service.readDocument(other.id).path));
    const exact = "# 项目记忆\n\n- 首页先完成  \n\n```text\n保留  两个空格\n```\n\n";
    const saved = f.service.saveDocument(project.id, initial.version, exact);
    assert.equal(saved.content, exact);
    assert.equal(readFileSync(saved.path, "utf8"), exact);
    assert.equal(saved.version, initial.version + 1);
    assert.equal(saved.status, "ready");
    assert.throws(() => f.service.saveDocument(project.id, initial.version, "旧编辑"), /已更新/);
    assert.equal(f.service.readDocument(other.id).content, "# 旅行记忆\n");
    f.service.update(other.id, { name: "日本旅行" });
    assert.equal(f.service.readDocument(other.id).content, "# 日本旅行记忆\n");
    assert.equal(f.service.readDocument(project.id).content, exact);
    // User-authored general memory can include more than generated preferences.
    const userProfile = "# 背景\n\n正在学习网页开发。\n";
    f.service.saveDocument(undefined, general.version, userProfile);
    assert.equal(f.service.readDocument().content, userProfile);
  } finally { await f.close(); }
});

test("whole-file edits protect corrections and deletions while new evidence appends without duplicate context", async () => {
  const f = documentFixture();
  try {
    const c = f.store.createConversation("首页", { project: "网站" });
    const source = f.store.addMessage(c.id, "user", "首页使用红色");
    const old = { id: "color", kind: "decision", text: "首页使用红色", sourceIds: [source.id] };
    f.service.generate = async raw => ({ items: JSON.parse(raw).scope === "general" ? [] : [old] });
    await f.service.schedule(c.id);
    const initial = f.service.readDocument(c.projectId);
    assert.match(initial.content, /首页使用红色/);
    assert.equal(f.service.context(c.id).project?.document, undefined, "automatic document text must not be injected twice");
    const manual = "# 网站\n\n首页使用蓝色。\n";
    f.service.saveDocument(c.projectId, initial.version, manual);
    const next = f.store.addMessage(c.id, "user", "周五部署");
    let promptDocument = "";
    f.service.generate = async raw => {
      const input = JSON.parse(raw);
      if (input.scope === "general") return { items: [] };
      promptDocument = input.userDocument;
      return { items: [{ ...old, id: "reworded", text: "首页配色为红色" }, { id: "deploy", kind: "decision", text: "周五部署", sourceIds: [next.id] }] };
    };
    await f.service.schedule(c.id);
    const updated = f.service.readDocument(c.projectId);
    assert.equal(promptDocument, manual);
    assert.equal(updated.content, `${manual}\n- 周五部署\n`);
    assert.doesNotMatch(updated.content, /红色/);
    const context = f.service.context(c.id);
    assert.equal(context.project?.document, manual);
    assert.deepEqual(context.project?.memory.map(item => item.text), ["周五部署"]);
    f.service.saveDocument(c.projectId, updated.version, "");
    f.store.addMessage(c.id, "user", "继续");
    await f.service.schedule(c.id);
    assert.equal(f.service.readDocument(c.projectId).content, "", "deleted content must not be regenerated from its old sources");
  } finally { await f.close(); }
});

test("external file changes are imported separately per project and stale UI edits conflict", async () => {
  const f = documentFixture();
  try {
    const a = f.service.create({ name: "网站" });
    const b = f.service.create({ name: "旅行" });
    const ca = f.store.createConversation("首页", { projectId: a.id });
    const cb = f.store.createConversation("住宿", { projectId: b.id });
    const da = f.service.readDocument(a.id), db = f.service.readDocument(b.id);
    writeFileSync(da.path, "# 网站\n\n只做静态页面。\n");
    writeFileSync(db.path, "# 旅行\n\n住在车站附近。\n");
    assert.throws(() => f.service.saveDocument(a.id, da.version, "覆盖外部修改"), /已更新/);
    const ac = JSON.stringify(f.service.context(ca.id));
    const bc = JSON.stringify(f.service.context(cb.id));
    assert.match(ac, /只做静态页面/); assert.doesNotMatch(ac, /车站附近/);
    assert.match(bc, /车站附近/); assert.doesNotMatch(bc, /静态页面/);
    assert.equal(f.service.readDocument(a.id).version, da.version + 1);
    assert.equal(f.service.readDocument(b.id).version, db.version + 1);
    const large = "a".repeat(13000);
    f.service.saveDocument(a.id, f.service.readDocument(a.id).version, large);
    const context = f.service.context(ca.id).project!;
    assert.equal(context.document?.length, 2000);
    assert.equal(context.documentTruncated, true);
    assert.equal(context.documentPath, da.path);
    assert.equal(f.service.readDocument(a.id).content.length, 13000, "full file stays available beyond the context budget");
  } finally { await f.close(); }
});

test("an external edit during consolidation is imported before generation can overwrite it", async () => {
  const f = documentFixture();
  let release!: () => void;
  try {
    const c = f.store.createConversation("首页", { project: "网站" });
    const oldSource = f.store.addMessage(c.id, "user", "使用红色");
    const old = { id: "color", kind: "decision", text: "使用红色", sourceIds: [oldSource.id] };
    f.service.generate = async raw => ({ items: JSON.parse(raw).scope === "general" ? [] : [old] });
    await f.service.schedule(c.id);
    const doc = f.service.readDocument(c.projectId);
    const next = f.store.addMessage(c.id, "user", "周五部署");
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    let attempts = 0;
    f.service.generate = async raw => {
      if (JSON.parse(raw).scope === "general") return { items: [] };
      if (++attempts === 1) { entered(); await new Promise<void>(resolve => { release = resolve; }); }
      return { items: [old, { id: "deploy", kind: "decision", text: "周五部署", sourceIds: [next.id] }] };
    };
    const pending = f.service.schedule(c.id);
    await started;
    writeFileSync(doc.path, "# 网站\n\n使用蓝色。\n");
    release(); await pending;
    assert.equal(attempts, 2, "external edits invalidate the in-flight document revision");
    assert.equal(f.service.readDocument(c.projectId).content, "# 网站\n\n使用蓝色。\n\n- 周五部署\n");
    assert.equal(readFileSync(doc.path, "utf8"), f.service.readDocument(c.projectId).content);
  } finally { release?.(); await f.close(); }
});

test("a first-time new fact generated against an old document is discarded after a manual correction", async () => {
  const f = documentFixture();
  try {
    const c = f.store.createConversation("首页", { project: "网站" });
    const source = f.store.addMessage(c.id, "user", "使用红色");
    const doc = f.service.readDocument(c.projectId);
    let attempts = 0;
    f.service.generate = async raw => {
      const input = JSON.parse(raw);
      if (input.scope === "general") return { items: [] };
      assert.equal(input.messages[0].id, source.id, "the discarded attempt must not consume evidence");
      assert.equal(f.store.metadata(`shared-memory:coverage:v1:project:${c.projectId}`), undefined);
      if (++attempts === 1) {
        assert.equal(f.service.getMemory(c.projectId).items.length, 0, "this newly extracted fact has no old tombstone");
        f.service.saveDocument(c.projectId, doc.version, "# 网站\n\n使用蓝色。\n");
        return { items: [{ id: "new-color", kind: "decision", text: "使用红色", sourceIds: [source.id] }] };
      }
      assert.equal(input.userDocument, "# 网站\n\n使用蓝色。\n");
      return { items: [] };
    };
    await f.service.schedule(c.id);
    assert.equal(attempts, 2);
    assert.equal(f.service.readDocument(c.projectId).content, "# 网站\n\n使用蓝色。\n");
    assert.equal(f.service.getMemory(c.projectId).items.length, 0);
    assert.ok(f.service.getMemory(c.projectId).sourceKey, "only the refreshed generation can finish coverage");
  } finally { await f.close(); }
});

test("continuous document edits bound consolidation retries without marking unprocessed evidence covered", async () => {
  const f = documentFixture();
  try {
    const c = f.store.createConversation("首页", { project: "网站" });
    const source = f.store.addMessage(c.id, "user", "使用红色");
    let attempts = 0;
    f.service.generate = async raw => {
      if (JSON.parse(raw).scope === "general") return { items: [] };
      const current = f.service.readDocument(c.projectId);
      f.service.saveDocument(c.projectId, current.version, `# 网站\n\n使用蓝色，修订 ${++attempts}。\n`);
      return { items: [{ id: "new-color", kind: "decision", text: "使用红色", sourceIds: [source.id] }] };
    };
    await f.service.schedule(c.id);
    assert.equal(attempts, 3);
    assert.equal(f.service.getMemory(c.projectId).status, "failed");
    assert.equal(f.service.readDocument(c.projectId).error, "整理期间文件持续更新，请稍后重新整理。");
    assert.equal(f.service.getMemory(c.projectId).sourceKey, undefined);
    assert.equal(f.store.metadata(`shared-memory:coverage:v1:project:${c.projectId}`), undefined);
    assert.equal(f.service.readDocument(c.projectId).content, "# 网站\n\n使用蓝色，修订 3。\n");
    f.service.generate = async raw => {
      const input = JSON.parse(raw);
      assert.equal(input.userDocument, "# 网站\n\n使用蓝色，修订 3。\n");
      assert.equal(input.messages[0].id, source.id);
      return { items: [] };
    };
    await f.service.schedule(c.id);
    assert.equal(f.service.getMemory(c.projectId).status, "ready");
    assert.ok(f.service.getMemory(c.projectId).sourceKey);
  } finally { await f.close(); }
});

test("source revocation removes automatic file contents and existing files without metadata are preserved", async () => {
  const f = documentFixture();
  try {
    const c = f.store.createConversation("首页", { project: "网站" });
    const source = f.store.addMessage(c.id, "user", "首版不做登录");
    f.service.generate = async raw => ({ items: JSON.parse(raw).scope === "general" ? [] : [{ id: "login", kind: "decision", text: "首版不做登录", sourceIds: [source.id] }] });
    await f.service.schedule(c.id);
    const oldPath = f.service.readDocument(c.projectId).path;
    f.service.assignConversation(c.id, null);
    assert.doesNotMatch(readFileSync(oldPath, "utf8"), /不做登录/);
    const dir = join(f.directory, "memory", "general");
    f.store.db.prepare("DELETE FROM metadata WHERE key=?").run("shared-memory:document:v1:general");
    mkdirSync(dir, { recursive: true });
    const authored = "# 我的背景\n\n  完整保留原有正文。  \n";
    writeFileSync(join(dir, "MEMORY.md"), authored);
    f.service.recover();
    assert.equal(f.service.readDocument().content, authored);
    assert.equal(readFileSync(join(dir, "MEMORY.md"), "utf8"), authored);
  } finally { await f.close(); }
});

test("echoed existing protected IDs are retained by the host while new source-free generated entries still fail", async () => {
  const store = new OrbitStore(":memory:");
  const c = store.createConversation("首页", { project: "网站" });
  const source = store.addMessage(c.id, "user", "首版不做登录");
  const service = new ProjectService(store, () => {}, async () => ({ items: [] }));
  try {
    const general = service.updateMemory(undefined, 0, { text: "回答先给结论" }).items[0]!;
    const project = service.updateMemory(c.projectId, 0, { text: "保留人工确认的约束" }).items[0]!;
    service.generate = async raw => {
      const input = JSON.parse(raw);
      return { items: [...input.previous.map((item: { id: string }) => ({ ...item, text: "模型误回显并改写的内容", sourceIds: [] })), ...(input.scope === "project" ? [{ id: "login", kind: "decision", text: "首版不做登录", sourceIds: [source.id] }] : [])] };
    };
    await service.schedule(c.id);
    assert.equal(service.getMemory().status, "ready");
    assert.deepEqual(service.getMemory().items, [general]);
    assert.equal(service.getMemory(c.projectId).status, "ready");
    assert.deepEqual(service.getMemory(c.projectId).items.find(item => item.id === project.id), project);
    assert.equal(service.getMemory(c.projectId).items.find(item => item.id === "login")?.text, "首版不做登录");
    store.addMessage(c.id, "user", "接下来讨论部署");
    service.generate = async raw => {
      const input = JSON.parse(raw);
      return { items: [...input.previous, { id: "new-source-free", kind: input.scope === "general" ? "preference" : "fact", text: "没有原文证据的新增内容", sourceIds: [], edited: true }] };
    };
    await service.schedule(c.id);
    assert.equal(service.getMemory().status, "failed");
    assert.equal(service.getMemory(c.projectId).status, "failed");
    assert.deepEqual(service.getMemory().items, [general]);
    assert.doesNotMatch(JSON.stringify(service.getMemory(c.projectId).items), /没有原文证据/);
  } finally { await service.close(); store.close(); }
});

test("layered Markdown keeps core intact, indexes concise and raw excerpts explicitly identified", async () => {
  const f = documentFixture();
  try {
    const a = f.service.create({ name: "网站", summary: "先做公开的个人作品页面" });
    const b = f.service.create({ name: "旅行", summary: "OTHER_PROJECT_SUMMARY" });
    const c = f.store.createConversation("首页结构", { projectId: a.id });
    const user = f.store.addMessage(c.id, "user", "首屏先展示作品吗？");
    const reply = f.store.addMessage(c.id, "assistant", "RAW_ASSISTANT_DETAIL：可以先比较两种布局。尚未实现。".repeat(80));
    const initial = f.service.readDocument(a.id);
    const core = "# 网站记忆\n\n保留原有 Markdown。  \n";
    f.service.saveDocument(a.id, initial.version, core);
    f.service.recover();
    const files = f.service.listFiles(a.id);
    assert.deepEqual(files.map(file => file.name), ["MEMORY.md", "INDEX.md", `recaps/${c.id}.md`]);
    assert.equal(files[0]?.readonly, false);
    assert.ok(files.slice(1).every(file => file.readonly));
    assert.equal(f.service.readFile(a.id).content, core);
    const index = f.service.readFile(a.id, "INDEX.md");
    assert.match(index.content, /最近提问（原文摘录）/);
    assert.match(index.content, /首屏先展示作品吗/);
    assert.doesNotMatch(index.content, /RAW_ASSISTANT_DETAIL|OTHER_PROJECT_SUMMARY/);
    assert.equal(readFileSync(index.path, "utf8"), index.content);
    const recap = f.service.readFile(a.id, `recaps/${c.id}.md`);
    assert.match(recap.content, /原文摘录/);
    assert.match(recap.content, /原文已截短/);
    assert.ok(recap.content.includes(user.id) && recap.content.includes(reply.id));
    assert.equal(readFileSync(recap.path, "utf8"), recap.content);
    const global = f.service.readFile(undefined, "INDEX.md");
    assert.match(global.content, /OTHER_PROJECT_SUMMARY/);
    assert.doesNotMatch(global.content, /RAW_ASSISTANT_DETAIL|首屏先展示作品/);
    const scopedGlobal = f.service.readFile(undefined, "INDEX.md", { projectId: a.id });
    assert.doesNotMatch(scopedGlobal.content, /OTHER_PROJECT_SUMMARY/);
    assert.equal(readFileSync(global.path, "utf8"), global.content, "scoped reads must not overwrite the owner's complete index");
    assert.throws(() => f.service.readFile(b.id, "INDEX.md", { projectId: a.id }), /当前项目/);
    assert.doesNotMatch(JSON.stringify(f.service.context(c.id)), /RAW_ASSISTANT_DETAIL|OTHER_PROJECT_SUMMARY/);
    assert.equal(f.service.readDocument(a.id).content, core);
  } finally { await f.close(); }
});

test("derived recaps reuse only current sources and fall back after edited or deleted original messages", async () => {
  const f = documentFixture();
  try {
    const c = f.store.createConversation("首页", { project: "网站" });
    const user = f.store.addMessage(c.id, "user", "首屏先放作品");
    const reply = f.store.addMessage(c.id, "assistant", "可以按作品、介绍、联系来组织。");
    const source = recapSource(c.id, f.store.list("messages"), f.store.list("conversations"));
    f.store.put("memories", { id: c.id, conversationId: c.id, version: 0, status: "ready", summary: "UNVERIFIED_LEGACY_SUMMARY", items: [], updatedAt: c.updatedAt,
      recap: { sourceKey: source.key, nodes: [{ id: "node", roundIds: [user.id], title: "首页结构", summary: "VALID_RECAP_SUMMARY：先突出作品" }] } });
    const name = `recaps/${c.id}.md`;
    assert.match(f.service.readFile(c.projectId, name).content, /VALID_RECAP_SUMMARY/);
    assert.doesNotMatch(f.service.readFile(c.projectId, name).content, /UNVERIFIED_LEGACY_SUMMARY/);
    f.store.put("messages", { ...user, content: "改为先介绍个人背景" });
    const changed = f.service.readFile(c.projectId, name);
    assert.doesNotMatch(changed.content, /VALID_RECAP_SUMMARY|UNVERIFIED_LEGACY_SUMMARY/);
    assert.match(changed.content, /改为先介绍个人背景|原文摘录/);
    const round = conversationRounds(c.id, f.store.list("messages"))[0]!;
    const memory = f.store.require("memories", c.id);
    f.store.put("memories", { ...memory, discussion: { version: 1, status: "ready", turns: [{ id: round.id, sourceKey: round.sourceKey, question: "首页顺序", answer: "VALID_TURN_SUMMARY" }] } });
    assert.match(f.service.readFile(c.projectId, name).content, /VALID_TURN_SUMMARY/);
    f.store.db.prepare("DELETE FROM messages WHERE id IN (?,?)").run(user.id, reply.id);
    const removed = f.service.readFile(c.projectId, name);
    assert.doesNotMatch(removed.content, /VALID_RECAP_SUMMARY|VALID_TURN_SUMMARY|先介绍个人背景/);
    assert.match(removed.content, /尚无讨论内容/);
    assert.equal(readFileSync(removed.path, "utf8"), removed.content);
  } finally { await f.close(); }
});

test("legacy conversation moves and deletions revoke old recap paths without touching authored core memory", async () => {
  const f = documentFixture();
  try {
    const c = f.store.createConversation("首页", { project: "网站" });
    f.store.addMessage(c.id, "user", "EXCLUSIVE_SITE_SOURCE");
    const target = f.service.create({ name: "旅行" });
    const core = f.service.readDocument(c.projectId);
    f.service.saveDocument(c.projectId, core.version, "用户维护的项目正文\n");
    const name = `recaps/${c.id}.md`;
    const old = f.service.readFile(c.projectId, name);
    f.store.updateConversation(c.id, { project: target.name });
    assert.throws(() => f.service.readFile(c.projectId, name), /移出项目|删除/);
    assert.equal(existsSync(old.path), false);
    assert.doesNotMatch(f.service.readFile(c.projectId, "INDEX.md").content, /EXCLUSIVE_SITE_SOURCE/);
    const moved = f.service.readFile(target.id, name);
    assert.match(moved.content, /EXCLUSIVE_SITE_SOURCE/);
    assert.equal(f.service.readDocument(c.projectId).content, "用户维护的项目正文\n");
    f.store.deleteConversation(c.id);
    f.service.listFiles(target.id);
    assert.equal(existsSync(moved.path), false);
    assert.throws(() => f.service.readFile(target.id, name), /移出项目|删除/);
  } finally { await f.close(); }
});

test("file selectors reject traversal, cross-scope recap IDs and symlinks", async () => {
  const f = documentFixture();
  try {
    const a = f.service.create({ name: "网站" }), b = f.service.create({ name: "旅行" });
    const foreign = f.store.createConversation("住宿", { projectId: b.id });
    for (const name of ["../MEMORY.md", "recaps/../../MEMORY.md", "/etc/passwd", "recaps\\x.md", "%2e%2e/MEMORY.md", "recaps/x.md/extra"]) {
      assert.throws(() => f.service.readFile(a.id, name), /路径无效/);
    }
    assert.throws(() => f.service.readFile(a.id, `recaps/${foreign.id}.md`), /移出项目|删除/);
    assert.throws(() => f.service.readFile(undefined, `recaps/${foreign.id}.md`), /不保存项目/);
    const path = f.service.readDocument(a.id).path;
    const external = join(f.directory, "outside.md");
    writeFileSync(external, "OUTSIDE_FILE"); rmSync(path); symlinkSync(external, path);
    assert.throws(() => f.service.readFile(a.id), /符号链接/);
    assert.equal(readFileSync(external, "utf8"), "OUTSIDE_FILE");
  } finally { await f.close(); }
});

test("short resident core marks truncation and tracks edits beyond the excerpt without loading recaps", async () => {
  const f = documentFixture();
  try {
    const c = f.store.createConversation("首页", { project: "网站" });
    f.store.addMessage(c.id, "user", "HISTORY_SHOULD_LOAD_ON_DEMAND");
    const general = f.service.readDocument(), project = f.service.readDocument(c.projectId);
    f.service.saveDocument(undefined, general.version, "通用".repeat(1500));
    const first = f.service.saveDocument(c.projectId, project.version, "项目".repeat(1500) + "TAIL_ORIGINAL");
    const context = f.service.context(c.id);
    assert.equal(context.generalDocument?.length, 1000);
    assert.equal(context.project?.document?.length, 2000);
    assert.equal(context.generalDocumentTruncated, true);
    assert.equal(context.project?.documentTruncated, true);
    assert.match(context.retrieval!.instruction, /INDEX.md/);
    assert.doesNotMatch(JSON.stringify(context), /HISTORY_SHOULD_LOAD_ON_DEMAND|TAIL_ORIGINAL/);
    f.service.saveDocument(c.projectId, first.version, "项目".repeat(1500) + "TAIL_CORRECTED");
    assert.notEqual(f.service.context(c.id).revision, context.revision);
    assert.match(f.service.readFile(c.projectId).content, /TAIL_CORRECTED/);
  } finally { await f.close(); }
});
