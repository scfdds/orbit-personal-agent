import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OrbitStore } from "./store.ts";
import { OrbitRuntime } from "./runtime.ts";
import { createOrbitServer } from "./http.ts";
import type { WorkspaceMode } from "../shared/workspace-mode.ts";

const token = "workspace-mode-test-token";
const realMarker = "PRIVATE_REAL_WORKSPACE_SENTINEL";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "orbit-workspace-mode-"));
  const previous = { config: process.env.ORBIT_CONFIG_PATH, mcp: process.env.ORBIT_MCP_CONFIG };
  process.env.ORBIT_CONFIG_PATH = join(directory, "model-config.json");
  process.env.ORBIT_MCP_CONFIG = join(directory, "mcp.local.json");
  await writeFile(process.env.ORBIT_CONFIG_PATH, JSON.stringify({ apiKey: "", model: "deepseek-flash" }));
  await writeFile(process.env.ORBIT_MCP_CONFIG, JSON.stringify({ servers: [{ id: "private-tool", name: realMarker, command: "never-execute", readOnlyTools: ["private_read"] }] }));
  const store = new OrbitStore(join(directory, "orbit.sqlite"));
  const runtime = new OrbitRuntime(store, [], directory);
  runtime.pump = () => {};
  runtime.initialize({ seed: false });
  runtime.projects.generate = async () => ({ items: [] });
  runtime.memory.schedule = async () => {};
  runtime.discussion.schedule = async () => {};
  const mainId = runtime.assistant.getState().conversationId;
  store.addMessage(mainId, "user", realMarker);
  store.put("projects", { id: "demo-project-cafe", name: "真实项目", summary: realMarker, instructions: "", pinned: false, order: 0, archived: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const general = runtime.projects.readDocument();
  runtime.projects.saveDocument(undefined, general.version, `# 通用约定\n${realMarker}\n`);
  const project = runtime.projects.readDocument("demo-project-cafe");
  runtime.projects.saveDocument("demo-project-cafe", project.version, `# 项目约定\n${realMarker}\n`);
  const server = createOrbitServer(runtime, directory, { authToken: token });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api`;
  const api = async (path: string, method = "GET", input?: unknown, revision?: string) => {
    const response = await fetch(base + path, {
      method, headers: { "X-Orbit-Token": token, "Content-Type": "application/json", ...(revision ? { "X-Orbit-Workspace": revision } : {}) },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
    return { status: response.status, revision: response.headers.get("x-orbit-workspace"), value: await response.json() as any };
  };
  const mode = async (): Promise<WorkspaceMode> => (await api("/workspace-mode")).value;
  const switchTo = async (demo: boolean, previousMode: WorkspaceMode) => {
    const response = await api("/workspace-mode", "POST", { demo, revision: previousMode.revision });
    assert.equal(response.status, 200);
    assert.equal(response.revision, response.value.revision);
    return response.value as WorkspaceMode;
  };
  return { directory, store, runtime, server, base, mainId, api, mode, switchTo, async close() {
    await server.closeWorkspaces();
    await runtime.close();
    const closed = once(server, "close");
    server.close(); server.closeAllConnections(); await closed;
    store.close();
    if (previous.config === undefined) delete process.env.ORBIT_CONFIG_PATH; else process.env.ORBIT_CONFIG_PATH = previous.config;
    if (previous.mcp === undefined) delete process.env.ORBIT_MCP_CONFIG; else process.env.ORBIT_MCP_CONFIG = previous.mcp;
    await rm(directory, { recursive: true, force: true });
  } };
}

test("global demo isolates identical main/project IDs, preserves edits and restores real memory", async () => {
  const h = await fixture();
  try {
    const real = await h.mode();
    const before = await h.api("/state", "GET", undefined, real.revision);
    assert.equal(before.revision, real.revision);
    assert.match(JSON.stringify(before.value), new RegExp(realMarker));
    const realGeneral = await h.api("/memory/global/document");
    const realProject = await h.api("/projects/demo-project-cafe/memory/document");
    const realTitle = h.store.require("conversations", h.mainId).title;

    const demo = await h.switchTo(true, real);
    const snapshot = await h.api("/state", "GET", undefined, demo.revision);
    assert.deepEqual(snapshot.value.workspaceMode, demo);
    assert.equal(snapshot.revision, demo.revision);
    assert.equal((await h.api("/assistant")).value.conversationId, h.mainId);
    assert.doesNotMatch(JSON.stringify(snapshot.value), new RegExp(realMarker));
    assert.ok(snapshot.value.projects.some((project: any) => project.id === "demo-project-cafe"));
    assert.ok(snapshot.value.messages.some((message: any) => message.conversationId === h.mainId));

    assert.equal((await h.api(`/conversations/${h.mainId}`, "PATCH", { title: "演示主对话修改" }, demo.revision)).status, 200);
    assert.equal((await h.api("/projects/demo-project-cafe", "PATCH", { name: "演示项目修改" }, demo.revision)).status, 200);
    const demoGeneral = (await h.api("/memory/global/document")).value;
    const demoProject = (await h.api("/projects/demo-project-cafe/memory/document")).value;
    assert.ok(demoGeneral.path.startsWith(join(h.directory, "demo-workspace") + "/"));
    assert.ok(demoProject.path.startsWith(join(h.directory, "demo-workspace") + "/"));
    const editedGeneral = "## 演示中的通用约定\nDEMO_GENERAL_EDIT\n";
    const editedProject = "## 演示中的项目约定\nDEMO_PROJECT_EDIT\n";
    assert.equal((await h.api("/memory/global/document", "PATCH", { version: demoGeneral.version, content: editedGeneral }, demo.revision)).status, 200);
    assert.equal((await h.api("/projects/demo-project-cafe/memory/document", "PATCH", { version: demoProject.version, content: editedProject }, demo.revision)).status, 200);
    assert.equal(await readFile(realGeneral.value.path, "utf8"), realGeneral.value.content);
    assert.equal(await readFile(realProject.value.path, "utf8"), realProject.value.content);
    assert.equal(h.store.require("projects", "demo-project-cafe").name, "真实项目");
    assert.equal(h.store.require("conversations", h.mainId).title, realTitle);

    const restored = await h.switchTo(false, demo);
    assert.notEqual(restored.revision, real.revision);
    assert.match(JSON.stringify((await h.api("/state")).value), new RegExp(realMarker));
    assert.equal((await h.api("/memory/global/document")).value.content, realGeneral.value.content);
    assert.equal((await h.api("/projects/demo-project-cafe/memory/document")).value.content, realProject.value.content);
    assert.equal((await h.api("/projects/demo-project-cafe")).value.name, "真实项目");
    await h.switchTo(true, restored);
    const revisited = (await h.api("/state")).value;
    assert.equal(revisited.conversations.find((conversation: any) => conversation.id === h.mainId).title, "演示主对话修改");
    assert.equal(revisited.projects.find((project: any) => project.id === "demo-project-cafe").name, "演示项目修改");
    assert.equal((await h.api("/memory/global/document")).value.content, editedGeneral);
    assert.equal((await h.api("/projects/demo-project-cafe/memory/document")).value.content, editedProject);
    assert.equal(h.runtime.active.size, 0);
  } finally { await h.close(); }
});

test("stale or missing workspace revisions cannot write after switching, including a body already uploading", async () => {
  const h = await fixture();
  try {
    const real = await h.mode();
    const accepted = once(h.server, "request");
    const pending = httpRequest(h.base + "/projects", { method: "POST", headers: { "X-Orbit-Token": token, "X-Orbit-Workspace": real.revision, "Content-Type": "application/json" } });
    const completed = new Promise<number>(resolve => pending.once("response", response => { response.resume(); resolve(response.statusCode!); }));
    pending.write('{"name":"UPLOADED_');
    await accepted;
    const demo = await h.switchTo(true, real);
    pending.end('AFTER_SWITCH"}');
    assert.equal(await completed, 409);
    assert.equal((await h.api("/projects", "POST", { name: "STALE_WRITE" }, real.revision)).status, 409);
    assert.equal((await h.api("/projects", "POST", { name: "MISSING_REVISION" })).status, 409);
    assert.equal((await h.api("/state", "GET", undefined, real.revision)).status, 409);
    const staleSwitch = await h.api("/workspace-mode", "POST", { demo: false, revision: real.revision });
    assert.equal(staleSwitch.status, 409);
    assert.deepEqual(await h.mode(), demo);
    assert.doesNotMatch(JSON.stringify((await h.api("/projects")).value), /UPLOADED_AFTER_SWITCH|STALE_WRITE|MISSING_REVISION/);
    assert.doesNotMatch(JSON.stringify(h.store.list("projects")), /UPLOADED_AFTER_SWITCH|STALE_WRITE|MISSING_REVISION/);
    await h.switchTo(false, demo);
    assert.equal((await h.api("/projects", "POST", { name: "MISSING_AFTER_EXIT" })).status, 409);
  } finally { await h.close(); }
});

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, target: string) {
  let text = "";
  while (!text.includes(target)) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error(`Stream closed before ${target}`);
    text += new TextDecoder().decode(chunk.value);
  }
  return text;
}
async function readRemainder(reader: ReadableStreamDefaultReader<Uint8Array>) {
  let text = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) return text;
    text += new TextDecoder().decode(chunk.value);
  }
}

test("workspace switches close SSE and old Last-Event-ID never replays real events into demo", async () => {
  const h = await fixture();
  const controllers: AbortController[] = [];
  const connect = async (lastId?: string) => {
    const controller = new AbortController(); controllers.push(controller);
    const response = await fetch(h.base + "/events", { headers: { "X-Orbit-Token": token, ...(lastId ? { "Last-Event-ID": lastId } : {}) }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) });
    assert.equal(response.status, 200);
    return response.body!.getReader();
  };
  try {
    const real = await h.mode();
    const reader = await connect();
    await readUntil(reader, '"type":"state"');
    h.runtime.emit({ type: "delta", conversationId: h.mainId, runId: "real-run", text: realMarker });
    const seen = await readUntil(reader, realMarker);
    const lastId = seen.match(/id: ([^\n]+)/)?.[1];
    assert.ok(lastId);
    const demo = await h.switchTo(true, real);
    const end = await readRemainder(reader);
    assert.match(end, /"type":"workspace_mode"/);
    assert.match(end, new RegExp(demo.revision));
    const demoReader = await connect(lastId);
    const fresh = await readUntil(demoReader, '"type":"state"');
    assert.doesNotMatch(fresh, new RegExp(realMarker));
    assert.notEqual(fresh.match(/id: ([^\n]+)/)?.[1]?.split(":")[0], lastId.split(":")[0]);
    h.runtime.emit({ type: "delta", conversationId: h.mainId, runId: "late-real-run", text: "LATE_PRIVATE_REAL_DELTA" });
    await h.switchTo(false, demo);
    const after = await readRemainder(demoReader);
    assert.match(after, /"type":"workspace_mode"/);
    assert.doesNotMatch(after, /PRIVATE_REAL_WORKSPACE_SENTINEL|LATE_PRIVATE_REAL_DELTA/);
  } finally { for (const controller of controllers) controller.abort(); await h.close(); }
});

test("demo cannot change shared connection settings or import native notifications and has no MCP tools", async () => {
  const h = await fixture();
  try {
    const real = await h.mode();
    assert.equal(h.runtime.subagents.mcp.length, 1);
    const demo = await h.switchTo(true, real);
    const beforeConfig = await readFile(join(h.directory, "model-config.json"), "utf8");
    for (const path of ["/model-config", "/voice/config"])
      assert.equal((await h.api(path, "PUT", { model: "deepseek-v4-pro", apiKey: "never-save-this" }, demo.revision)).status, 409);
    assert.equal(await readFile(join(h.directory, "model-config.json"), "utf8"), beforeConfig);
    assert.deepEqual((await h.api("/state")).value.subagentCapabilities.mcpServers, []);
    const capture = await h.api("/wechat/capture", "POST", { enabled: true }, demo.revision);
    assert.equal(capture.status, 200);
    assert.equal(capture.value.collector.status, "stopped");
    assert.equal(capture.value.collector.diagnostics.linesReceived, 0);
    assert.equal(capture.value.collector.diagnostics.notificationsReceived, 0);
    assert.equal(h.runtime.wechat.state().enabled, false);
    assert.equal(h.runtime.wechat.state().messageCount, 0);
    // Verify the native guard itself, without relying on the host OS or permissions.
    const isolated = new OrbitRuntime(new OrbitStore(":memory:"), [], join(h.directory, "capture-guard"), { demoMode: true });
    let launches = 0;
    (isolated.wechat.collector as unknown as { launch: () => Promise<void> }).launch = async () => { launches++; };
    try {
      isolated.wechat.capture(true);
      await Promise.resolve();
      assert.equal(launches, 0);
      assert.deepEqual(isolated.subagents.mcp, []);
    } finally { await isolated.close(); isolated.store.close(); }
  } finally { await h.close(); }
});
