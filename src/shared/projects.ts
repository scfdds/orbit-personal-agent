/** A persistent shared context, independent of any conversation or model session. */
export interface Project {
  id: string;
  name: string;
  summary: string;
  instructions: string;
  icon?: string;
  pinned: boolean;
  order: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export type SharedMemoryKind = "preference" | "decision" | "constraint" | "fact" | "question";
export interface SharedMemoryItem {
  id: string;
  kind: SharedMemoryKind;
  text: string;
  /** Canonical message IDs, resolved against their current conversation ownership. */
  sourceIds: string[];
  edited?: boolean;
  deleted?: boolean;
}
export interface SharedMemory {
  id: string;
  scope: "general" | "project";
  projectId?: string;
  version: number;
  status: "empty" | "queued" | "updating" | "ready" | "failed";
  items: SharedMemoryItem[];
  updatedAt: string;
  error?: string;
  /** Content hash of the evidence already consolidated; not a UI concept. */
  sourceKey?: string;
}
export interface SharedMemoryPatch {
  itemId?: string;
  text?: string;
  deleted?: boolean;
  kind?: SharedMemoryKind;
  sourceIds?: string[];
}
export interface ProjectInput {
  name: string;
  summary?: string;
  instructions?: string;
  icon?: string;
}
export type ProjectPatch = Partial<ProjectInput & Pick<Project, "pinned" | "order" | "archived">>;

export interface MemoryDocument {
  path: string;
  content: string;
  version: number;
  status: SharedMemory["status"];
  error?: string;
}

export interface MemoryFile {
  /** Scope-relative, canonical name; never an arbitrary filesystem path. */
  name: string;
  label: string;
  path: string;
  readonly: boolean;
  kind: "core" | "index" | "recap";
  conversationId?: string;
  updatedAt?: string;
}
export interface MemoryFileDocument extends MemoryFile {
  content: string;
  version: number;
  status: SharedMemory["status"];
  error?: string;
}

/** Only the two applicable scopes are loaded; no other project's facts are included. */
export interface ProjectContext {
  /** Full document revisions invalidate prior tool results even outside excerpt budgets. */
  revision?: string;
  retrieval?: { tool: "shared_memory_read"; instruction: string; files: Array<{ projectId?: string; name: string; kind: "core" | "index" }> };
  general: SharedMemoryItem[];
  /** Exact user-authored Markdown, separate from subsequent generated additions. */
  generalDocument?: string;
  /** Full files remain readable via shared_memory_read when context is shortened. */
  generalDocumentPath?: string;
  generalDocumentTruncated?: boolean;
  project?: Pick<Project, "id" | "name" | "summary" | "instructions"> & { memory: SharedMemoryItem[]; document?: string; documentPath?: string; documentTruncated?: boolean };
}
