import type { Project } from "./projects.ts";
/** Read-only information about the host actually running Orbit. */
export interface ExecutionDevice {
  id: "local";
  name: string;
  platform: string;
  workspaceRoot: string;
}

export type ExecutionStatus =
  | "idle"
  | "running"
  | "waiting"
  | "needs_input"
  | "paused"
  | "completed"
  | "failed";
export type RunStatus =
  "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";
export type PanelRef =
  | { kind: "subagents"; agentId?: string }
  | { kind: "app"; appId: string; objectId?: string }
  | { kind: "artifact"; artifactId: string }
  | { kind: "activity" }
  | { kind: "work"; workId: string }
  | { kind: "browser"; url?: string };
export interface Conversation {
  /** Derived in snapshots: no messages, saved content or ongoing work yet. */
  draft?: boolean;
  order?: number;
  showcase?: { title: string; period: string; notice: string };
  /** Shared matter identity; each discussion keeps its own messages and context. */
  matterId?: string;
  matterTitle?: string;
  parentId?: string;
  forkMessageId?: string;
  inheritedContext?: string;
  inheritedSources?: string[];
  id: string;
  title: string;
  project: string;
  /** Stable project ownership. The legacy name remains for older views/tools. */
  projectId?: string;
  pinned: boolean;
  archived: boolean;
  goal: string;
  status: ExecutionStatus;
  summary: string;
  continuous: boolean;
  unread: boolean;
  createdAt: string;
  updatedAt: string;
  panel: PanelRef | null;
}
export interface ConversationSection {
  id: string;
  name: string;
  pinned: boolean;
  order: number;
  overview?: { text: string; sourceKey: string; updatedAt: string };
}
export interface SurfaceContext {
  view: "memory" | "overview" | "apps";
  sectionId?: string;
  conversationId?: string;
  messageId?: string;
  workId?: string;
  appId?: string;
}
export interface ConversationRoute {
  requestId: string;
  action: "new" | "resume" | "fork";
  conversationId: string;
  title: string;
  project: string;
  reason: string;
  fallback?: boolean;
}
export interface IntakeRequest {
  requestId: string;
  content: string;
  mode: "auto" | "new";
  project?: string;
}
export interface IntakeResult {
  conversationId: string;
  runId: string;
  route: ConversationRoute;
}
/** A persistent goal, independent from its source conversation and each execution. */
export interface Work {
  /** Authored UI replay only. Never dispatched or recorded as real executions. */
  showcase?: {
    clock: string;
    notice: string;
    entries: Array<{
      id: string;
      at: string;
      title: string;
      summary: string;
      detail: string;
      state: "done" | "planned";
      cadence?: string;
      addedBy?: string;
      finishedAt?: string;
      steps?: Array<{ at: string; title: string; detail?: string }>;
    }>;
  };
  completionCriteria?: string;
  id: string;
  conversationId: string;
  title: string;
  goal: string;
  status: ExecutionStatus;
  summary: string;
  createdAt: string;
  updatedAt: string;
}
/** One user request handed from the main conversation into an independent matter. */
export interface ConversationHandoff {
  sourceConversationId: string;
  sourceMessageId: string;
  action: "new" | "resume";
}
export interface Message {
  /** Files actually saved or read during this exact run; render as explicit open controls. */
  artifactIds?: string[];
  handoff?: ConversationHandoff;
  route?: ConversationRoute;
  linkedConversationId?: string;
  workId?: string;
  kind?: "work_created" | "conversation_link";
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  runId?: string;
}
/** Explicitly selected, actually read background for one execution. */
export interface ContextSource {
  conversationId: string;
  messageId: string;
  title: string;
  project: string;
  kind: "project" | "knowledge";
  reason: string;
  excerpt: string;
}
export interface Run {
  contextSources?: ContextSource[];
  subagentId?: string;
  instructions?: string;
  definition?: SubagentDefinition;
  workId?: string;
  id: string;
  conversationId: string;
  parentId: string | null;
  title: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  summary: string;
  error?: string;
}
export interface SubagentDefinition {
  name: string;
  systemPrompt: string;
  skillIds: string[];
  toolNames: string[];
  version: number;
}
export interface Subagent extends SubagentDefinition {
  id: string;
  conversationId: string;
  status: "idle" | "running" | "failed";
  summary: string;
  createdAt: string;
  updatedAt: string;
  legacy?: boolean;
}
export interface SubagentEvent {
  id: string;
  conversationId: string;
  agentId: string;
  runId: string;
  kind: "input" | "progress" | "tool" | "result" | "error";
  title: string;
  content: string;
  toolName?: string;
  input?: string;
  status?: "running" | "completed" | "failed";
  createdAt: string;
}
export interface SubagentCapabilities {
  skills: { id: string; name: string; description: string }[];
  tools: { name: string; label: string; source: string }[];
  mcpServers: { id: string; name: string; tools: string[] }[];
}
export interface Activity {
  id: string;
  conversationId: string;
  runId?: string;
  kind: "tool" | "run" | "object" | "trigger" | "workspace" | "info";
  title: string;
  detail: string;
  status?: "running" | "completed" | "failed";
  createdAt: string;
}
export interface AppObject {
  /** Initial app defaults only; cleared on the first actual save. */
  seed?: true;
  id: string;
  conversationId: string;
  appId: string;
  type: string;
  title: string;
  version: number;
  data: Record<string, unknown>;
  updatedAt: string;
}
export interface Artifact {
  workId?: string;
  id: string;
  conversationId: string;
  title: string;
  content: string;
  format: "markdown";
  updatedAt: string;
}
export interface Trigger {
  workId: string;
  id: string;
  conversationId: string;
  kind: "event" | "interval";
  eventName?: string;
  intervalMinutes?: number;
  enabled: boolean;
  nextRunAt?: string;
  instructions: string;
  createdAt: string;
}
export interface AppManifest {
  id: string;
  name: string;
  /** Catalog metadata; capability names and tool contracts remain independent. */
  category?: "productivity" | "finance" | "legal" | "design" | "research" | "education" | "development" | "lifestyle";
  publisher?: string;
  starterPrompts?: string[];
  version: string;
  description: string;
  icon: string;
  capabilities: string[];
  permissions: string[];
  panel: { entry: string };
  tools: { name: string; description: string }[];
}
export interface Snapshot {
  workspaceMode?: import("./workspace-mode.ts").WorkspaceMode;
  projects?: Project[];
  sections?: ConversationSection[];
  memories?: ConversationMemory[];
  subagents: Subagent[];
  subagentEvents: SubagentEvent[];
  subagentCapabilities?: SubagentCapabilities;
  works: Work[];
  conversations: Conversation[];
  messages: Message[];
  runs: Run[];
  activities: Activity[];
  objects: AppObject[];
  artifacts: Artifact[];
  triggers: Trigger[];
  apps: AppManifest[];
  model: string;
  configured: boolean;
}
export type MemoryKind = "decision" | "idea" | "question" | "fact";
export interface MemoryItem {
  id: string;
  kind: MemoryKind;
  text: string;
  sourceIds: string[];
  edited?: boolean;
  deleted?: boolean;
}
export interface ConversationMemory {
  recap?: ConversationRecap;
  discussion?: DiscussionMemory;
  id: string;
  conversationId: string;
  version: number;
  status: "empty" | "queued" | "updating" | "ready" | "failed";
  summary: string;
  summaryEdited?: boolean;
  items: MemoryItem[];
  coveredMessageId?: string;
  updatedAt: string;
  error?: string;
}
export interface ConversationRecap {
  sourceKey: string;
  nodes: Array<{ id: string; roundIds: string[]; title: string; summary: string; takeaway?: string }>;
}
export interface TurnSummary {
  id: string;
  sourceKey: string;
  question: string;
  answer: string;
  merge?: { question: string; answer: string };
  edited?: boolean;
}
export interface DiscussionMemory {
  version: number;
  status: "empty" | "queued" | "updating" | "ready" | "failed";
  turns: TurnSummary[];
  error?: string;
}
export type ServerEvent =
  | { type: "state" }
  | { type: "workspace_mode"; workspaceMode: import("./workspace-mode.ts").WorkspaceMode }
  | {
      type: "delta" | "stream_sync";
      conversationId: string;
      runId: string;
      text: string;
    }
  | { type: "run_end"; conversationId: string; runId: string };
export interface FeedbackItem {
  id: string;
  source: string;
  segment: "new" | "active";
  customer: string;
  text: string;
  topic: string;
  excluded: boolean;
  createdAt: string;
}
export interface FeedbackData {
  items: FeedbackItem[];
}
export interface Opportunity {
  id: string;
  title: string;
  description: string;
  priority: "P0" | "P1" | "P2";
  status: "proposed" | "planned" | "watching";
  feedbackIds: string[];
  category: string;
}
export interface OpportunityData {
  items: Opportunity[];
  focus: string;
}
