import type { AssistantDelivery } from "./delivery.ts";

export type AssistantWorkspaceKind = "conversation" | "artifact" | "app";

export interface AssistantWorkspaceTab {
  id: string;
  kind: AssistantWorkspaceKind;
  conversationId: string;
  title: string;
  messageId?: string;
  artifactId?: string;
  appId?: string;
  objectId?: string;
}

export interface AssistantWorkspace {
  tabs: AssistantWorkspaceTab[];
  activeTabId: string | null;
  revision: number;
}

export interface AssistantState {
  conversationId: string;
  workspace: AssistantWorkspace;
  /** Originating run; valid only for the exact workspace revision it presented. */
  presentation?: { runId: string; conversationId: string; revision: number };
  deliveries: AssistantDelivery[];
  deliveryGeneration: number;
}

export interface AssistantMessageContext {
  conversationId?: string;
  messageId?: string;
  artifactId?: string;
  appId?: string;
  objectId?: string;
  quote?: string;
}

export interface AssistantWorkspaceAction {
  action: "open" | "close" | "activate" | "clear";
  conversationId?: string;
  tabId?: string;
  kind?: AssistantWorkspaceKind;
  messageId?: string;
  artifactId?: string;
  appId?: string;
  objectId?: string;
  expectedRevision?: number;
}

export interface AssistantMessageRequest {
  requestId: string;
  content: string;
  context?: AssistantMessageContext;
  visibleContext?: AssistantMessageContext;
}

export interface AssistantMessageResult {
  requestId: string;
  action: "answer" | "resume" | "new";
  conversationId: string;
  runId: string;
  reason: string;
  fallback?: boolean;
}

export interface AssistantOverviewItem {
  conversationId: string;
  title: string;
  project: string;
  summary: string;
  /** Short source excerpt, separate from the full stored context summary. */
  progress?: string;
  /** Current, evidence-backed reason to revisit this matter. */
  attentionReason?: string;
  status: string;
  updatedAt: string;
  lastMessageId?: string;
  lastRun?: { id: string; status: string; summary: string };
  artifacts: Array<{ id: string; title: string; updatedAt: string }>;
  unread: boolean;
  example: boolean;
}

export interface AssistantOverview {
  items: AssistantOverviewItem[];
  briefing?: { text: string; updatedAt?: string; conversationIds: string[] };
}
export interface ModelConfigurationState { configured: boolean; model: string }
export type AssistantDispatchResult = AssistantMessageResult;
export type ModelSettingsState = ModelConfigurationState;

/** Captured when the user sends, never inferred from later window selection. */
export interface AssistantContextSnapshot {
  conversation?: { id: string; title: string };
  message?: { id: string; role: string; content: string };
  artifact?: { id: string; title: string; content: string; contentTruncated?: true };
  /** Host identity of the full artifact version, including any content beyond the bounded preview. */
  artifactFingerprint?: string;
  app?: { id: string; name: string };
  object?: {
    id: string;
    title: string;
    appId: string;
    version: number;
    /** Full cloned data, or a bounded JSON preview when dataTruncated is true. */
    data: Record<string, unknown> | string;
    dataTruncated?: true;
  };
  quote?: string;
}
