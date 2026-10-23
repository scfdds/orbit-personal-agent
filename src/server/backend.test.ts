import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { Agent, get } from "node:http";
import { OrbitStore, HttpError, now } from "./store.ts";
import { OrbitRuntime } from "./runtime.ts";
import { createOrbitServer } from "./http.ts";
import { loadApps } from "../apps/registry.ts";
import type { Snapshot } from "../shared/types.ts";
import type {
  AgentSession,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

test("object versions reject lost updates and cross-work mutation; persisted state recovers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "orbit-store-"));
  let store = new OrbitStore(join(dir, "orbit.sqlite"));
  try {
    const first = store.createConversation("first");
    const second = store.createConversation("second");
    const object = store.saveObject(first.id, {
      appId: "a",
      type: "sample",
      title: "test",
      data: { n: 1 },
    });
    const edited = store.saveObject(first.id, {
      ...object,
      expectedVersion: 1,
      data: { n: 2 },
    });
    assert.equal(edited.version, 2);
    assert.throws(
      () =>
        store.saveObject(first.id, {
          ...object,
          expectedVersion: 1,
          data: { n: 3 },
        }),
      (error: unknown) => error instanceof HttpError && error.status === 409,
    );
    assert.throws(
      () =>
        store.saveObject(second.id, {
          ...object,
          expectedVersion: 2,
          data: {},
        }),
      (error: unknown) => error instanceof HttpError && error.status === 403,
    );
    store.updateConversation(first.id, { status: "running" });
    store.put("runs", {
      id: "active",
      conversationId: first.id,
      parentId: null,
      title: "run",
      status: "running",
      startedAt: now(),
      summary: "",
    });
    store.close();
    store = new OrbitStore(join(dir, "orbit.sqlite"));
    store.recoverInterrupted();
    assert.equal(store.require("objects", object.id).data.n, 2);
    assert.equal(store.require("runs", "active").status, "interrupted");
    assert.equal(store.require("conversations", first.id).status, "paused");
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("HTTP persistence, scoped reset, optimistic edits, trigger pause and origin boundary", async () => {
  const store = new OrbitStore(":memory:");
  const runtime = new OrbitRuntime(
    store,
    await loadApps(),
    "/tmp/orbit-test-no-model",
  );
  runtime.initialize();
  // Observe persisted dispatch without spending model calls in deterministic tests.
  const dispatched: string[] = [];
  runtime.pump = (conversationId) => {
    dispatched.push(conversationId);
  };
  const server = createOrbitServer(runtime);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const request = (
    path: string,
    method = "GET",
    value?: unknown,
    headers?: Record<string, string>,
  ) =>
    fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...headers },
      ...(value !== undefined ? { body: JSON.stringify(value) } : {}),
    });
  try {
    const snapshot = (await (await request("/api/state")).json()) as Snapshot;
    assert.deepEqual(snapshot.apps.map(app => app.id).sort(), runtime.apps.map(app => app.manifest.id).sort());
    assert.equal(snapshot.messages.length, 0);
    assert.equal(snapshot.runs.length, 0);
    const deviceResponse = await request("/api/devices/local");
    assert.equal(deviceResponse.status, 200);
    assert.equal(deviceResponse.headers.get("cache-control"), "no-store");
    const device = await deviceResponse.json();
    assert.deepEqual(Object.keys(device).sort(), ["id", "name", "platform", "workspaceRoot"]);
    assert.equal(device.id, "local");
    assert.equal(device.name, hostname());
    assert.equal(device.workspaceRoot, resolve(runtime.dataDir, "workspaces"));
    assert.equal(typeof device.platform, "string");
    assert.equal((await request("/api/devices/local", "GET", undefined, { origin: "https://example.com" })).status, 403);
    const work = (await (
      await request("/api/conversations", "POST", { title: "Keep my work" })
    ).json()) as { id: string };
    const object = snapshot.objects.find(
      (object) => object.appId === "opportunities",
    )!;
    const newData = { ...object.data, focus: "先改善现有功能" };
    assert.equal(
      (
        await request(`/api/objects/${object.id}`, "PATCH", {
          version: object.version,
          data: newData,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request(`/api/objects/${object.id}`, "PATCH", {
          version: object.version,
          data: newData,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request(`/api/objects/${object.id}`, "PATCH", {
          version: 2,
          data: { items: [], focus: 42 },
        })
      ).status,
      400,
    );
    const invalidEvidence = structuredClone(newData) as {
      items: Array<{ feedbackIds: string[] }>;
      focus: string;
    };
    invalidEvidence.items[0]!.feedbackIds = ["F999"];
    assert.equal(
      (
        await request(`/api/objects/${object.id}`, "PATCH", {
          version: 2,
          data: invalidEvidence,
        })
      ).status,
      400,
    );
    assert.equal(
      store.require("objects", object.id).version,
      2,
      "invalid edits must not advance version",
    );
    assert.equal(
      (
        await request(`/api/conversations/${work.id}`, "PATCH", {
          panel: { kind: "artifact", artifactId: "" },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request(`/api/conversations/${work.id}`, "PATCH", {
          panel: { kind: "app", appId: "opportunities", objectId: object.id },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          "/api/conversations",
          "POST",
          { title: "cross-site" },
          { Origin: "https://evil.example" },
        )
      ).status,
      403,
    );
    assert.equal(
      (await request("/api/state", "GET", undefined, { Origin: base })).status,
      200,
      "actual bound custom port is allowed",
    );
    assert.equal(
      (
        await request("/api/state", "GET", undefined, {
          Origin: "http://localhost:5173",
        })
      ).status,
      200,
      "Vite origin is allowed",
    );
    assert.equal(
      (
        await request("/api/state", "GET", undefined, {
          Origin: "http://localhost:4999",
        })
      ).status,
      403,
      "other local apps are not implicitly trusted",
    );
    assert.equal((await request("/.env.local")).status, 404);
    const conversationCountBeforeJob = store.list("conversations").length;
    const createdJob = await request("/api/works", "POST", {
      conversationId: "work-feedback",
      title: "持续分析反馈",
      goal: "维护机会看板",
    });
    assert.equal(createdJob.status, 201);
    const job = (await createdJob.json()) as { id: string };
    const originalJob = store.require("works", job.id);
    const editedJob = await request(`/api/works/${job.id}`, "PATCH", {
      goal: "跟踪反馈并整理三项改进机会",
      completionCriteria: "完成三项机会的证据核验后结束",
      status: "completed",
      conversationId: "another-conversation",
    });
    assert.equal(editedJob.status, 200);
    assert.equal(store.require("works", job.id).completionCriteria, "完成三项机会的证据核验后结束");
    assert.equal(store.require("works", job.id).status, originalJob.status, "editing a definition must not mark the goal complete");
    assert.equal(store.require("works", job.id).conversationId, originalJob.conversationId);
    assert.match(runtime.contextSummary("work-feedback", job.id), /完成三项机会的证据核验后结束/);
    assert.equal((await request(`/api/works/${job.id}`, "PATCH", { completionCriteria: 42 })).status, 400);
    assert.equal((await request(`/api/works/${job.id}`, "PATCH", { title: " " })).status, 400);
    assert.equal((await request(`/api/works/${job.id}`, "PATCH", { status: "completed" })).status, 400);

    assert.equal(
      store.list("conversations").length,
      conversationCountBeforeJob,
      "creating work does not create another conversation",
    );
    assert.equal(
      (
        await request(`/api/works/${job.id}/trigger`, "POST", {
          kind: "interval",
          instructions: "检查",
          intervalMinutes: 0,
        })
      ).status,
      400,
    );
    const response = await request(`/api/works/${job.id}/trigger`, "POST", {
      kind: "event",
      instructions: "新反馈时更新证据",
    });
    assert.equal(response.status, 201);
    assert.equal(store.require("works", job.id).status, "waiting");
    await request(`/api/works/${job.id}/action`, "POST", {
      action: "pause",
    });
    await request("/api/conversations/work-feedback/demo-event", "POST", {});
    assert.equal(
      store.pending().length,
      0,
      "paused work must not be scheduled",
    );
    await request(`/api/works/${job.id}/action`, "POST", {
      action: "resume",
    });
    assert.equal(store.require("works", job.id).status, "waiting");
    await request("/api/conversations/work-feedback/demo-event", "POST", {});
    assert.equal(store.pending().length, 1, "event queues a real run");
    assert.equal(store.pending()[0]?.source, store.list("triggers")[0]?.id);
    await request(`/api/works/${job.id}/action`, "POST", { action: "end" });
    assert.equal(store.pending().length, 0);
    assert.equal(store.list("triggers")[0]?.enabled, false);
    const reset = (await (
      await request("/api/demo/reset", "POST", {})
    ).json()) as Snapshot;
    assert(
      reset.conversations.some((item) => item.id === work.id),
      "reset preserves user-created work",
    );
    assert.equal(
      reset.objects.find(
        (item) =>
          item.conversationId === "work-feedback" &&
          item.appId === "opportunities",
      )?.version,
      1,
    );
    assert(dispatched.includes("work-feedback"));
  } finally {
    await runtime.close();
    server.close();
    server.closeAllConnections();
    await once(server, "close");
    store.close();
  }
});

test("interval wakeups coalesce missed ticks and preserve one queued execution", async () => {
  const store = new OrbitStore(":memory:");
  const runtime = new OrbitRuntime(
    store,
    await loadApps(),
    "/tmp/orbit-test-no-model",
  );
  runtime.seed();
  runtime.pump = () => {};
  try {
    const job = runtime.createWork("work-feedback", {
      title: "检查",
      goal: "检查最新反馈",
    });
    const trigger = runtime.addTrigger(job.id, {
      kind: "interval",
      instructions: "检查最新反馈",
      intervalMinutes: 1,
    });
    store.put("triggers", {
      ...trigger,
      nextRunAt: "2020-01-01T00:00:00.000Z",
    });
    runtime.tick();
    assert.equal(store.pending().length, 1);
    store.put("triggers", {
      ...trigger,
      nextRunAt: "2020-01-01T00:00:00.000Z",
    });
    runtime.tick();
    assert.equal(store.pending().length, 1);
    assert(store.require("triggers", trigger.id).nextRunAt! > now());
  } finally {
    await runtime.close();
    store.close();
  }
});

test("six SSE streams yield HTTP/1.1 connections so another tab can load", { timeout: 5000 }, async () => {
  const store = new OrbitStore(":memory:");
  const runtime = new OrbitRuntime(store, [], "/tmp/orbit-sse-slots");
  const server = createOrbitServer(runtime, undefined, { eventStreamMaxAgeMs: 200 });
  const agent = new Agent({ keepAlive: true, maxSockets: 6 });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const open = (path: string) => new Promise<import("node:http").IncomingMessage>((resolve, reject) => {
    get(base + path, { agent }, (response) => {
      response.resume();
      resolve(response);
    }).on("error", reject);
  });
  try {
    const streams = await Promise.all(Array.from({ length: 6 }, () => open("/api/events")));
    assert(streams.every((s) => !s.readableEnded));
    const response = await open("/api/health");
    assert.equal(response.statusCode, 200);
    assert(streams.some((s) => s.readableEnded), "a stream must release a slot for the queued request");
  } finally {
    agent.destroy();
    await runtime.close();
    server.close();
    server.closeAllConnections();
    await once(server, "close");
    store.close();
  }
});

test("SSE reconnect replays only missed events using Last-Event-ID", async () => {
  const store = new OrbitStore(":memory:");
  const runtime = new OrbitRuntime(store, [], "/tmp/orbit-sse-test");
  const server = createOrbitServer(runtime);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}/api/events`;
  const first = new AbortController();
  const second = new AbortController();
  const readUntil = async (
    reader: ReadableStreamDefaultReader<Uint8Array>,
    target: string,
  ) => {
    let content = "";
    while (!content.includes(target)) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error("SSE closed early");
      content += new TextDecoder().decode(chunk.value);
    }
    return content;
  };
  try {
    const response = await fetch(endpoint, {
      signal: AbortSignal.any([first.signal, AbortSignal.timeout(5000)]),
    });
    const reader = response.body!.getReader();
    await readUntil(reader, '"type":"state"');
    runtime.emit({
      type: "delta",
      conversationId: "w",
      runId: "r",
      text: "first",
    });
    const delivered = await readUntil(reader, "first");
    const lastId = delivered.match(/id: ([^\n]+)/)?.[1];
    assert(lastId);
    first.abort();
    runtime.emit({
      type: "delta",
      conversationId: "w",
      runId: "r",
      text: "missed",
    });
    const reconnect = await fetch(endpoint, {
      signal: AbortSignal.any([second.signal, AbortSignal.timeout(5000)]),
      headers: { "Last-Event-ID": lastId },
    });
    const replay = await readUntil(reconnect.body!.getReader(), "missed");
    assert(replay.includes("missed"));
    assert(!replay.includes("first"));
  } finally {
    first.abort();
    second.abort();
    await runtime.close();
    server.close();
    server.closeAllConnections();
    await once(server, "close");
    store.close();
  }
});

test("a fresh stream subscription sends replacement text rather than appending a replay", async () => {
  const store = new OrbitStore(":memory:");
  const runtime = new OrbitRuntime(store, [], "/tmp/orbit-stream-sync");
  runtime.streamSnapshot = () => [
    {
      type: "stream_sync",
      conversationId: "w",
      runId: "r",
      text: "完整的当前文本",
    },
  ];
  const server = createOrbitServer(runtime);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const controller = new AbortController();
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/events`,
      {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
      },
    );
    const reader = response.body!.getReader();
    let text = "";
    while (!text.includes("stream_sync")) {
      const chunk = await reader.read();
      assert(!chunk.done);
      text += new TextDecoder().decode(chunk.value);
    }
    assert(text.includes("完整的当前文本"));
    assert(!text.includes('"type":"delta"'));
  } finally {
    controller.abort();
    await runtime.close();
    server.close();
    server.closeAllConnections();
    await once(server, "close");
    store.close();
  }
});

test("notes receive missing apps on startup without replacing existing user edits", async () => {
  const store = new OrbitStore(":memory:");
  const apps = await loadApps();
  const runtime = new OrbitRuntime(store, apps, "/tmp/orbit-seed-migration");
  try {
    store.createConversation("我的已编辑随记", { id: "work-notes" });
    store.setMetadata("seeded", true);
    const feedbackApp = apps.find((app) => app.manifest.id === "feedback")!;
    const seed = feedbackApp.seed()[0]!;
    const existing = store.saveObject("work-notes", {
      ...seed,
      title: "保留我的标题",
    });
    runtime.seed();
    assert.equal(store.require("objects", existing.id).title, "保留我的标题");
    assert.equal(store.require("objects", existing.id).version, 1);
    assert.deepEqual(
      store
        .list("objects")
        .map((object) => object.appId)
        .sort(),
      ["career", "contracts", "feedback", "litigation", "opportunities", "portfolio"],
    );
    runtime.seed();
    assert.equal(store.list("objects").length, 6);
    assert.equal(
      store.require("conversations", "work-notes").title,
      "我的已编辑随记",
    );
  } finally {
    await runtime.close();
    store.close();
  }
});

test("independent jobs share a conversation without sharing lifecycle or trigger ownership", async () => {
  const store = new OrbitStore(":memory:");
  const runtime = new OrbitRuntime(
    store,
    await loadApps(),
    "/tmp/orbit-job-test",
  );
  runtime.seed();
  runtime.pump = () => {};
  try {
    assert.equal(
      store.list("works").length,
      0,
      "ordinary conversations have no implicit jobs",
    );
    const first = runtime.createWork("work-feedback", {
      title: "体验跟踪",
      goal: "跟踪新用户问题",
      kind: "event",
    });
    const second = runtime.createWork("work-feedback", {
      title: "证据整理",
      goal: "整理活跃用户证据",
      kind: "event",
    });
    runtime.addTrigger(second.id, {
      kind: "event",
      instructions: "检查证据完整性",
    });
    assert.equal(
      store.list("triggers").length,
      3,
      "multiple same-kind arrangements are independent",
    );
    const queued = runtime.queue(
      "work-feedback",
      "continue",
      "manual",
      "pending",
      first.id,
    );
    const chat = runtime.queue(
      "work-feedback",
      "ordinary chat",
      "user",
      "chat",
    );
    await runtime.action(first.id, "pause");
    assert.equal(store.require("runs", queued).status, "cancelled");
    assert.equal(
      store.require("runs", chat).status,
      "queued",
      "pausing a job preserves chat requests",
    );
    assert.equal(store.require("works", second.id).status, "waiting");
    runtime.demoEvent("work-feedback");
    assert.equal(
      store.pending().filter((p) => p.workId === first.id).length,
      0,
    );
    assert.equal(
      store.pending().filter((p) => p.workId === second.id).length,
      2,
    );
    assert(
      store
        .pending()
        .filter((p) => p.workId === second.id)
        .every((p) => store.require("runs", p.runId).workId === second.id),
    );
    await runtime.action(second.id, "end");
    assert.equal(
      store.pending().filter((p) => p.workId === second.id).length,
      0,
    );
    assert(
      store
        .list("triggers")
        .filter((t) => t.workId === second.id)
        .every((t) => !t.enabled),
    );
    assert(store.list("triggers").find((t) => t.workId === first.id)?.enabled);
    await runtime.action(first.id, "resume");
    assert.equal(store.require("works", first.id).status, "waiting");
    store.updateConversation("work-feedback", { archived: true });
    runtime.demoEvent("work-feedback");
    assert(
      store.pending().some((p) => p.workId === first.id),
      "archiving a conversation does not stop independent jobs",
    );
    assert(
      runtime.contextSummary("work-feedback").includes('"currentWork":null'),
    );
    assert(
      runtime
        .contextSummary("work-feedback", first.id)
        .includes(`"currentWork":{"id":"${first.id}"`),
    );
    assert.throws(
      () => runtime.requireWork("work-notes", first.id),
      /不属于当前对话/,
    );
    assert.equal(
      store.list("messages").filter((m) => m.kind === "work_created").length,
      2,
    );
  } finally {
    await runtime.close();
    store.close();
  }
});

test("main session never delegates more than two child executions at once", async () => {
  const store = new OrbitStore(":memory:");
  const runtime = new OrbitRuntime(store, [], "/tmp/orbit-child-limit");
  runtime.seed();
  const run = {
    id: "parent",
    conversationId: "work-feedback",
    parentId: null,
    title: "parent",
    status: "running" as const,
    startedAt: now(),
    summary: "",
  };
  const active = {
    run,
    cancelled: false,
    pendingSteers: [],
    children: new Set<AgentSession>(),
    childSlots: 0,
    text: "",
  };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = 0;
  runtime.runChild = async (_conversationId, _parent, title) => {
    started++;
    await gate;
    return { agentId: "test-agent", runId: "test-child", title, status: "completed", summary: "result" };
  };
  const tool = runtime
    .hostTools("work-feedback", active, () => undefined)
    .find((tool) => tool.name === "subagent")!;
  try {
    const first = tool.execute(
      "first",
      {
        tasks: [
          { title: "a", instructions: "a" },
          { title: "b", instructions: "b" },
        ],
      },
      undefined,
      undefined,
      {} as ExtensionContext,
    );
    assert.equal(started, 2);
    await assert.rejects(
      tool.execute(
        "overflow",
        { tasks: [{ title: "c", instructions: "c" }] },
        undefined,
        undefined,
        {} as ExtensionContext,
      ),
      /最多同时运行两个/,
    );
    assert.equal(started, 2);
    release();
    await first;
    assert.equal(active.childSlots, 0);
    active.cancelled = true;
    await assert.rejects(
      tool.execute(
        "cancelled",
        { tasks: [{ title: "d", instructions: "d" }] },
        undefined,
        undefined,
        {} as ExtensionContext,
      ),
      /执行已停止/,
    );
  } finally {
    release();
    await runtime.close();
    store.close();
  }
});

test("legacy conversation/work migration preserves data and creates jobs only for continuing goals", async () => {
  const dir = await mkdtemp(join(tmpdir(), "orbit-migrate-"));
  const path = join(dir, "orbit.sqlite");
  const legacy = new DatabaseSync(path);
  const insert = (table: string, value: Record<string, unknown>) => {
    legacy
      .prepare(`INSERT INTO ${table} VALUES (?,?)`)
      .run(String(value.id), JSON.stringify(value));
  };
  legacy.exec(
    "CREATE TABLE works (id TEXT PRIMARY KEY,value TEXT); CREATE TABLE messages (id TEXT PRIMARY KEY,value TEXT); CREATE TABLE objects (id TEXT PRIMARY KEY,value TEXT); CREATE TABLE triggers (id TEXT PRIMARY KEY,value TEXT); CREATE TABLE metadata (key TEXT PRIMARY KEY,value TEXT)",
  );
  const fields = {
    project: "我的资料",
    pinned: true,
    archived: false,
    goal: "持续分析",
    status: "waiting",
    summary: "等待反馈",
    continuous: true,
    unread: false,
    createdAt: now(),
    updatedAt: now(),
    panel: { kind: "activity" },
  };
  insert("works", { ...fields, id: "old-chat", title: "原有对话" });
  insert("works", {
    ...fields,
    id: "ordinary",
    title: "随便聊聊",
    continuous: false,
    status: "completed",
  });
  insert("messages", {
    id: "m",
    workId: "old-chat",
    role: "user",
    content: "我的原始要求",
    createdAt: now(),
  });
  insert("objects", {
    id: "o",
    workId: "old-chat",
    appId: "a",
    type: "board",
    title: "手动编辑的看板",
    version: 7,
    data: { priority: "P0" },
    updatedAt: now(),
  });
  insert("triggers", {
    id: "t",
    workId: "old-chat",
    kind: "event",
    eventName: "feedback.added",
    instructions: "保留我的修改",
    enabled: true,
    createdAt: now(),
  });
  legacy
    .prepare("INSERT INTO metadata VALUES (?,?)")
    .run("session:old-chat", JSON.stringify("/existing/session.jsonl"));
  legacy.close();
  let store = new OrbitStore(path);
  try {
    assert.equal(store.list("conversations").length, 2);
    assert.equal(store.list("works").length, 1);
    const work = store.list("works")[0]!;
    assert.equal(work.conversationId, "old-chat");
    assert.equal(store.require("messages", "m").conversationId, "old-chat");
    assert.equal(store.require("messages", "m").content, "我的原始要求");
    assert.equal(store.require("objects", "o").version, 7);
    assert.equal(store.require("objects", "o").data.priority, "P0");
    assert.equal(store.require("triggers", "t").workId, work.id);
    assert.equal(store.metadata("session:old-chat"), "/existing/session.jsonl");
    assert.deepEqual(store.require("conversations", "old-chat").panel, {
      kind: "work",
      workId: work.id,
    });
    store.close();
    store = new OrbitStore(path);
    assert.equal(store.list("works").length, 1, "migration is idempotent");
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("messages to a different work or ordinary chat queue rather than steering the active work", async () => {
  const store = new OrbitStore(":memory:");
  const runtime = new OrbitRuntime(store, [], "/tmp/orbit-route-test");
  runtime.seed();
  store.createConversation("测试对话", { id: "work-feedback" });
  runtime.pump = () => {};
  try {
    const first = runtime.createWork("work-feedback", {
      title: "第一项",
      goal: "第一项目标",
    });
    const second = runtime.createWork("work-feedback", {
      title: "第二项",
      goal: "第二项目标",
    });
    const runId = runtime.queue(
      "work-feedback",
      "推进",
      "manual",
      "running",
      first.id,
    );
    const active = {
      run: store.require("runs", runId),
      cancelled: false,
      pendingSteers: [] as string[],
      children: new Set<AgentSession>(),
      childSlots: 0,
      text: "",
    };
    runtime.active.set("work-feedback", active);
    const chat = await runtime.send("work-feedback", "聊个无关问题");
    const another = await runtime.send(
      "work-feedback",
      "更新第二项要求",
      second.id,
    );
    assert.notEqual(chat, runId);
    assert.notEqual(another, runId);
    assert.equal(active.pendingSteers.length, 0);
    assert.equal(store.require("runs", chat).workId, undefined);
    assert.equal(store.require("runs", another).workId, second.id);
    assert.equal(
      await runtime.send("work-feedback", "第一项新增要求", first.id),
      runId,
    );
    assert.equal(active.pendingSteers.length, 1);
    assert(active.pendingSteers[0]?.includes(first.goal));
    assert(
      !runtime
        .contextSummary("work-feedback", first.id)
        .includes("更新第二项要求"),
    );
  } finally {
    runtime.active.clear();
    await runtime.close();
    store.close();
  }
});

test("run history remains accessible beyond the live snapshot limit and is scoped to the run", async () => {
  const store = new OrbitStore(":memory:");
  const runtime = new OrbitRuntime(store, [], "/tmp/orbit-history-test");
  const server = createOrbitServer(runtime);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const c = store.createConversation("历史目标");
    const other = store.createConversation("其他对话");
    store.put("runs", { id: "old-run", conversationId: c.id, parentId: null, title: "历史执行", status: "completed", startedAt: now(), summary: "已完成" });
    store.put("activities", { id: "old-step", conversationId: c.id, runId: "old-run", kind: "tool", title: "读取资料", detail: "", createdAt: now() });
    for (let n = 0; n < 501; n++) store.put("activities", { id: `new-${n}`, conversationId: other.id, runId: "other-run", kind: "tool", title: "其他操作", detail: "", createdAt: now() });
    assert.equal(runtime.snapshot().activities.some(a => a.id === "old-step"), false);
    const response = await fetch(`${base}/api/runs/old-run/activities`);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json() as Array<{ id: string }>).map(a => a.id), ["old-step"]);
    assert.equal((await fetch(`${base}/api/runs/missing/activities`)).status, 404);
  } finally {
    await runtime.close();
    server.close(); server.closeAllConnections(); store.close();
  }
});
