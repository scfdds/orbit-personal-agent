import test from "node:test";
import assert from "node:assert/strict";
import type { Conversation } from "./types.ts";
import { buildMatterGroups, findMatterGroup } from "./matter-groups.ts";

function conversation(id: string, patch: Partial<Conversation> = {}): Conversation {
  return { id, title: id, project: "日常随问", pinned: false, archived: false,
    goal: "", status: "idle", summary: "", continuous: false, unread: false,
    createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", panel: null,
    ...patch };
}

test("specific projects group discussions while navigation buckets keep unrelated matters separate", () => {
  const conversations = [
    conversation("main", { project: "Orbit" }),
    conversation("compare", { project: "3D 学习" }),
    conversation("sdf", { project: "3D 学习", updatedAt: "2026-10-10T00:00:00Z" }),
    conversation("website", { project: "体验示例" }),
    conversation("travel", { project: "体验示例" }),
    conversation("casual", { project: "日常随问" }),
    conversation("casual-2", { project: "日常随问" }),
  ];
  const before = JSON.stringify(conversations);
  const groups = buildMatterGroups(conversations, "main");
  assert.equal(groups.length, 5);
  assert.equal(groups[0]!.title, "3D 学习");
  assert.deepEqual(groups[0]!.conversations.map(item => item.id), ["compare", "sdf"]);
  assert.equal(findMatterGroup(groups, "main"), undefined);
  assert.notEqual(findMatterGroup(groups, "website")!.id, findMatterGroup(groups, "travel")!.id);
  assert.equal(JSON.stringify(conversations), before);
});

test("branches follow their root even after changing project, with archived roots hidden", () => {
  const groups = buildMatterGroups([
    conversation("root", { title: "Learning", project: "未分区", archived: true }),
    conversation("branch", { parentId: "root", project: "Another topic" }),
    conversation("leaf", { parentId: "branch", project: "Yet another topic" }),
  ], "main");
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.id, "thread:root");
  assert.equal(groups[0]!.title, "Learning");
  assert.deepEqual(groups[0]!.conversations.map(item => item.id), ["branch", "leaf"]);
});

test("explicit matter links keep new blank discussions available, without showing standalone drafts", () => {
  const groups = buildMatterGroups([
    conversation("example", { matterId: "thread:example", matterTitle: "客户方案", project: "体验示例", showcase: {title:"示例",period:"",notice:""} }),
    conversation("new-discussion", { draft: true, matterId: "thread:example", matterTitle: "客户方案", project: "体验示例" }),
    conversation("draft", { draft: true }),
    conversation("archived", { matterId: "thread:example", archived: true }),
    conversation("branch", { draft: true, parentId: "new-discussion" }),
  ], "main");
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.title, "客户方案");
  assert.equal(groups[0]!.example, false);
  assert.deepEqual(groups[0]!.conversations.map(item => item.id), ["branch", "example", "new-discussion"]);
});

test("cyclic and missing ancestry stays bounded and deterministic", () => {
  const groups = buildMatterGroups([
    conversation("b", { parentId: "a" }), conversation("a", { parentId: "b" }),
    conversation("orphan", { parentId: "missing" }),
  ], "main");
  assert.equal(groups.length, 2);
  assert.equal(findMatterGroup(groups, "b")!.id, "thread:a");
  assert.equal(findMatterGroup(groups, "a")!.id, "thread:a");
  assert.equal(findMatterGroup(groups, "orphan")!.id, "thread:orphan");
});
