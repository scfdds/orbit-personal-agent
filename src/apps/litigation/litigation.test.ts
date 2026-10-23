import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AppContext } from "../../shared/plugin.ts";
import type { AppObject } from "../../shared/types.ts";
import app, { validateLitigationObject } from "./index.ts";
import { emptyLitigation, sampleLitigation, validateLitigationData, preparationMarkdown, type LitigationData } from "./data.ts";

const record = (data: LitigationData) => data as unknown as Record<string, unknown>;
function harness(data = sampleLitigation()) {
  let object: AppObject = { id: "case-1", appId: "litigation", type: "litigation-case", conversationId: "conversation-1", title: data.title, data: record(data), version: 1, updatedAt: new Date().toISOString() };
  const context: AppContext = {
    conversationId: "conversation-1", readOnly: false,
    getObjects: (appId) => !appId || appId === object.appId ? [object] : [],
    getObject: (id) => id === object.id ? object : undefined,
    saveObject(input) {
      assert.equal(input.expectedVersion, object.version);
      assert.equal(input.appId, "litigation");
      validateLitigationObject(input.data, input.type);
      object = { ...object, title: input.title, data: input.data, version: object.version + 1 };
      return object;
    }, openPanel() {}, recordActivity() {},
  };
  const invoke = (name: string, params: unknown) => app.createTools(context).find((tool) => tool.name === name)!.execute("test", params as never, undefined, undefined, {} as ExtensionContext);
  return { context, invoke, get: () => object, replace: (next: AppObject) => { object = next; } };
}

test("litigation validates references, unique IDs, real dates and material readiness", () => {
  assert.doesNotThrow(() => validateLitigationData(record(emptyLitigation())));
  assert.doesNotThrow(() => validateLitigationData(record(sampleLitigation())));
  const invalidReference = sampleLitigation(); invalidReference.events[0]!.evidenceIds = ["E999"];
  assert.throws(() => validateLitigationData(record(invalidReference)), /关联的证据不存在/);
  const duplicate = sampleLitigation(); duplicate.evidence.push({ ...duplicate.evidence[0]! });
  assert.throws(() => validateLitigationData(record(duplicate)), /编号不能重复/);
  const impossibleDate = sampleLitigation(); impossibleDate.events[0]!.date = "2026-02-31";
  assert.throws(() => validateLitigationData(record(impossibleDate)), /有效日期/);
  const unready = sampleLitigation(); unready.checklist[2]!.ready = true;
  assert.throws(() => validateLitigationData(record(unready)), /仍待补充/);
  assert.throws(() => validateLitigationObject(record(sampleLitigation()), "feedback-inbox"), /对象类型/);
});

test("incremental litigation tools preserve user edits and reject stale updates", async () => {
  const h = harness();
  const userData = sampleLitigation(); userData.evidence[0]!.userEdited = true; userData.evidence[0]!.description = "我已核对过签署页，保持这个描述";
  h.replace({ ...h.get(), data: record(userData) });
  await h.invoke("litigation_update", { objectId: "case-1", expectedVersion: 1, reviewNotes: "E003 尚缺完整邮件与附件，需补充原始记录。" });
  assert.equal((h.get().data as unknown as LitigationData).evidence[0]!.description, "我已核对过签署页，保持这个描述");
  assert.equal(h.get().version, 2);
  await assert.rejects(h.invoke("litigation_update", { objectId: "case-1", expectedVersion: 1, reviewNotes: "过期内容" }), /版本冲突/);
  const { userEdited: _edited, ...protectedEvidence } = userData.evidence[0]!;
  await assert.rejects(h.invoke("litigation_update", { objectId: "case-1", expectedVersion: 2, evidence: [{ ...protectedEvidence, description: "覆盖用户" }] }), /已由用户编辑/);
  await h.invoke("litigation_update", { objectId: "case-1", expectedVersion: 2, evidence: [{ title: "后续沟通记录", kind: "沟通 / 交付记录", source: "用户已提供的文字", description: "待核对原始聊天内容", status: "missing" }] });
  const after = h.get().data as unknown as LitigationData;
  assert.equal(after.evidence.length, 4);
  assert.equal(after.evidence[3]!.id, "E004");
  assert.equal(after.events.length, 3);
  assert.equal(after.evidence[0]!.userEdited, true);
  const oldVersion = h.get().version;
  await assert.rejects(h.invoke("litigation_update", { objectId: "case-1", expectedVersion: oldVersion, events: [{ title: "新事实", date: "", detail: "未知证据", evidenceIds: ["E998"] }] }), /证据不存在/);
  assert.equal(h.get().version, oldVersion);
});

test("read and export enforce conversation, app and type ownership; subagents cannot write", async () => {
  const h = harness();
  h.context.readOnly = true;
  assert.deepEqual(app.createTools(h.context).map((tool) => tool.name), ["litigation_read"]);
  h.context.readOnly = false;
  const update = app.createTools(h.context).find((tool) => tool.name === "litigation_update")!;
  h.context.readOnly = true;
  await assert.rejects(update.execute("test", { objectId: "case-1", expectedVersion: 1, reviewNotes: "不能写" }, undefined, undefined, {} as ExtensionContext), /只读/);
  h.context.readOnly = false;
  for (const patch of [{ conversationId: "someone-else" }, { appId: "contracts" }, { type: "wrong-case" }]) {
    h.replace({ ...h.get(), appId: "litigation", type: "litigation-case", conversationId: "conversation-1", ...patch });
    await assert.rejects(h.invoke("litigation_read", { objectId: "case-1" }), /当前对话/);
    await assert.rejects(app.exportFile!(h.context, "md"), /当前对话/);
  }
});

test("empty case creation is real data and does not insert sample evidence", async () => {
  const h = harness(emptyLitigation());
  await assert.rejects(app.exportFile!(h.context, "md"), /先建立/);
  await h.invoke("litigation_update", { objectId: "case-1", expectedVersion: 1, title: "用户案件", summary: "用户提供的事实", objective: "整理资料" });
  const data = h.get().data as unknown as LitigationData;
  assert.equal(data.source, "user");
  assert.deepEqual(data.evidence, []);
  h.replace({ ...h.get(), data: record({ ...data, userEdited: true, summary: "用户新修改" }) });
  await assert.rejects(h.invoke("litigation_update", { objectId: "case-1", expectedVersion: 2, summary: "覆盖" }), /概况已由用户编辑/);
  await h.invoke("litigation_update", { objectId: "case-1", expectedVersion: 2, reviewNotes: "已读用户新修改" });
  assert.equal((h.get().data as unknown as LitigationData).summary, "用户新修改");
});

test("Markdown preparation export includes original facts, evidence links and missing items", async () => {
  const data = sampleLitigation();
  const markdown = preparationMarkdown(data);
  assert.match(markdown, /虚构示例/);
  assert.match(markdown, /2026-08-28.*发送设计成果/);
  assert.match(markdown, /对应材料：E003 交付邮件与修改反馈/);
  assert.match(markdown, /状态：待补充/);
  assert.match(markdown, /不代表向法院提交/);
  const h = harness(data);
  const exported = await app.exportFile!(h.context, "md");
  assert.equal(exported.content, markdown);
  assert.match(exported.filename, /材料准备稿\.md$/);
  assert.equal(exported.contentType, "text/markdown; charset=utf-8");
  await assert.rejects(app.exportFile!(h.context, "pdf"), /目前支持/);
});
