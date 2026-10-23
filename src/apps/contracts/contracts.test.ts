import test from "node:test";
import assert from "node:assert/strict";
import mammoth from "mammoth";
import { once } from "node:events";
import { createOrbitServer } from "../../server/http.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { OrbitStore } from "../../server/store.ts";
import { OrbitRuntime } from "../../server/runtime.ts";
import { loadApps } from "../registry.ts";
import app from "./index.ts";
import {
  importContract,
  revisedClauses,
  contractDocx,
  changeLog,
  sampleContract,
  type ContractData,
} from "./data.ts";

test("contract suggestions use exact evidence, keep user decisions, reject stale writes and enforce read-only children", async () => {
  const store = new OrbitStore(":memory:");
  const runtime = new OrbitRuntime(
    store,
    await loadApps(),
    "/tmp/orbit-contract-test",
  );
  runtime.seed();
  const context = runtime.appContext("work-notes");
  let object = context.getObjects("contracts")[0]!;
  const imported = importContract(sampleContract, "测试合同", "sample");
  object = context.saveObject({
    ...object,
    expectedVersion: object.version,
    data: imported as unknown as Record<string, unknown>,
  });
  const clause = imported.clauses.find((c) =>
    c.text.includes("单方面调整费用"),
  )!;
  const input = {
    clauseId: clause.id,
    original: clause.text,
    proposed: "第三条 服务费用\n固定人民币 30,000 元，变更须双方书面确认。",
    reason: "按用户要求，不接受单方涨价。",
  };
  const tool = app
    .createTools(context)
    .find((t) => t.name === "contract_propose")!;
  const invoke = (args: unknown) =>
    tool.execute(
      "test",
      args as never,
      undefined,
      undefined,
      {} as ExtensionContext,
    );
  try {
    await assert.rejects(
      invoke({
        objectId: object.id,
        expectedVersion: object.version,
        suggestions: [{ ...input, original: "伪造原文" }],
      }),
      /准确引用/,
    );
    await invoke({
      objectId: object.id,
      expectedVersion: object.version,
      suggestions: [input],
    });
    await assert.rejects(
      invoke({
        objectId: object.id,
        expectedVersion: object.version,
        suggestions: [input],
      }),
      /版本冲突/,
    );
    object = context.getObject(object.id)!;
    let data = object.data as unknown as ContractData;
    assert.equal(data.suggestions[0]!.status, "pending");
    assert.equal(
      revisedClauses(data).find((c) => c.id === clause.id)!.text,
      clause.text,
    );
    object = context.saveObject({
      ...object,
      expectedVersion: object.version,
      data: {
        ...data,
        suggestions: data.suggestions.map((s) => ({
          ...s,
          proposed: input.proposed + " 付款另按第四条约定。",
          status: "accepted",
          editedByUser: true,
        })),
      },
    });
    data = object.data as unknown as ContractData;
    await assert.rejects(
      invoke({
        objectId: object.id,
        expectedVersion: object.version,
        suggestions: [input],
      }),
      /用户决定/,
    );
    assert.match(
      revisedClauses(data).find((c) => c.id === clause.id)!.text,
      /付款另按第四条/,
    );
    assert.deepEqual(
      app
        .createTools(runtime.appContext("work-notes", true))
        .map((t) => t.name),
      ["contract_read"],
    );
    context.readOnly = true;
    await assert.rejects(
      invoke({
        objectId: object.id,
        expectedVersion: object.version,
        suggestions: [input],
      }),
      /只读/,
    );
    context.readOnly = false;
    assert.throws(
      () =>
        context.saveObject({
          ...object,
          expectedVersion: object.version,
          data: { ...data, clauses: [{ id: "C001", text: "覆盖原文" }] },
        }),
      /准确引用|保持不变/,
    );
    const outside = runtime.appContext("work-feedback");
    const read = app.createTools(outside)[0]!;
    await assert.rejects(
      read.execute(
        "test",
        { objectId: object.id },
        undefined,
        undefined,
        {} as ExtensionContext,
      ),
      /没有合同/,
    );
  } finally {
    await runtime.close();
    store.close();
  }
});

test("DOCX export contains accepted edits only and round-trips as actual document text", async () => {
  const data = importContract(
    "第一条\n原始付款约定。\n\n第二条\n原始交付约定。\n\n第三条\n原始保密约定。",
    "导出验证",
    "paste",
  );
  data.suggestions = data.clauses.map((c, i) => ({
    id: `s${i}`,
    clauseId: c.id,
    original: c.text,
    proposed: [
      "已采用的付款修订。",
      "待确认的交付修订。",
      "已忽略的保密修订。",
    ][i]!,
    reason: "根据审阅要求",
    status: (["accepted", "pending", "rejected"] as const)[i]!,
  }));
  const blob = await contractDocx(data);
  const result = await mammoth.extractRawText({
    buffer: Buffer.from(await blob.arrayBuffer()),
  });
  assert.match(result.value, /已采用的付款修订/);
  assert.match(result.value, /原始交付约定/);
  assert.match(result.value, /原始保密约定/);
  assert.doesNotMatch(
    result.value,
    /原始付款约定|待确认的交付修订|已忽略的保密修订/,
  );
  assert.match(changeLog(data), /已采用/);
  assert.match(changeLog(data), /待确认（保留原文）/);
  assert.throws(() => importContract(" ", "空文件", "paste"), /没有识别/);
  assert.throws(
    () => importContract("字".repeat(50001), "长文件", "paste"),
    /5 万字/,
  );
});

test("app download endpoint returns real files from current decisions with a scoped attachment response", async () => {
  const store = new OrbitStore(":memory:");
  const runtime = new OrbitRuntime(store, await loadApps(), "/tmp/orbit-contract-download");
  runtime.seed();
  const server = createOrbitServer(runtime);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/conversations/work-notes/apps/contracts/export`;
  try {
    assert.equal((await fetch(base + "/docx")).status, 400);
    const ctx = runtime.appContext("work-notes");
    const object = ctx.getObjects("contracts")[0]!;
    const data = importContract("第一条\n测试合同原文。", "示例合同", "paste");
    ctx.saveObject({ ...object, expectedVersion: object.version, data: data as unknown as Record<string, unknown> });
    const response = await fetch(base + "/docx");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-disposition")!, /attachment;.*filename\*=UTF-8/);
    const text = await mammoth.extractRawText({ buffer: Buffer.from(await response.arrayBuffer()) });
    assert.match(text.value, /测试合同原文/);
    assert.match(await (await fetch(base + "/md")).text(), /变更清单/);
    assert.equal((await fetch(base + "/pdf")).status, 400);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await runtime.close(); store.close();
  }
});
