import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Activity,
  AppObject,
  Artifact,
  Message,
  Run,
  Trigger,
  Conversation,
  Work,
  Snapshot,
  AppManifest,
  Subagent,
  SubagentEvent,
  ConversationMemory,
  ConversationSection,
} from "../shared/types.ts";
import type { SaveObjectInput } from "../shared/plugin.ts";
import { markConversationDrafts } from "./conversation-drafts.ts";
import type { Project, SharedMemory } from "../shared/projects.ts";

export const now = () => new Date().toISOString();
export const id = (prefix: string) => `${prefix}-${randomUUID().slice(0, 12)}`;
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
type EntityMap = {
  projects: Project;
  sharedMemories: SharedMemory;
  sections: ConversationSection;
  memories: ConversationMemory;
  subagents: Subagent;
  subagentEvents: SubagentEvent;
  conversations: Conversation;
  works: Work;
  messages: Message;
  runs: Run;
  activities: Activity;
  objects: AppObject;
  artifacts: Artifact;
  triggers: Trigger;
};
type Table = keyof EntityMap;
const tables: Table[] = [
  "projects",
  "sharedMemories",
  "sections",
  "memories",
  "subagents",
  "subagentEvents",
  "conversations",
  "works",
  "messages",
  "runs",
  "activities",
  "objects",
  "artifacts",
  "triggers",
];
export interface PendingRun {
  runId: string;
  conversationId: string;
  workId?: string;
  prompt: string;
  source: string;
  createdAt: string;
}

