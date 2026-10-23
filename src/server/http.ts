import { seedLedgerDemo } from "./showcases/ledger-demo.ts";
import { seedContextDemo } from "./showcases/context-demo.ts";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { hostname, platform } from "node:os";
import { OrbitStore, HttpError } from "./store.ts";
import { OrbitRuntime } from "./runtime.ts";
import { safeErrorMessage, modelConfigurationState, saveModelConfiguration } from "./model-config.ts";
import { requireRequestId } from "./assistant-home.ts";
import { seedDesktopExamples } from "./showcases/desktop-examples.ts";
import { createMatterDiscussion } from "./matter-discussions.ts";
import { loadApps } from "../apps/registry.ts";
import type { PanelRef, Conversation, ServerEvent, Work, ExecutionDevice } from "../shared/types.ts";
import type { AssistantMessageContext, AssistantWorkspaceAction } from "../shared/assistant.ts";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { VoiceService, VOICE_INPUT_LIMIT, voiceConfigurationState, saveVoiceConfiguration } from "./voice.ts";
import { VoiceStreamService } from "./voice-stream.ts";
import { personalApi } from "./personal-api.ts";
import { WorkspaceModes } from "./workspace-mode.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const bodyLimit = 1024 * 1024;
function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
}
async function body(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > bodyLimit) throw new HttpError(413, "请求内容不能超过 1 MB");
    chunks.push(chunk);
  }
  if (!bytes) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "请求不是有效的 JSON");
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
    throw new HttpError(400, "请求应为 JSON 对象");
  return parsed as Record<string, unknown>;
}
async function voiceAudioBody(request: IncomingMessage): Promise<Buffer> {
  if (!["audio/wav", "audio/x-wav", "audio/wave"].includes((request.headers["content-type"] || "").split(";")[0]!.trim().toLowerCase())) throw new HttpError(415, "请上传 WAV 格式的录音");
  if (Number(request.headers["content-length"]) > VOICE_INPUT_LIMIT) throw new HttpError(413, "录音不能超过 2 MB");
  let bytes = 0; const chunks: Buffer[] = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > VOICE_INPUT_LIMIT) throw new HttpError(413, "录音不能超过 2 MB");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function text(value: unknown, label: string, max = 20000) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new HttpError(400, `${label}不能为空且不能超过 ${max} 个字符`);
  return value.trim();
}
function boolean(value: unknown) {
  if (typeof value !== "boolean") throw new HttpError(400, "需要布尔值");
  return value;
}
function panel(
  input: unknown,
  runtime: OrbitRuntime,
  conversationId: string,
): PanelRef | null {
  if (input === null) return null;
  if (!input || typeof input !== "object")
    throw new HttpError(400, "无效的工作区面板");
  const value = input as Record<string, unknown>;
  if (value.kind === "activity") return { kind: "activity" };
  if (value.kind === "subagents") {
    const agentId =
      value.agentId === undefined
        ? undefined
        : text(value.agentId, "子 Agent ID", 100);
    if (agentId) runtime.subagents.require(conversationId, agentId);
    return { kind: "subagents", ...(agentId ? { agentId } : {}) };
  }
  if (value.kind === "work") {
    const workId = text(value.workId, "目标 ID", 100);
    runtime.requireWork(conversationId, workId);
    return { kind: "work", workId };
  }
  if (value.kind === "app") {
    const appId = text(value.appId, "应用 ID", 100);
    if (!runtime.apps.some((app) => app.manifest.id === appId))
      throw new HttpError(404, "应用不存在");
    const objectId =
      value.objectId === undefined
        ? undefined
        : text(value.objectId, "对象 ID", 100);
    if (objectId) {
      const object = runtime.store.require("objects", objectId);
      if (object.conversationId !== conversationId || object.appId !== appId)
        throw new HttpError(403, "对象不属于当前工作或应用");
    }
    return { kind: "app", appId, ...(objectId ? { objectId } : {}) };
  }
  if (value.kind === "artifact") {
    if (value.artifactId === "") return { kind: "artifact", artifactId: "" };
    const artifactId = text(value.artifactId, "产物 ID", 100);
    if (
      runtime.store.require("artifacts", artifactId).conversationId !==
      conversationId
    )
      throw new HttpError(403, "产物不属于当前工作");
    return { kind: "artifact", artifactId };
  }
  if (value.kind === "browser") {
    if (value.url !== undefined) {
      const url = new URL(text(value.url, "网址", 2000));
      if (!["https:", "http:"].includes(url.protocol))
        throw new HttpError(400, "仅支持 HTTP 或 HTTPS 链接");
      return { kind: "browser", url: url.href };
    }
    return { kind: "browser" };
  }
  throw new HttpError(400, "未知的面板类型");
}
function checkLocalOrigin(request: IncomingMessage, strictSameOrigin = false) {
  const host = request.headers.host?.split(":")[0];
  if (!["127.0.0.1", "localhost", "[::1]"].includes(host ?? ""))
    throw new HttpError(403, "仅允许本机访问");
  const origin = request.headers.origin;
  if (origin) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new HttpError(403, "来源无效");
    }
    const allowedPorts = new Set(strictSameOrigin ? [request.socket.localPort] : [request.socket.localPort, 5173, 5174]);
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      url.username ||
      url.password ||
      !allowedPorts.has(Number(url.port || 80))
    )
      throw new HttpError(403, "不允许跨站请求");
  }
  if (request.headers["sec-fetch-site"] === "cross-site")
    throw new HttpError(403, "不允许跨站请求");
}
export function createOrbitServer(
  realRuntime: OrbitRuntime,
  distPath = resolve(root, "dist"),
  options: { eventStreamMaxAgeMs?: number; authToken?: string; voiceService?: VoiceService } = {},
) {
  const authToken = options.authToken ?? process.env.ORBIT_AUTH_TOKEN;
  const voice = options.voiceService ?? new VoiceService();
  let voiceStream = new VoiceStreamService();
  const workspaces = new WorkspaceModes(realRuntime);
  const clients = new Set<ServerResponse>();
  let bootId = randomUUID();
  let sequence = 0;
  const history: { sequence: number; event: ServerEvent }[] = [];
  const writeEvent = (
    response: ServerResponse,
    event: ServerEvent,
    seq: number,
  ) =>
    response.write(`id: ${bootId}:${seq}\ndata: ${JSON.stringify(event)}\n\n`);
  const listener = (event: ServerEvent) => {
    history.push({ sequence: ++sequence, event });
    if (history.length > 10000) history.shift();
    for (const response of clients) {
      if (response.destroyed) clients.delete(response);
      else if (
        !writeEvent(response, event, sequence) &&
        response.writableLength > 1024 * 1024
      )
        response.destroy();
    }
  };
  workspaces.runtime.listeners.add(listener);
  const heartbeat = setInterval(() => {
    for (const response of clients) {
      if (response.destroyed) clients.delete(response);
      else response.write(": heartbeat\n\n");
    }
  }, 15000);
  heartbeat.unref();
  const server = createServer(async (request, response) => {
    // Freeze the workspace before any await. A late response or upload must never
    // resolve its IDs against the workspace selected by another window.
    const runtime = workspaces.runtime;
    const requestMode = workspaces.state;
    response.setHeader("X-Orbit-Workspace", requestMode.revision);
    const readBody = async () => {
      const input = await body(request);
      workspaces.assertRevision(requestMode.revision);
      return input;
    };
    try {
      checkLocalOrigin(request, Boolean(authToken) || process.env.ORBIT_DESKTOP === "1");
      const url = new URL(
        request.url ?? "/",
        `http://127.0.0.1:${request.socket.localPort ?? 4330}`,
      );
      const path = decodeURIComponent(url.pathname);
      const method = request.method ?? "GET";
      if (path.startsWith("/api/")) {
        if (authToken) {
          const supplied = request.headers["x-orbit-token"];
          const expected = Buffer.from(authToken);
          const actual = Buffer.from(typeof supplied === "string" ? supplied : "");
          if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new HttpError(401, "需要当前应用的访问凭证");
        }
        if (path === "/api/workspace-mode") {
          if (method === "GET") return json(response, 200, workspaces.state);
          if (method === "POST") {
            const input = await readBody();
            const previous = workspaces.runtime;
            const before = workspaces.state.revision;
            const mode = workspaces.switch(input.demo, input.revision);
            if (mode.revision !== before) {
              previous.listeners.delete(listener);
              history.length = 0; sequence = 0; bootId = randomUUID();
              for (const client of clients) {
                writeEvent(client, { type: "workspace_mode", workspaceMode: mode }, 0);
                client.end();
              }
              clients.clear();
              voiceStream.close(); voiceStream = new VoiceStreamService();
              workspaces.runtime.listeners.add(listener);
            }
            response.setHeader("X-Orbit-Workspace", mode.revision);
            return json(response, 200, mode);
          }
          throw new HttpError(405, "不支持此操作");
        }
        const suppliedRevision = request.headers["x-orbit-workspace"];
        if (suppliedRevision !== undefined) workspaces.assertRevision(suppliedRevision);
        else if (method !== "GET" && (requestMode.demo || workspaces.switched))
          throw new HttpError(409, "工作区已切换，请重新加载后继续");
        if (runtime.demoMode && method === "PUT" && ["/api/model-config", "/api/voice/config"].includes(path))
          throw new HttpError(409, "请退出演示后修改连接设置");
        if (runtime.demoMode && path === "/api/wechat/demo")
          throw new HttpError(409, "请在设置中切换演示模式");
        const personal = await personalApi(runtime, path, method, readBody);
        if (personal) return json(response, personal.status, personal.value);
        if (method === "GET" && path === "/api/model-config") return json(response, 200, modelConfigurationState());
        if (method === "PUT" && path === "/api/model-config") {
          const settings = saveModelConfiguration(await readBody()); runtime.changed(); return json(response, 200, settings);
        }
        if (method === "GET" && path === "/api/voice/config") return json(response, 200, voiceConfigurationState());
        if (method === "PUT" && path === "/api/voice/config") return json(response, 200, saveVoiceConfiguration(await readBody()));
        if (method === "POST" && path === "/api/voice/stream-session") {
          await readBody();
          checkLocalOrigin(request, true);
          return json(response, 200, voiceStream.issueTicket(request.headers.origin || `http://${request.headers.host}`));
        }
        if (method === "POST" && ["/api/voice/synthesize", "/api/voice/synthesize-stream", "/api/voice/transcribe"].includes(path)) {
          const controller = new AbortController();
          const disconnected = () => { if (!response.writableEnded) controller.abort(); };
          request.once("aborted", disconnected); response.once("close", disconnected);
          try {
            if (path === "/api/voice/synthesize-stream") {
              const input = await readBody();
              if (typeof input.text !== "string" || input.text.length > 120) throw new HttpError(400, "流式讲解需为 1–120 个字符");
              const stream = await voice.synthesizeStream(input.text, controller.signal);
              try {
                if (controller.signal.aborted) return;
                response.writeHead(200, { "Content-Type": "audio/pcm", "X-Audio-Sample-Rate": "24000", "X-Audio-Channels": "1", "X-Audio-Format": "pcm_s16le", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Accel-Buffering": "no" });
                for await (const chunk of stream.chunks) {
                  if (controller.signal.aborted) return;
                  if (!response.write(chunk)) await new Promise<void>((resolve, reject) => {
                    const cleanup = () => { response.off("drain", drained); response.off("close", closed); };
                    const drained = () => { cleanup(); resolve(); };
                    const closed = () => { cleanup(); reject(new Error("Playback disconnected")); };
                    response.once("drain", drained); response.once("close", closed);
                    if (response.destroyed) closed();
                  });
                }
                if (!controller.signal.aborted) response.end();
              } catch (error) {
                // EOF must mean a complete narration. A truncated stream must reject the reader.
                if (response.headersSent) response.destroy(); else throw error;
              } finally { stream.cancel(); }
              return;
            }
            if (path === "/api/voice/synthesize") {
              const input = await readBody(), audio = await voice.synthesize(input.text, controller.signal);
              if (controller.signal.aborted) return;
              response.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": audio.length, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
              response.end(audio); return;
            }
            const result = await voice.transcribe(await voiceAudioBody(request), controller.signal);
            if (!controller.signal.aborted) json(response, 200, result);
            return;
          } finally { request.off("aborted", disconnected); response.off("close", disconnected); }
        }
        if (method === "POST" && path === "/api/desktop/ledger-demo") {
          await readBody(); const seeded = seedLedgerDemo(runtime.store); runtime.changed(); return json(response, 200, seeded);
        }
        if (method === "POST" && path === "/api/desktop/context-demo") {
          await readBody(); const seeded = seedContextDemo(runtime.store); runtime.changed(); return json(response, 200, seeded);
        }
        if (method === "POST" && path === "/api/desktop/examples") {
          await readBody(); const seeded = seedDesktopExamples(runtime.store); runtime.changed(); return json(response, 200, seeded);
        }
        if (method === "GET" && path === "/api/assistant/overview") return json(response, 200, runtime.home.overview());
        if (method === "GET" && path === "/api/assistant")
          return json(response, 200, runtime.assistant.getState());
        if (method === "POST" && path === "/api/assistant/workspace") {
          const input = await readBody();
          return json(response, 200, runtime.assistant.workspace(input as unknown as AssistantWorkspaceAction));
        }
        if (method === "POST" && path === "/api/assistant/messages") {
          const input = await readBody();
          const content = text(input.content, "消息");
          const result = await runtime.home.submit({ requestId: requireRequestId(input.requestId), content, context: input.context as AssistantMessageContext | undefined, visibleContext: input.visibleContext as AssistantMessageContext | undefined });
          return json(response, 202, result);
        }
        const runActivitiesMatch = path.match(/^\/api\/runs\/([^/]+)\/activities$/);
        if (method === "GET" && runActivitiesMatch) {
          const run = runtime.store.require("runs", runActivitiesMatch[1]!);
          return json(response, 200, runtime.store.list("activities")
            .filter(activity => activity.runId === run.id && activity.conversationId === run.conversationId)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
        }
        const exportMatch = path.match(/^\/api\/conversations\/([^/]+)\/apps\/([^/]+)\/export\/([^/]+)$/);
        if (method === "GET" && exportMatch) {
          const [, conversationId, appId, format] = exportMatch;
          runtime.store.require("conversations", conversationId!);
          const app = runtime.apps.find((a) => a.manifest.id === appId);
          if (!app?.exportFile) throw new HttpError(404, "应用不支持文件导出");
          const file = await app.exportFile(runtime.appContext(conversationId!, true), format!);
          response.writeHead(200, {
            "Content-Type": file.contentType,
            "Content-Disposition": `attachment; filename="orbit-export.${format === "docx" ? "docx" : "md"}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          });
          response.end(file.content);
          return;
        }
        if (method === "GET" && path === "/api/state")
          return json(response, 200, { ...runtime.snapshot(), workspaceMode: requestMode });
        if (method === "GET" && path === "/api/devices/local")
          return json(response, 200, {
            id: "local",
            name: hostname(),
            platform: ({ darwin: "macOS", win32: "Windows", linux: "Linux" } as Record<string, string>)[platform()] || platform(),
            workspaceRoot: resolve(runtime.dataDir, "workspaces"),
          } satisfies ExecutionDevice);
        if (method === "GET" && path === "/api/health")
          return json(response, 200, {
            ok: true,
            ...modelConfigurationState(),
            activeRuns: runtime.active.size,
          });
        if (method === "GET" && path === "/api/events") {
          response.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
          });
          response.write("retry: 1000\n: connected\n\n");
          if (url.searchParams.has("workspace") && url.searchParams.get("workspace") !== requestMode.revision) {
            writeEvent(response, { type: "workspace_mode", workspaceMode: requestMode }, sequence);
            response.end();
            return;
          }
          const lastId = request.headers["last-event-id"];
          const lastSequence =
            typeof lastId === "string" && lastId.startsWith(`${bootId}:`)
              ? Number(lastId.slice(bootId.length + 1))
              : NaN;
          if (
            Number.isInteger(lastSequence) &&
            lastSequence >= (history[0]?.sequence ?? 1) - 1 &&
            lastSequence <= sequence
          ) {
            for (const entry of history)
              if (entry.sequence > lastSequence)
                writeEvent(response, entry.event, entry.sequence);
          } else {
            writeEvent(response, { type: "state" }, sequence);
            for (const event of runtime.streamSnapshot())
              writeEvent(response, event, sequence);
          }
          clients.add(response);
          // Yield the HTTP/1.1 socket periodically, including for older clients
          // that keep streams open in background tabs. EventSource reconnects
          // with Last-Event-ID and the replay logic above covers the brief gap.
          const rotate = setTimeout(() => response.end(), options.eventStreamMaxAgeMs ?? 20000);
          rotate.unref();
          response.on("close", () => {
            clearTimeout(rotate);
            clients.delete(response);
          });
          return;
        }
        if (method === "POST" && path === "/api/intake") {
          const input = await readBody();
          if (input.mode !== "auto" && input.mode !== "new") throw new HttpError(400, "请选择自动选择或始终新建");
          const requestId = text(input.requestId, "请求标识", 100);
          if (!/^[\w-]+$/.test(requestId)) throw new HttpError(400, "无效请求标识");
          request.setTimeout(0); response.setTimeout(0);
          const result = await runtime.router.submit({
            requestId, mode: input.mode, content: text(input.content, "消息"),
            ...(input.project === undefined ? {} : { project: text(input.project, "分区", 160) }),
          });
          return json(response, 202, result);
        }
        const openAppMatch = path.match(/^\/api\/apps\/([^/]+)\/open$/);
        if (method === "POST" && openAppMatch) {
          const input = await readBody();
          return json(response, input.conversationId ? 200 : 201, runtime.openApp(
            openAppMatch[1]!,
            input.conversationId === undefined ? undefined : text(input.conversationId, "对话", 160),
            input.project === undefined ? undefined : text(input.project, "分区", 160),
          ));
        }
        if (method === "POST" && path === "/api/conversations") {
          const input = await readBody();
          const created = runtime.createConversation(text(input.title, "标题", 160));
          runtime.organizer.protect(created.id, { title: true });
          return json(response, 201, created);
        }
        if (path === "/api/sections" && method === "POST") {
          const input = await readBody();
          const saved = runtime.sections.ensure(text(input.name, "分区名称", 160));
          runtime.changed(); return json(response, 201, saved);
        }
        const overviewMatch = path.match(/^\/api\/sections\/([^/]+)\/overview$/);
        if (overviewMatch && method === 'POST') {
          await readBody();
          return json(response, 200, { text: await runtime.topicOverview.refresh(overviewMatch[1]!) });
        }
        const sectionMatch = path.match(/^\/api\/sections\/([^/]+)(?:\/(reorder))?$/);
        if (sectionMatch) {
          const input = await readBody();
          if (method === "DELETE") {
            const section = runtime.store.require("sections", sectionMatch[1]!);
            const members = runtime.store.list("conversations").filter(c => c.project === section.name);
            runtime.sections.remove(sectionMatch[1]!);
            for (const member of members) runtime.organizer.protect(member.id, { project: true });
          }
          else if (method === "POST" && sectionMatch[2]) runtime.sections.reorder(sectionMatch[1]!, input.beforeId === undefined ? undefined : text(input.beforeId, "目标分区", 100));
          else if (method === "PATCH") runtime.sections.update(sectionMatch[1]!, {
            ...(input.name === undefined ? {} : { name: text(input.name, "分区名称", 160) }),
            ...(input.pinned === undefined ? {} : { pinned: boolean(input.pinned) }),
          });
          else throw new HttpError(405, "不支持此操作");
          runtime.changed(); return json(response, 200, runtime.sections.list());
        }
        const moveMatch = path.match(/^\/api\/conversations\/([^/]+)\/move$/);
        if (moveMatch && method === "POST") {
          const input = await readBody();
          const previous = runtime.store.require("conversations", moveMatch[1]!);
          const saved = runtime.sections.move(moveMatch[1]!, text(input.sectionId, "分区", 100), input.beforeId === undefined ? undefined : text(input.beforeId, "目标对话", 100));
          runtime.organizer.protect(saved.id, { project: true });
          runtime.projects.syncFiles(previous.projectId);
          if (saved.projectId !== previous.projectId) runtime.projects.syncFiles(saved.projectId);
          runtime.changed(); return json(response, 200, saved);
        }
        const recapMatch = path.match(/^\/api\/conversations\/([^/]+)\/recap$/);
        if (recapMatch && method === 'POST') {
          await readBody();
          return json(response, 200, { recap: await runtime.recap.refresh(recapMatch[1]!) });
        }
        const discussionsMatch = path.match(/^\/api\/conversations\/([^/]+)\/discussions$/);
        if (method === "POST" && discussionsMatch) {
          const input = await readBody();
          const created = createMatterDiscussion(runtime, discussionsMatch[1]!, text(input.title, "讨论标题", 160));
          runtime.organizer.protect(created.id);
          for (const member of runtime.store.list("conversations").filter(item => item.matterId && item.matterId === created.matterId))
            runtime.organizer.protect(member.id, { project: true });
          return json(response, 201, created);
        }
        const discussionMatch=path.match(/^\/api\/conversations\/([^/]+)\/discussion$/);
        if(discussionMatch){
          const id=discussionMatch[1]!;
          if(method==='GET')return json(response,200,runtime.discussion.get(id));
          const input=await readBody();
          if(method==='POST'){void runtime.discussion.schedule(id);return json(response,202,runtime.discussion.get(id));}
          if(method==='PATCH'){
            if(!Number.isInteger(input.version))throw new HttpError(400,'需要摘要版本');
            return json(response,200,runtime.discussion.edit(id,input.version as number,text(input.turnId,'轮次',120),text(input.question,'问题',120),text(input.answer,'回答摘要',1000)));
          }
          throw new HttpError(405,'不支持此操作');
        }
        const memoryMatch = path.match(
          /^\/api\/conversations\/([^/]+)\/memory(?:\/(refresh))?$/,
        );
        if (memoryMatch) {
          const conversationId = memoryMatch[1]!;
          if (method === "GET")
            return json(
              response,
              200,
              runtime.memory.effective(conversationId),
            );
          const input = await readBody();
          if (method === "POST" && memoryMatch[2]) {
            void runtime.memory.schedule(conversationId);
            return json(response, 202, runtime.memory.get(conversationId));
          }
          if (method === "PATCH") {
            if (!Number.isInteger(input.version))
              throw new HttpError(400, "需要记忆版本");
            const saved = runtime.memory.edit(
              conversationId,
              input.version as number,
              {
                ...(input.itemId === undefined
                  ? {}
                  : { itemId: text(input.itemId, "条目ID", 100) }),
                ...(input.text === undefined
                  ? {}
                  : { text: text(input.text, "记忆", 1500) }),
                ...(input.summary === undefined
                  ? {}
                  : { summary: text(input.summary, "概述", 2000) }),
                ...(input.deleted === undefined
                  ? {}
                  : { deleted: boolean(input.deleted) }),
              },
            );
            if (input.itemId !== undefined)
              void runtime.memory.schedule(conversationId);
            return json(response, 200, saved);
          }
        }
        const forkMatch = path.match(/^\/api\/conversations\/([^/]+)\/fork$/);
        if (method === "POST" && forkMatch) {
          const input = await readBody();
          request.setTimeout(0);
          response.setTimeout(0);
          const child = await runtime.memory.fork(
            forkMatch[1]!,
            text(input.messageId, "分叉位置", 100),
            text(input.title, "分支标题", 160),
          );
          runtime.seedObjects(child.id);
          runtime.organizer.protect(child.id, { title: true });
          runtime.changed();
          return json(response, 201, child);
        }
        const workMatch = path.match(/^\/api\/conversations\/([^/]+)$/);
        if (method === "DELETE" && workMatch) {
          const conversationId = workMatch[1]!;
          if (runtime.assistant.isMain(conversationId)) throw new HttpError(403, "主助手对话不能删除");
          const previous = runtime.store.require("conversations", conversationId);
          if (runtime.active.has(conversationId)) throw new HttpError(409, "请先停止执行，再删除对话");
          runtime.store.deleteConversation(conversationId);
          runtime.projects.syncFiles(previous.projectId);
          runtime.changed(); return json(response, 200, { deleted: true });
        }
        if (method === "PATCH" && workMatch) {
          const conversationId = workMatch[1]!;
          const previous = runtime.store.require("conversations", conversationId);
          const input = await readBody();
          const patch: Partial<Conversation> = {};
          if (runtime.assistant.isMain(conversationId) && input.archived === true) throw new HttpError(403, "主助手对话不能归档");
          for (const key of ["title", "project"] as const)
            if (input[key] !== undefined)
              patch[key] = text(
                input[key],
                key === "title" ? "标题" : "项目",
                160,
              );
          for (const key of ["archived", "unread"] as const)
            if (input[key] !== undefined) patch[key] = boolean(input[key]);
          if (input.pinned !== undefined) {
            const section = runtime.sections.ensure(patch.project || runtime.store.require("conversations", conversationId).project);
            runtime.sections.update(section.id, {pinned:boolean(input.pinned)});
          }
          if (input.panel !== undefined)
            patch.panel = panel(input.panel, runtime, conversationId);
          if (patch.archived && runtime.active.has(conversationId))
            throw new HttpError(409, "请先暂停正在运行的工作");
          const work = runtime.store.updateConversation(conversationId, patch);
          if (patch.title !== undefined || patch.project !== undefined)
            runtime.organizer.protect(conversationId, { title: patch.title !== undefined, project: patch.project !== undefined });
          runtime.projects.syncFiles(previous.projectId);
          if (work.projectId !== previous.projectId) runtime.projects.syncFiles(work.projectId);
          runtime.changed();
          return json(response, 200, work);
        }
        const messages = path.match(
          /^\/api\/conversations\/([^/]+)\/messages$/,
        );
        if (method === "POST" && messages) {
          const input = await readBody();
          runtime.store.require("conversations", messages[1]!);
          const content = text(input.content, "消息");
          if (input.requestId !== undefined) {
            if (input.surface !== undefined) throw new HttpError(400, "请仅传入本轮明确引用，不使用页面作为隐式上下文");
            const result = await runtime.home.sendTo({ requestId: requireRequestId(input.requestId), conversationId: messages[1]!, content,
              context: input.context as AssistantMessageContext | undefined,
              visibleContext: input.visibleContext as AssistantMessageContext | undefined,
              ...(input.workId === undefined ? {} : { workId: text(input.workId, "目标 ID", 100) }),
            });
            return json(response, 202, result);
          }
          if (input.surface !== undefined) {
            const surface = input.surface as Record<string, unknown>;
            if (!surface || !["memory", "overview", "apps"].includes(String(surface.view))) throw new HttpError(400, "无效页面上下文");
            const context: Record<string, unknown> = { page: surface.view };
            if (surface.sectionId) {
              const section=runtime.store.require("sections",text(surface.sectionId,"话题",100));
              const conversations=runtime.store.list("conversations").filter(c=>!c.archived&&c.project===section.name).sort((a,b)=>(a.order??0)-(b.order??0));
              const memories=runtime.store.list("memories");
              context.topic={id:section.id,name:section.name,totalConversations:conversations.length,
                conversations:conversations.slice(0,30).map(c=>({id:c.id,title:c.title,parentId:c.parentId,summary:memories.find(m=>m.conversationId===c.id)?.summary.slice(0,1000)||""}))};
            }
            if(surface.messageId&&!surface.conversationId)throw new HttpError(400,'需要原对话');
            if (surface.conversationId) {
              const id=text(surface.conversationId, "对话", 100);
              if(surface.messageId){
                const c=runtime.store.require('conversations',id),messageId=text(surface.messageId,'原文位置',120);
                const original=runtime.memory.messages(id),at=original.findIndex(m=>m.id===messageId);
                if(at<0)throw new HttpError(404,'原文不属于该对话');
                context.discussion={conversationId:id,title:c.title,throughMessageId:messageId,totalMessages:at+1,messages:original.slice(0,at+1).slice(-40).map(m=>({id:m.id,role:m.role,content:m.content.slice(0,6000)}))};
              }else context.conversationMemory = runtime.memory.context(id);
            }
            if (surface.workId) context.goal = runtime.store.require("works", text(surface.workId, "目标", 100));
            if (surface.appId) context.app = runtime.apps.find(a => a.manifest.id === surface.appId)?.manifest;
            runtime.store.setMetadata(`surface:${messages[1]!}`, context);
          } else runtime.store.setMetadata(`surface:${messages[1]!}`, null);
          const runId = await runtime.send(
            messages[1]!,
            content,
            input.workId === undefined
              ? undefined
              : text(input.workId, "目标 ID", 100),
          );
          return json(response, 202, { runId });
        }
        const childAction = path.match(
          /^\/api\/conversations\/([^/]+)\/subagents\/([^/]+)\/(stop|continue)$/,
        );
        if (method === "POST" && childAction) {
          const [, conversationId, agentId, action] = childAction;
          const input = await readBody();
          const agent = runtime.subagents.require(conversationId!, agentId!);
          if (action === "stop") {
            await runtime.subagents.stop(conversationId!, agentId!);
            return json(response, 200, { stopped: true });
          }
          if (agent.legacy)
            throw new HttpError(
              409,
              "旧版记录未保存定义，请让主 Agent 创建新的子 Agent",
            );
          const instruction = text(input.instructions, "补充要求", 10000);
          const runId = await runtime.send(
            conversationId!,
            `继续委派给「${agent.name}」：\n${instruction}`,
            undefined,
            agent.id,
          );
          return json(response, 202, { runId });
        }
        const stop = path.match(/^\/api\/conversations\/([^/]+)\/stop$/);
        if (method === "POST" && stop) {
          await readBody();
          return json(response, 200, await runtime.stopConversation(stop[1]!));
        }
        if (method === "POST" && path === "/api/works") {
          const input = await readBody();
          if (
            input.kind !== undefined &&
            !["event", "interval"].includes(String(input.kind))
          )
            throw new HttpError(400, "未知触发方式");
          return json(
            response,
            201,
            runtime.createWork(text(input.conversationId, "来源对话", 100), {
              title: text(input.title, "目标名称", 160),
              goal: text(input.goal, "目标说明", 4000),
              completionCriteria: input.completionCriteria === undefined || input.completionCriteria === "" ? "" : text(input.completionCriteria, "完成要求", 4000),
              kind: input.kind as "event" | "interval" | undefined,
              instructions:
                input.instructions === undefined
                  ? undefined
                  : text(input.instructions, "执行要求", 4000),
              intervalMinutes: input.intervalMinutes as number | undefined,
            }),
          );
        }
        const workDefinition = path.match(/^\/api\/works\/([^/]+)$/);
        if (method === "PATCH" && workDefinition) {
          const input = await readBody();
          const patch: Partial<Work> = {};
          if (input.title !== undefined) patch.title = text(input.title, "目标名称", 160);
          if (input.goal !== undefined) patch.goal = text(input.goal, "目标说明", 4000);
          if (input.completionCriteria !== undefined) patch.completionCriteria = input.completionCriteria === "" ? "" : text(input.completionCriteria, "完成要求", 4000);
          if (!Object.keys(patch).length) throw new HttpError(400, "请提供目标名称、说明或完成要求");
          const updated = runtime.store.updateWork(workDefinition[1]!, patch);
          runtime.changed();
          return json(response, 200, updated);
        }
        const workAction = path.match(/^\/api\/works\/([^/]+)\/action$/);
        if (method === "POST" && workAction) {
          const input = await readBody();
          if (!["pause", "resume", "end"].includes(String(input.action)))
            throw new HttpError(400, "未知目标操作");
          return json(
            response,
            200,
            await runtime.action(
              workAction[1]!,
              input.action as "pause" | "resume" | "end",
            ),
          );
        }
        const workRun = path.match(/^\/api\/works\/([^/]+)\/run$/);
        if (method === "POST" && workRun) {
          await readBody();
          return json(response, 202, runtime.runWork(workRun[1]!));
        }
        const object = path.match(/^\/api\/objects\/([^/]+)$/);
        if (method === "PATCH" && object) {
          const input = await readBody();
          if (
            !Number.isInteger(input.version) ||
            !input.data ||
            typeof input.data !== "object" ||
            Array.isArray(input.data)
          )
            throw new HttpError(400, "需要对象版本和完整数据");
          return json(
            response,
            200,
            runtime.updateObject(
              object[1]!,
              input.version as number,
              input.data as Record<string, unknown>,
            ),
          );
        }
        const trigger = path.match(/^\/api\/works\/([^/]+)\/trigger$/);
        if (method === "POST" && trigger) {
          const input = await readBody();
          if (!["event", "interval"].includes(String(input.kind)))
            throw new HttpError(400, "未知触发方式");
          if (
            input.intervalMinutes !== undefined &&
            (typeof input.intervalMinutes !== "number" ||
              !Number.isFinite(input.intervalMinutes))
          )
            throw new HttpError(400, "间隔需要是分钟数");
          return json(
            response,
            201,
            runtime.addTrigger(trigger[1]!, {
              kind: input.kind as "event" | "interval",
              instructions: text(input.instructions, "执行要求", 4000),
              intervalMinutes: input.intervalMinutes as number | undefined,
            }),
          );
        }
        const triggerUpdate = path.match(/^\/api\/triggers\/([^/]+)$/);
        if (method === "PATCH" && triggerUpdate) {
          const input = await readBody();
          return json(
            response,
            200,
            runtime.setTriggerEnabled(
              triggerUpdate[1]!,
              boolean(input.enabled),
            ),
          );
        }
        const demoEvent = path.match(
          /^\/api\/conversations\/([^/]+)\/demo-event$/,
        );
        if (method === "POST" && demoEvent) {
          await readBody();
          return json(response, 200, runtime.demoEvent(demoEvent[1]!));
        }
        if (method === "POST" && path === "/api/demo/reset") {
          await readBody();
          return json(response, 200, runtime.reset());
        }
        throw new HttpError(404, "接口不存在");
      }
      if (method !== "GET" && method !== "HEAD")
        throw new HttpError(405, "不支持此请求方式");
      if (path.split("/").some((segment) => segment.startsWith(".")))
        throw new HttpError(404, "文件不存在");
      const fullPath = resolve(distPath, `.${path}`);
      if (fullPath !== distPath && !fullPath.startsWith(distPath + sep))
        throw new HttpError(403, "路径无效");
      let file = fullPath;
      try {
        if (!(await stat(file)).isFile())
          file = resolve(distPath, "index.html");
      } catch {
        if (extname(path)) throw new HttpError(404, "文件不存在");
        file = resolve(distPath, "index.html");
      }
      let data: Buffer;
      try {
        data = await readFile(file);
      } catch {
        throw new HttpError(
          404,
          "前端尚未构建，请使用 Vite 开发入口或先运行 npm run build",
        );
      }
      const mime: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".ico": "image/x-icon",
        ".woff2": "font/woff2",
        ".json": "application/json",
      };
      response.writeHead(200, {
        "Content-Type": mime[extname(file)] ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control":
          extname(file) === ".html" ? "no-cache" : "public, max-age=3600",
      });
      response.end(method === "HEAD" ? undefined : data);
    } catch (error) {
      if (response.destroyed) return;
      if (response.headersSent) {
        response.end();
        return;
      }
      const status =
        error instanceof HttpError
          ? error.status
          : error instanceof URIError
            ? 400
            : 500;
      json(response, status, { error: safeErrorMessage(error) });
    }
  });
  server.on("upgrade", (request, socket, head) => {
    try {
      checkLocalOrigin(request, true);
      if (!request.headers.origin || new URL(request.url || "/", "http://localhost").pathname !== "/api/voice/stream") { socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return; }
      voiceStream.acceptUpgrade(request, socket, head);
    } catch { socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); }
  });
  server.on("close", () => {
    voiceStream.close();
    voice.close();
    clearInterval(heartbeat);
    workspaces.runtime.listeners.delete(listener);
    void workspaces.close();
    for (const response of clients) response.end();
  });
  server.requestTimeout = 30000;
  return Object.assign(server, { closeWorkspaces: () => workspaces.close() });
}

export async function startServer() {
  if (process.env.ORBIT_DESKTOP === "1" && !process.env.ORBIT_AUTH_TOKEN) throw new Error("桌面服务缺少访问凭证");
  const dataDir = resolve(process.env.ORBIT_DATA_DIR || resolve(root, ".agent-data/orbit"));
  const apps = await loadApps({ installedOnly: true });
  const runtime = new OrbitRuntime(
    new OrbitStore(resolve(dataDir, "orbit.sqlite")),
    apps,
    dataDir,
  );
  const server = createOrbitServer(runtime);
  const port = Number(process.env.ORBIT_PORT || 4330);
  try {
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw new Error("ORBIT_PORT 应为 0–65535 之间的端口号");
    await new Promise<void>((ready, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", reject);
        ready();
      });
    });
  } catch (error) {
    await server.closeWorkspaces();
    await runtime.close();
    server.close();
    runtime.store.close();
    const code = (error as NodeJS.ErrnoException).code;
    throw new Error(
      code === "EADDRINUSE"
        ? `Orbit 无法启动：端口 ${port} 已被占用。请设置 ORBIT_PORT 使用其他端口。`
        : `Orbit 无法启动：${safeErrorMessage(error)}`,
    );
  }
  server.on("error", (error) =>
    console.error(`Orbit 服务错误：${safeErrorMessage(error)}`),
  );
  runtime.initialize({ seed: false });
  const address = server.address();
  const actualPort = address && typeof address !== "string" ? address.port : port;
  console.log(`ORBIT_READY ${JSON.stringify({ port: actualPort, host: "127.0.0.1" })}`);
  const stop = async () => {
    await server.closeWorkspaces();
    await runtime.close();
    server.close();
    server.closeAllConnections();
    setTimeout(() => process.exit(0), 500).unref();
  };
  if (process.env.ORBIT_DESKTOP !== "1") {
    process.once("SIGINT", () => void stop());
    process.once("SIGTERM", () => void stop());
  }
  return { server, runtime };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  void startServer().catch((error) => {
    console.error(safeErrorMessage(error));
    process.exitCode = 1;
  });
