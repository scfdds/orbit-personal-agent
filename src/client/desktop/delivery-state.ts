import type { AssistantDelivery } from "../../shared/delivery.ts";
import type { AssistantMessageContext, AssistantWorkspaceTab } from "../../shared/assistant.ts";

export interface DeliveryOwner { runId: string; requestId?: string; conversationId: string; generation: number; revision: number; global?: boolean }

/** The foreground request owns presentation; recent or unfinished work alone never does. */
export function eligibleDelivery(deliveries: AssistantDelivery[], owner: DeliveryOwner | null, localGeneration: number, serverGeneration: number, revision: number): AssistantDelivery | undefined {
  if (!owner || owner.generation !== localGeneration) return;
  return deliveries.filter(d => d.presented && d.runId === owner.runId && d.conversationId === owner.conversationId
    && (!owner.requestId || d.requestId === owner.requestId) && d.generation === serverGeneration && d.workspaceRevision === revision).at(-1);
}

export function deliveryTab(delivery: AssistantDelivery): AssistantWorkspaceTab | null {
  const target = delivery.target;
  if (!target) return null;
  if (target.kind === "conversation" && target.conversationId === delivery.conversationId && !target.focus?.messageId) return null;
  return {
    id: target.kind === "artifact" ? `artifact:${target.artifactId}` : target.kind === "app" ? `app:${target.conversationId}:${target.appId}:${target.objectId || ""}` : `conversation:${target.conversationId}`,
    kind: target.kind, conversationId: target.conversationId, title: target.title,
    ...(target.artifactId ? { artifactId: target.artifactId } : {}), ...(target.appId ? { appId: target.appId } : {}),
    ...(target.objectId ? { objectId: target.objectId } : {}), ...(target.focus?.messageId ? { messageId: target.focus.messageId } : {}),
  };
}

/** A visible surface is reference context, not an instruction or an execution destination. */
export function visibleContext(tab: AssistantWorkspaceTab | null): AssistantMessageContext | undefined {
  if (!tab) return;
  return { conversationId: tab.conversationId, ...(tab.messageId ? { messageId: tab.messageId } : {}),
    ...(tab.artifactId ? { artifactId: tab.artifactId } : {}), ...(tab.appId ? { appId: tab.appId } : {}), ...(tab.objectId ? { objectId: tab.objectId } : {}) };
}