/** Small local prototype store. Every mutation is durable before the UI is notified. */
export class OrbitStore {
  db: DatabaseSync;
  private transactionDepth = 0;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
    // v1 called every conversation a work. Rename the table before creating
    // the new independent works table; leave IDs and Pi session paths intact.
    const exists = (name: string) =>
      Boolean(
        this.db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
          )
          .get(name),
      );
    const legacy = exists("works") && !exists("conversations");
    if (legacy) this.db.exec("ALTER TABLE works RENAME TO conversations");
    for (const table of tables)
      this.db.exec(
        `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, value TEXT NOT NULL)`,
      );
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS pending (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
    if (legacy) this.migrateConversations();
    this.migrateProjects();
  }
  private isMainConversation(conversation: Pick<Conversation, "id">) {
    return conversation.id === "orbit-assistant" || conversation.id === this.metadata<string>("assistant:conversation:v1");
  }
  private projectName(name: string) {
    const value = name.trim();
    return ["", "日常随问", "未分区", "未分类"].includes(value) ? undefined : value;
  }
  ensureProject(name: string): Project | undefined {
    const normalized = this.projectName(name);
    if (!normalized) return undefined;
    const existing = this.list("projects").find(project => project.name === normalized);
    const section = this.list("sections").find(section => section.name === normalized);
    if (existing) {
      if (section && (section.pinned !== existing.pinned || section.order !== existing.order))
        return this.put("projects", { ...existing, pinned: section.pinned, order: section.order, updatedAt: now() });
      return existing;
    }
    return this.put("projects", {
      id: id("project"), name: normalized, summary: "", instructions: "",
      pinned: section?.pinned ?? false, order: section?.order ?? this.list("projects").length,
      archived: false, createdAt: now(), updatedAt: now(),
    });
  }
  /** Idempotent, additive migration. Existing conversation/session IDs are untouched. */
  migrateProjects() {
    this.transaction(() => {
      for (const section of this.list("sections")) {
        const onlyMain = this.list("conversations").filter(c => c.project === section.name).every(c => this.isMainConversation(c));
        if (section.name !== "Orbit" || !onlyMain) this.ensureProject(section.name);
      }
      for (const conversation of this.list("conversations")) {
        if (this.isMainConversation(conversation)) {
          if (conversation.projectId) this.put("conversations", { ...conversation, projectId: undefined });
          continue;
        }
        const project = (conversation.projectId ? this.get("projects", conversation.projectId) : undefined) ?? this.ensureProject(conversation.project);
        if (project && (conversation.projectId !== project.id || conversation.project !== project.name))
          this.put("conversations", { ...conversation, projectId: project.id, project: project.name });
      }
      this.setMetadata("projects:schema", 1);
    });
  }
  private migrateConversations() {
    this.transaction(() => {
      for (const table of [
        "messages",
        "runs",
        "activities",
        "objects",
        "artifacts",
        "triggers",
        "pending",
        "events",
      ])
        for (const row of this.db
          .prepare(`SELECT id,value FROM ${table}`)
          .all() as { id: string; value: string }[]) {
          const { workId, ...value } = JSON.parse(row.value);
          this.db.prepare(`UPDATE ${table} SET value=? WHERE id=?`).run(
            JSON.stringify({
              ...value,
              conversationId: workId ?? value.conversationId,
            }),
            row.id,
          );
        }
      for (const conversation of this.list("conversations")) {
        const triggers = this.list("triggers").filter(
          (t) => t.conversationId === conversation.id,
        );
        if (conversation.continuous || triggers.length) {
          const work = this.createWork(
            conversation.id,
            conversation.title,
            conversation.goal ||
              triggers[0]?.instructions ||
              conversation.title,
            {
              id: `ongoing-${conversation.id}`,
              status:
                conversation.status === "running"
                  ? "paused"
                  : conversation.status,
              summary: conversation.summary,
              createdAt: conversation.createdAt,
            },
          );
          for (const trigger of triggers)
            this.put("triggers", { ...trigger, workId: work.id });
          // Historical trigger executions have a definite owner; ordinary chat
          // turns remain conversation-only rather than guessing their ownership.
          for (const run of this.list("runs").filter(
            (r) =>
              r.conversationId === conversation.id &&
              ["新反馈触发更新", "定时检查", "恢复工作"].includes(r.title),
          ))
            this.put("runs", { ...run, workId: work.id });
          for (const pending of this.pending().filter(
            (p) =>
              p.conversationId === conversation.id &&
              triggers.some((t) => t.id === p.source),
          )) {
            this.db
              .prepare("UPDATE pending SET value=? WHERE id=?")
              .run(
                JSON.stringify({ ...pending, workId: work.id }),
                pending.runId,
              );
            this.put("runs", {
              ...this.require("runs", pending.runId),
              workId: work.id,
            });
          }
          if (conversation.panel?.kind === "activity")
            this.updateConversation(conversation.id, {
              panel: { kind: "work", workId: work.id },
            });
        }
        this.updateConversation(conversation.id, {
          continuous: false,
          ...(conversation.status === "waiting"
            ? { status: "idle" as const }
            : {}),
        });
      }
      this.setMetadata("schemaVersion", 2);
    });
  }
  close() {
    this.db.close();
  }
  list<K extends Table>(table: K): EntityMap[K][] {
    return (
      this.db.prepare(`SELECT value FROM ${table} ORDER BY rowid`).all() as {
        value: string;
      }[]
    ).map((row) => JSON.parse(row.value));
  }
  get<K extends Table>(table: K, key: string): EntityMap[K] | undefined {
    const row = this.db
      .prepare(`SELECT value FROM ${table} WHERE id=?`)
      .get(key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : undefined;
  }
  require<K extends Table>(table: K, key: string): EntityMap[K] {
    const value = this.get(table, key);
    if (!value) throw new HttpError(404, "未找到该内容");
    return value;
  }
  put<K extends Table>(table: K, value: EntityMap[K]): EntityMap[K] {
    if (table === "conversations") {
      const conversation = { ...value } as Conversation;
      const previous = this.get("conversations", conversation.id);
      if (this.isMainConversation(conversation)) delete conversation.projectId;
      else {
        // Older organization tools write the project name directly. Interpret an
        // explicit name change as reassignment rather than silently undoing it.
        const legacyMove = previous && conversation.project !== previous.project && conversation.projectId === previous.projectId;
        const project = legacyMove ? this.ensureProject(conversation.project)
          : (conversation.projectId ? this.get("projects", conversation.projectId) : undefined) ?? this.ensureProject(conversation.project);
        if (project) { conversation.projectId = project.id; conversation.project = project.name; }
        else delete conversation.projectId;
      }
      value = conversation as EntityMap[K];
    }
    this.db
      .prepare(
        `INSERT INTO ${table} (id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value`,
      )
      .run(value.id, JSON.stringify(value));
    return value;
  }
  metadata<T>(key: string): T | undefined {
    const row = this.db
      .prepare("SELECT value FROM metadata WHERE key=?")
      .get(key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : undefined;
  }
  setMetadata(key: string, value: unknown) {
    this.db
      .prepare(
        "INSERT INTO metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, JSON.stringify(value));
  }
  createConversation(
    title = "新对话",
    overrides: Partial<Conversation> = {},
  ): Conversation {
    const timestamp = now();
    const conversation: Conversation = {
      id: id("conversation"),
      order: Date.now(),
      title,
      project: "日常随问",
      pinned: false,
      archived: false,
      goal: "",
      status: "idle",
      summary: "",
      continuous: false,
      unread: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      panel: null,
      ...overrides,
    };
    if (!this.isMainConversation(conversation)) {
      const project = conversation.projectId ? this.require("projects", conversation.projectId) : this.ensureProject(conversation.project);
      if (project) { conversation.projectId = project.id; conversation.project = project.name; }
    } else delete conversation.projectId;
    return this.put("conversations", conversation);
  }
  updateConversation(
    conversationId: string,
    patch: Partial<Conversation>,
  ): Conversation {
    const previous = this.require("conversations", conversationId);
    const conversation: Conversation = {
      ...previous,
      ...patch,
      id: conversationId,
      updatedAt: now(),
    };
    if (this.isMainConversation(conversation)) delete conversation.projectId;
    else if (Object.hasOwn(patch, "projectId")) {
      const project = patch.projectId ? this.require("projects", patch.projectId) : undefined;
      conversation.projectId = project?.id;
      conversation.project = project?.name ?? "日常随问";
    } else if (patch.project !== undefined && patch.project !== previous.project) {
      const project = this.ensureProject(patch.project);
      conversation.projectId = project?.id;
      conversation.project = project?.name ?? patch.project;
    }
    return this.put("conversations", conversation);
  }
  createWork(
    conversationId: string,
    title: string,
    goal: string,
    overrides: Partial<Work> = {},
  ): Work {
    this.require("conversations", conversationId);
    return this.put("works", {
      id: id("work"),
      conversationId,
      title,
      goal,
      status: "needs_input",
      summary: "等待你继续推进，或添加后续安排",
      createdAt: now(),
      updatedAt: now(),
      ...overrides,
    });
  }
  updateWork(workId: string, patch: Partial<Work>): Work {
    return this.put("works", {
      ...this.require("works", workId),
      ...patch,
      id: workId,
      updatedAt: now(),
    });
  }
  addMessage(
    conversationId: string,
    role: Message["role"],
    content: string,
    runId?: string,
  ): Message {
    this.require("conversations", conversationId);
    return this.put("messages", {
      id: id("message"),
      conversationId,
      role,
      content,
      createdAt: now(),
      ...(runId ? { runId } : {}),
    });
  }
  activity(
    conversationId: string,
    kind: Activity["kind"],
    title: string,
    detail = "",
    extra: Partial<Activity> = {},
  ): Activity {
    return this.put("activities", {
      id: id("activity"),
      conversationId,
      kind,
      title,
      detail,
      createdAt: now(),
      ...extra,
    });
  }
  saveObject(conversationId: string, input: SaveObjectInput, seed = false): AppObject {
    this.require("conversations", conversationId);
    const existing = input.id ? this.require("objects", input.id) : undefined;
    if (
      existing &&
      (existing.conversationId !== conversationId ||
        existing.appId !== input.appId)
    )
      throw new HttpError(403, "不能修改其他工作或应用的对象");
    if (existing && input.expectedVersion !== existing.version)
      throw new HttpError(409, "内容已被更新，请刷新后重试");
    return this.put("objects", {
      id: existing?.id ?? id("object"),
      conversationId,
      appId: input.appId,
      type: input.type,
      title: input.title,
      data: input.data,
      version: (existing?.version ?? 0) + 1,
      updatedAt: now(),
      ...(seed ? { seed: true as const } : {}),
    });
  }
  enqueue(run: Run, prompt: string, source: string) {
    this.transaction(() => {
      this.put("runs", run);
      this.db.prepare("INSERT INTO pending VALUES (?,?)").run(
        run.id,
        JSON.stringify({
          runId: run.id,
          conversationId: run.conversationId,
          ...(run.workId ? { workId: run.workId } : {}),
          prompt,
          source,
          createdAt: now(),
        } satisfies PendingRun),
      );
    });
  }
  pending(): PendingRun[] {
    return (
      this.db.prepare("SELECT value FROM pending ORDER BY rowid").all() as {
        value: string;
      }[]
    ).map((row) => JSON.parse(row.value));
  }
  removePending(runId: string) {
    this.db.prepare("DELETE FROM pending WHERE id=?").run(runId);
  }
  saveEvent(conversationId: string, eventName: string, detail: string) {
    const event = {
      id: id("event"),
      conversationId,
      eventName,
      detail,
      createdAt: now(),
    };
    this.db
      .prepare("INSERT INTO events VALUES (?,?)")
      .run(event.id, JSON.stringify(event));
    return event;
  }
  transaction<T>(operation: () => T): T {
    if (this.transactionDepth) return operation();
    this.db.exec("BEGIN IMMEDIATE");
    this.transactionDepth++;
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.transactionDepth--;
    }
  }
  recoverInterrupted() {
    for (const agent of this.list("subagents"))
      if (agent.status === "running")
        this.put("subagents", {
          ...agent,
          status: "failed",
          summary: "执行因服务重启中断，可继续委派。",
          updatedAt: now(),
        });
    for (const event of this.list("subagentEvents"))
      if (event.status === "running")
        this.put("subagentEvents", {
          ...event,
          status: "failed",
          content: "执行因服务重启中断。",
        });
    for (const run of this.list("runs"))
      if (run.status === "running") {
        this.put("runs", {
          ...run,
          status: "interrupted",
          finishedAt: now(),
          summary: "服务重启，已保留进度。可恢复工作继续执行。",
        });
        this.removePending(run.id);
      }
    for (const work of this.list("works"))
      if (work.status === "running")
        this.updateWork(work.id, {
          status: "paused",
          summary: "上次执行因服务重启中断，已有内容已保存。可恢复工作。",
        });
    for (const work of this.list("conversations"))
      if (work.status === "running") {
        this.updateConversation(work.id, {
          status: "paused",
          summary: "上次执行因服务重启中断，已有内容已保存。点击恢复继续。",
        });
        this.activity(
          work.id,
          "info",
          "执行已中断",
          "服务重启后不会自动重复未知结果的操作，可手动恢复。",
        );
      }
  }
  reset() {
    this.transaction(() => {
      for (const table of [...tables, "metadata", "pending", "events"])
        this.db.exec(`DELETE FROM ${table}`);
    });
  }
  deleteConversation(conversationId: string) {
    this.transaction(() => {
      // A branch is an independent conversation. Preserve it when its source is removed.
      for (const child of this.list("conversations").filter(c => c.parentId === conversationId)) {
        const { parentId, forkMessageId, ...rest } = child;
        this.put("conversations", rest);
      }
      this.db
        .prepare("DELETE FROM conversations WHERE id=?")
        .run(conversationId);
      for (const table of [
        ...tables.filter((table) => table !== "conversations"),
        "pending",
        "events",
      ])
        this.db
          .prepare(
            `DELETE FROM ${table} WHERE json_extract(value, '$.conversationId')=?`,
          )
          .run(conversationId);
      this.db
        .prepare("DELETE FROM metadata WHERE key IN (?,?,?)")
        .run(`session:${conversationId}`, `loaded:${conversationId}`, `surface:${conversationId}`);
    });
  }
  snapshot(apps: AppManifest[], model: string, configured: boolean): Snapshot {
    const snapshot: Snapshot = {
      projects: this.list("projects").sort((a,b) => Number(b.pinned)-Number(a.pinned) || a.order-b.order),
      memories: this.list("memories"),
      subagents: this.list("subagents"),
      subagentEvents: this.list("subagentEvents"),
      works: this.list("works").sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      ),
      conversations: this.list("conversations").sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      ),
      messages: this.list("messages"),
      runs: this.list("runs"),
      activities: this.list("activities").slice(-500),
      objects: this.list("objects"),
      artifacts: this.list("artifacts"),
      triggers: this.list("triggers"),
      apps,
      model,
      configured,
    };
    snapshot.conversations = markConversationDrafts(snapshot);
    return snapshot;
  }
}
