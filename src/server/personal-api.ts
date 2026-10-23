import type { OrbitRuntime } from "./runtime.ts";
import { HttpError } from "./store.ts";
import type { SharedMemory } from "../shared/projects.ts";

type Input = Record<string, unknown>;
export interface PersonalResponse { status: number; value: unknown }
function string(value: unknown, name: string, max = 2000, empty = false): string {
  if (typeof value !== "string" || (!empty && !value.trim()) || value.length > max) throw new HttpError(400, `${name}无效`);
  return value.trim();
}
function bool(value: unknown) {
  if (typeof value !== "boolean") throw new HttpError(400, "需要布尔值");
  return value;
}
function projectPatch(input: Input) {
  const patch: { name?: string; summary?: string; instructions?: string; icon?: string; pinned?: boolean; archived?: boolean } = {};
  for (const key of ["name", "summary", "instructions", "icon"] as const) {
    if (input[key] !== undefined) patch[key] = string(input[key], key, key === "name" ? 160 : key === "icon" ? 32 : 4000, key !== "name");
  }
  for (const key of ["pinned", "archived"] as const) if (input[key] !== undefined) patch[key] = bool(input[key]);
  return patch;
}

/** Runs inside the same origin/token checks as all other local API routes. */
export async function personalApi(runtime: OrbitRuntime, path: string, method: string, readBody: () => Promise<Input>): Promise<PersonalResponse | null> {
  const ok = (value: unknown, status = 200) => ({ status, value });
  if (path === "/api/organizer") {
    if (method !== "GET") throw new HttpError(405, "不支持此操作");
    return ok(runtime.organizer.state());
  }
  if (path === "/api/organizer/settings") {
    if (method !== "PATCH") throw new HttpError(405, "不支持此操作");
    return ok(runtime.organizer.configure(await readBody()));
  }
  if (path === "/api/organizer/scan") {
    if (method !== "POST") throw new HttpError(405, "不支持此操作");
    await readBody();
    return ok(runtime.organizer.scan(), 202);
  }
  const organization = path.match(/^\/api\/organizer\/actions\/([^/]+)\/(undo)$/);
  if (organization) {
    if (method !== "POST") throw new HttpError(405, "不支持此操作");
    await readBody();
    return ok(runtime.organizer.undo(organization[1]!));
  }
  if (path === "/api/projects") {
    if (method === "GET") return ok(runtime.projects.list());
    if (method === "POST") { const input = await readBody(); return ok(runtime.projects.create({ ...projectPatch(input), name: string(input.name, "项目名称", 160) }), 201); }
    throw new HttpError(405, "不支持此操作");
  }
  const project = path.match(/^\/api\/projects\/([^/]+)$/);
  if (project) {
    const projectId = project[1]!;
    if (method === "GET") return ok(runtime.projects.get(projectId));
    if (method === "PATCH") return ok(runtime.projects.update(projectId, projectPatch(await readBody())));
    if (method === "DELETE") {
      if (runtime.store.list("conversations").some(c => c.projectId === projectId && runtime.active.has(c.id))) throw new HttpError(409, "请先停止项目中正在执行的工作");
      const members = runtime.store.list("conversations").filter(c => c.projectId === projectId);
      runtime.projects.delete(projectId);
      for (const member of members) runtime.organizer.protect(member.id, { project: true });
      return ok({ deleted: true });
    }
    throw new HttpError(405, "不支持此操作");
  }
  const createConversation = path.match(/^\/api\/projects\/([^/]+)\/conversations$/);
  if (createConversation) {
    const projectId = createConversation[1]!;
    runtime.projects.get(projectId);
    if (method === "GET") return ok(runtime.store.list("conversations").filter(c => c.projectId === projectId && !c.archived));
    if (method === "POST") {
      const input = await readBody();
      const conversation = runtime.createConversation(string(input.title, "讨论标题", 160));
      const assigned = runtime.projects.assignConversation(conversation.id, projectId);
      runtime.organizer.protect(conversation.id);
      return ok(assigned, 201);
    }
    throw new HttpError(405, "不支持此操作");
  }
  const move = path.match(/^\/api\/conversations\/([^/]+)\/project$/);
  if (move) {
    if (method !== "PUT") throw new HttpError(405, "不支持此操作");
    const conversationId = move[1]!;
    if (runtime.assistant.isMain(conversationId)) throw new HttpError(400, "主对话不属于某个项目");
    if (runtime.active.has(conversationId)) throw new HttpError(409, "请等本次回复完成后再调整归属");
    const input = await readBody();
    const assigned = runtime.projects.assignConversation(conversationId, input.projectId === null ? null : string(input.projectId, "项目", 100));
    runtime.organizer.protect(conversationId, { project: true });
    return ok(assigned);
  }
  const files = path.match(/^\/api\/(?:projects\/([^/]+)\/memory|memory\/global)\/files(?:\/(.+))?$/);
  if (files) {
    if (method !== "GET") throw new HttpError(405, "索引和摘要是只读文件；核心记忆通过文档编辑保存");
    return ok(files[2] ? runtime.projects.readFile(files[1], files[2]) : runtime.projects.listFiles(files[1]));
  }
  const document = path.match(/^\/api\/(?:projects\/([^/]+)\/memory|memory\/global)\/document$/);
  if (document) {
    const projectId = document[1];
    if (method === "GET") return ok(runtime.projects.readDocument(projectId));
    if (method === "PATCH") {
      const input = await readBody();
      if (!Number.isInteger(input.version) || (input.version as number) < 0) throw new HttpError(400, "需要当前记忆版本");
      if (typeof input.content !== "string" || input.content.length > 100000) throw new HttpError(400, "记忆文件应为 100000 字符以内的 Markdown");
      return ok(runtime.projects.saveDocument(projectId, input.version as number, input.content));
    }
    throw new HttpError(405, "不支持此操作");
  }
  const memory = path.match(/^\/api\/(?:projects\/([^/]+)\/memory|memory\/(global))(?:\/(refresh))?$/);
  if (memory) {
    const projectId = memory[1];
    if (projectId) runtime.projects.get(projectId);
    if (method === "GET" && !memory[3]) return ok(runtime.projects.getMemory(projectId));
    if (method === "POST" && memory[3]) {
      await readBody();
      const discussions = runtime.store.list("conversations").filter(c => !c.archived && (projectId ? c.projectId === projectId : runtime.assistant.isMain(c.id)));
      for (const c of discussions) void runtime.projects.schedule(c.id);
      return ok(runtime.projects.getMemory(projectId), 202);
    }
    if (method === "PATCH" && !memory[3]) {
      const input = await readBody();
      if (!Number.isInteger(input.version) || (input.version as number) < 0) throw new HttpError(400, "需要当前记忆版本");
      const kind = input.kind;
      if (kind !== undefined && !["preference", "decision", "constraint", "fact", "question"].includes(String(kind))) throw new HttpError(400, "记忆类型无效");
      if (input.sourceIds !== undefined && (!Array.isArray(input.sourceIds) || input.sourceIds.length > 20 || input.sourceIds.some(v => typeof v !== "string" || v.length > 160))) throw new HttpError(400, "原文引用无效");
      return ok(runtime.projects.updateMemory(projectId, input.version as number, {
        ...(input.itemId === undefined ? {} : { itemId: string(input.itemId, "记忆", 160) }),
        ...(input.text === undefined ? {} : { text: string(input.text, "记忆内容", 2000) }),
        ...(input.deleted === undefined ? {} : { deleted: bool(input.deleted) }),
        ...(kind === undefined ? {} : { kind: kind as SharedMemory["items"][number]["kind"] }),
        ...(input.sourceIds === undefined ? {} : { sourceIds: input.sourceIds as string[] }),
      }));
    }
    throw new HttpError(405, "不支持此操作");
  }
  if (path === "/api/wechat/demo") {
    if (method === "GET") return ok(runtime.wechatPersonal.demoState());
    if (method === "POST") return ok(runtime.wechatPersonal.demoAction(await readBody()));
    throw new HttpError(405, "不支持此操作");
  }
  if (path === "/api/wechat/personal" && method === "GET") return ok(runtime.wechatPersonal.state());
  if (path === "/api/wechat/topics" && method === "GET") return ok(runtime.wechatPersonal.pending());
  if (path === "/api/wechat/contacts/watching") {
    if (method !== "PATCH") throw new HttpError(405, "不支持此操作");
    return ok(runtime.wechatPersonal.setWatching(await readBody()));
  }
  const contact = path.match(/^\/api\/wechat\/contacts\/([^/]+)\/(context|analyze|dismiss|open)$/);
  if (contact) {
    const id = contact[1]!; const input = await readBody();
    if (method === "PATCH" && contact[2] === "context") return ok(runtime.wechatPersonal.patch(id, input));
    if (method === "POST" && contact[2] === "analyze") return ok(await runtime.wechatPersonal.analyze(id));
    if (method === "POST" && contact[2] === "dismiss") { runtime.wechatPersonal.dismiss(id, string(input.topicId, "话题", 100)); return ok({ dismissed: true }); }
    if (method === "POST" && contact[2] === "open") {
      const main = runtime.assistant.getState().conversationId;
      if (runtime.active.has(main)) throw new HttpError(409, "请等主对话回复结束再继续聊");
      return ok(runtime.wechatPersonal.handoff(id, string(input.topicId, "话题", 100), main));
    }
    throw new HttpError(405, "不支持此操作");
  }
  if (path.startsWith("/api/wechat") && runtime.wechatPersonal.demoState().state.active) throw new HttpError(409, "演示中不访问真实微信数据，请先退出演示");
  if (path === "/api/wechat") {
    if (method === "GET") return ok(runtime.wechat.state());
    if (method === "DELETE") { runtime.wechatPersonal.invalidate(undefined, true); await runtime.wechat.clear(); return ok(runtime.wechat.state()); }
    throw new HttpError(405, "不支持此操作");
  }
  if (path === "/api/wechat/capture") {
    if (method !== "POST") throw new HttpError(405, "不支持此操作");
    const input = await readBody();
    const enabled = bool(input.enabled);
    if (!enabled) runtime.wechatPersonal.invalidate();
    await runtime.wechat.capture(enabled);
    return ok(runtime.wechat.state());
  }
  const chat = path.match(/^\/api\/wechat\/chats\/([^/]+)(?:\/(messages|interpret))?$/);
  if (chat) {
    const chatId = chat[1]!;
    if (method === "GET" && chat[2] === "messages") return ok(runtime.wechat.read(chatId));
    if (method === "POST" && chat[2] === "interpret") { await readBody(); return ok(await runtime.wechat.interpret(chatId)); }
    if (method === "PATCH" && !chat[2]) { const input = await readBody(); const enabled = bool(input.enabled); if (!enabled) runtime.wechatPersonal.invalidate(chatId); return ok(runtime.wechat.patchChat(chatId, { enabled })); }
    if (method === "DELETE" && !chat[2]) { runtime.wechatPersonal.invalidate(chatId, true); runtime.wechat.remove(chatId); return ok({ deleted: true }); }
    throw new HttpError(405, "不支持此操作");
  }
  return null;
}
