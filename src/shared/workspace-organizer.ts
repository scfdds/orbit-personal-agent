export interface WorkspaceOrganizerSettings {
  enabled: boolean;
  intervalMinutes: 15 | 60 | 240;
}

export type WorkspaceOrganizerActionKind = "move" | "create_project" | "rename";
export interface WorkspaceOrganizerAction {
  id: string;
  kind: WorkspaceOrganizerActionKind;
  state: "pending" | "applied" | "dismissed" | "undone" | "stale";
  conversationId: string;
  title: string;
  description: string;
  reason: string;
  createdAt: string;
  appliedAt?: string;
  automatic: boolean;
  fromLabel?: string;
  toLabel?: string;
  sourceIds: string[];
}

export interface WorkspaceOrganizerState {
  settings: WorkspaceOrganizerSettings;
  status: "idle" | "queued" | "running" | "error";
  pendingCount: number;
  lastRunAt?: string;
  lastError?: string;
  actions: WorkspaceOrganizerAction[];
}
