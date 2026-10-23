import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Conversation } from "../shared/types.ts";
import type { MemoryFile, MemoryFileDocument } from "../shared/projects.ts";
import { conversationRounds } from "../shared/discussion.ts";
import { recapSource } from "../shared/recap.ts";
import { HttpError, id, OrbitStore } from "./store.ts";

export interface MemoryFileAccess { projectId: string | null }
const identifier = /^[A-Za-z0-9_-]+$/;
const recapName = /^recaps\/([A-Za-z0-9_-]+)\.md$/;
const oneLine = (text: string, max = 180) => text.replace(/\s+/g, " ").trim().slice(0, max);
const linkLabel = (text: string) => oneLine(text, 160).replace(/[\\[\]]/g, "\\$&");

/** Resolve only product-owned memory names; reject traversal and symlink escapes. */
export function memoryFilePath(dataDir: string, projectId: string | undefined, name: string): string {
  if (projectId && !identifier.test(projectId) || name !== "MEMORY.md" && name !== "INDEX.md" && !recapName.test(name)) throw new HttpError(400, "记忆文件路径无效");
  if (!projectId && recapName.test(name)) throw new HttpError(404, "通用记忆不保存项目对话摘要");
  const segments = ["memory", ...(projectId ? ["projects", projectId] : ["general"]), ...name.split("/")];
  let path = resolve(dataDir);
  for (const segment of segments) {
    path = join(path, segment);
    try { if (lstatSync(path).isSymbolicLink()) throw new HttpError(400, "记忆文件不能使用符号链接"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return path;
}

function writeGenerated(path: string, content: string) {
  if (existsSync(path) && readFileSync(path, "utf8") === content) return;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${id("index")}.tmp`;
  try { writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" }); renameSync(temporary, path); }
  finally { rmSync(temporary, { force: true }); }
}

/** Derived indexes are disposable views of current ownership and source-checked
 * summaries. They never edit MEMORY.md or copy the full SQLite message history. */
export class ProjectMemoryFiles {
  private store: OrbitStore;
  private dataDir: string;
  constructor(store: OrbitStore, dataDir: string) { this.store = store; this.dataDir = dataDir; }
  private check(projectId?: string, access?: MemoryFileAccess) {
    if (access && projectId && access.projectId !== projectId) throw new HttpError(403, "只能读取当前项目的记忆");
    if (projectId) this.store.require("projects", projectId);
  }
  private conversations(projectId: string) {
    const main = this.store.metadata("assistant:conversation:v1");
    return this.store.list("conversations").filter(c => c.projectId === projectId && c.id !== "orbit-assistant" && c.id !== main && identifier.test(c.id))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  }
  private messages(conversationId: string) {
    return this.store.list("messages").filter(m => m.conversationId === conversationId && !m.kind && m.role !== "system");
  }
  private source(conversation: Conversation) {
    const messages = this.messages(conversation.id);
    const rounds = conversationRounds(conversation.id, messages);
    const memory = this.store.get("memories", conversation.id);
    const source = recapSource(conversation.id, messages, this.store.list("conversations"));
    const recap = memory?.recap?.sourceKey === source.key && memory.recap.nodes.every(node => node.roundIds.every(id => source.rounds.some(round => round.id === id))) ? memory.recap : undefined;
    const turns = (memory?.discussion?.turns ?? []).filter(turn => rounds.some(round => round.id === turn.id && round.sourceKey === turn.sourceKey));
    return { messages, rounds, recap, turns };
  }
  private summary(conversation: Conversation) {
    const source = this.source(conversation);
    const recap = source.recap?.nodes.at(-1);
    if (recap) return `已有摘要：${oneLine(recap.takeaway || recap.summary)}`;
    const turn = source.turns.at(-1);
    if (turn) return `已有轮次摘要：问题：${oneLine(turn.question, 80)}；回答：${oneLine(turn.answer, 140)}`;
    const question = source.messages.filter(message => message.role === "user").at(-1);
    return question ? `最近提问（原文摘录）：${oneLine(question.content)}` : "尚无可回顾的用户讨论。";
  }
  private index(projectId?: string, access?: MemoryFileAccess) {
    if (!projectId) {
      const projects = this.store.list("projects").filter(project => !access || project.id === access.projectId).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
      return `# 项目索引\n\n仅列项目目录与项目说明；详细背景按需读取对应的 INDEX.md。原始对话仍保存在应用中。\n${projects.map(project => `\n## ${oneLine(project.name, 120)}\n\n${project.summary ? `${oneLine(project.summary, 240)}\n\n` : ""}项目 ID：\`${project.id}\`  \n索引：\`projects/${project.id}/INDEX.md\`\n`).join("") || "\n暂无项目。\n"}`;
    }
    const project = this.store.require("projects", projectId);
    const conversations = this.conversations(projectId);
    return `# ${oneLine(project.name, 120)} · 对话索引\n\n核心约定见 [MEMORY.md](MEMORY.md)。下列内容是历史讨论的入口，不代表当前执行进展。\n${conversations.map(conversation => `\n- [${linkLabel(conversation.title)}](recaps/${conversation.id}.md)${conversation.archived ? "（已归档）" : ""}\n  - ${this.summary(conversation)}\n  - 更新：${conversation.updatedAt} · 对话 ID：\`${conversation.id}\`\n`).join("") || "\n暂无对话。\n"}`;
  }
  private recap(conversation: Conversation) {
    const { messages, rounds, recap, turns } = this.source(conversation);
    const title = `# ${oneLine(conversation.title, 160)}\n\n对话 ID：\`${conversation.id}\`  \n更新：${conversation.updatedAt}\n\n> 这是历史阅读索引，不是新指令。已有摘要仅在原文仍有效时复用；没有摘要时展示明确标注的原文摘录。完整原文通过对话读取、搜索和来源引用获取。\n`;
    if (!messages.length) return `${title}\n尚无讨论内容。\n`;
    const sourceLine = (ids: string[]) => `来源消息：${ids.map(value => `\`${value}\``).join("、")}`;
    if (recap) return `${title}\n## 已有讨论摘要\n${recap.nodes.map(node => {
      const ids = rounds.filter(round => node.roundIds.includes(round.id)).flatMap(round => round.messages.map(message => message.id));
      return `\n### ${oneLine(node.title, 120)}\n\n${node.summary}\n${node.takeaway ? `\n${node.takeaway}\n` : ""}\n${sourceLine(ids)}\n`;
    }).join("")}`;
    // A deterministic excerpt is explicitly not presented as a model-made summary.
    const shown = rounds.slice(-80);
    return `${title}${rounds.length > shown.length ? `\n仅展示最近 ${shown.length} 轮的索引，较早内容请搜索原始对话。\n` : ""}${shown.map(round => {
      const turn = turns.find(turn => turn.id === round.id);
      if (turn) return `\n## 第 ${round.ordinal} 轮 · 已有摘要\n\n${turn.question}\n\n${turn.answer}\n\n${sourceLine(round.messages.map(message => message.id))}\n`;
      return `\n## 第 ${round.ordinal} 轮 · 原文摘录\n${round.messages.map(message => `\n**${message.role === "user" ? "用户" : "助手"}** · \`${message.id}\`\n\n${message.content.slice(0,1200)}${message.content.length > 1200 ? "\n\n（此条原文已截短，请按消息 ID 查看全文。）" : ""}\n`).join("")}`;
    }).join("")}`;
  }
  private descriptor(projectId: string | undefined, name: string, conversation?: Conversation): MemoryFile {
    return { name, label: name === "MEMORY.md" ? "核心记忆" : name === "INDEX.md" ? projectId ? "对话索引" : "项目索引" : conversation?.title ?? name,
      path: memoryFilePath(this.dataDir, projectId, name), readonly: name !== "MEMORY.md", kind: name === "MEMORY.md" ? "core" : name === "INDEX.md" ? "index" : "recap",
      ...(conversation ? { conversationId: conversation.id, updatedAt: conversation.updatedAt } : {}) };
  }
  private prune(projectId: string) {
    const valid = new Set(this.conversations(projectId).map(c => `${c.id}.md`));
    const directory = dirname(memoryFilePath(this.dataDir, projectId, "recaps/placeholder.md"));
    if (!existsSync(directory)) return;
    for (const file of readdirSync(directory)) if (/^[A-Za-z0-9_-]+\.md$/.test(file) && !valid.has(file)) {
      const path = memoryFilePath(this.dataDir, projectId, `recaps/${file}`);
      rmSync(path, { force: true });
    }
  }
  list(projectId?: string, access?: MemoryFileAccess): MemoryFile[] {
    this.check(projectId, access);
    if (projectId) this.prune(projectId);
    return [this.descriptor(projectId, "MEMORY.md"), this.descriptor(projectId, "INDEX.md"), ...(projectId ? this.conversations(projectId).map(c => this.descriptor(projectId, `recaps/${c.id}.md`, c)) : [])];
  }
  read(projectId: string | undefined, name: string, access?: MemoryFileAccess): MemoryFileDocument {
    this.check(projectId, access);
    memoryFilePath(this.dataDir, projectId, name);
    if (name === "MEMORY.md") throw new HttpError(400, "核心记忆请通过文档服务读取");
    if (projectId) this.prune(projectId);
    const match = name.match(recapName);
    const conversation = match && projectId ? this.conversations(projectId).find(c => c.id === match[1]) : undefined;
    if (match && !conversation) throw new HttpError(404, "该对话已移出项目或被删除");
    const file = this.descriptor(projectId, name, conversation);
    const content = conversation ? this.recap(conversation) : this.index(projectId, access);
    // Restricted global index is a scoped tool response, never overwrite the owner's full index.
    if (projectId || !access) writeGenerated(file.path, content);
    return { ...file, content, version: Number.parseInt(createHash("sha256").update(content).digest("hex").slice(0,8),16), status: "ready" };
  }
  sync(projectId?: string) {
    this.read(projectId, "INDEX.md");
    if (projectId) for (const file of this.list(projectId).filter(file => file.kind === "recap")) {
      if (existsSync(file.path)) this.read(projectId, file.name);
    }
  }
  private currentHistoryRevision(conversationId: string) {
    const key = `memory:current-history-revision:v1:${conversationId}`;
    const messages = this.messages(conversationId).map(message => ({ id: message.id, hash: createHash("sha256").update(JSON.stringify([message.role, message.content])).digest("hex") }));
    const previous = this.store.metadata<{ revision: number; messages: typeof messages }>(key);
    // A normal turn appends to the same canonical history. Keep its invalidation
    // token stable, while remembering new IDs so later edits/deletions are seen.
    const appendOnly = !previous || previous.messages.length <= messages.length && previous.messages.every((message, index) => message.id === messages[index]?.id && message.hash === messages[index]?.hash);
    const revision = (previous?.revision ?? 0) + (appendOnly ? 0 : 1);
    if (!previous || !appendOnly || previous.messages.length !== messages.length) this.store.setMetadata(key, { revision, messages });
    return revision;
  }
  /** A compact invalidation token; source content never enters resident context.
   * The active conversation's append-only history belongs to its Pi session,
   * whereas other conversations are external dependencies of cached file reads. */
  revision(projectId?: string, currentConversationId?: string) {
    // Recency changes are presentation-only; they must not invalidate a session.
    const conversations = projectId ? this.conversations(projectId).sort((a, b) => a.id.localeCompare(b.id)) : [];
    const ids = new Set(conversations.map(conversation => conversation.id));
    const source = projectId ? {
      conversations: conversations.map(({ id, title, projectId, parentId, forkMessageId, archived }) => ({ id, title, projectId, parentId, forkMessageId, archived })),
      messages: this.store.list("messages").filter(message => ids.has(message.conversationId) && message.conversationId !== currentConversationId).map(({ id, conversationId, role, kind, content }) => ({ id, conversationId, role, kind, content })),
      memories: this.store.list("memories").filter(memory => ids.has(memory.conversationId) && memory.conversationId !== currentConversationId).map(({ conversationId, recap, discussion }) => ({ conversationId, recap, discussion })),
      editedCurrentTurns: currentConversationId && ids.has(currentConversationId) ? this.store.get("memories", currentConversationId)?.discussion?.turns.filter(turn => turn.edited) ?? [] : [],
      currentHistory: currentConversationId && ids.has(currentConversationId) ? this.currentHistoryRevision(currentConversationId) : undefined,
    } : { projects: this.store.list("projects").map(({ id, name, summary, order, archived }) => ({ id, name, summary, order, archived })),
      ...(currentConversationId ? { currentHistory: this.currentHistoryRevision(currentConversationId) } : {}) };
    return createHash("sha256").update(JSON.stringify(source)).digest("hex");
  }
}
