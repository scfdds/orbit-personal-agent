export interface DeliveryFocus { messageId?: string; heading?: string }
export interface DeliveryTargetInput {
  kind: "conversation" | "artifact" | "app";
  conversationId: string;
  artifactId?: string;
  appId?: string;
  objectId?: string;
  focus?: DeliveryFocus;
}
/** Titles and source versions are resolved by the host, never supplied by the model. */
export interface DeliveryTarget extends DeliveryTargetInput { title: string; updatedAt?: string; objectVersion?: number }
export interface AssistantDelivery {
  id: string;
  /** Older records omit this and are final. A host preview opens verified content without speech. */
  kind?: "preview" | "final";
  runId: string;
  /** The originating run's conversation, not necessarily the reference's owner. */
  conversationId: string;
  requestId: string | null;
  generation: number;
  createdAt: string;
  /** Independently composed brief speech, at most 90 characters; empty only for host previews. */
  spokenText: string;
  target?: DeliveryTarget;
  /** Eligible when created; clients still check their foreground run and current generation/revision. */
  presented: boolean;
  workspaceRevision: number;
  reason?: "superseded" | "workspace_changed" | "background";
}
export interface PresentationRequest { requestId: string; generation: number; revision: number }
export interface PresentDeliveryInput { spokenText: string; target?: DeliveryTargetInput }
