import { createHash } from "node:crypto";
import type { AssistantContextSnapshot, AssistantMessageContext, AssistantState, AssistantWorkspace, AssistantWorkspaceAction, AssistantWorkspaceTab } from "../shared/assistant.ts";
import type { AppDefinition } from "../shared/plugin.ts";
import { OrbitStore, HttpError, id, now } from "./store.ts";
import { deliveryState } from "./delivery.ts";
import type { PresentationRequest } from "../shared/delivery.ts";

const conversationKey = "assistant:conversation:v1";
const workspaceKey = "assistant:workspace:v1";
const emptyWorkspace = (): AssistantWorkspace => ({ tabs: [], activeTabId: null, revision: 0 });

function text(value: unknown, label: string, limit = 160): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit)
    throw new HttpError(400, `${label}无效`);
  return value.trim();
}

/** Workspace navigation is persistent UI state; it never dispatches conversations. */
export class AssistantWorkspaceService {
  private store: OrbitStore;
  private apps: AppDefinition[];
  private changed: () => void;
  constructor(store: OrbitStore, apps: AppDefinition[], changed: () => void) {
    this.store = store;
    this.apps = apps;
    this.changed = changed;
  }

  initialize(): string {
    return this.store.transaction(() => {
      const saved = this.store.metadata<string>(conversationKey);
      const conversationId = saved || "orbit-assistant";
      if (!this.store.get("conversations", conversationId))
        this.store.createConversation("Orbit 主助手", { id: conversationId, project: "Orbit", summary: "与 Orbit 持续协作；具体事项和成果保存在各自的工作现场。" });
      if (!saved) this.store.setMetadata(conversationKey, conversationId);
      if (!this.store.metadata(workspaceKey)) this.store.setMetadata(workspaceKey, emptyWorkspace());
      return conversationId;
    });
  }

  isMain(conversationId: string): boolean {
    return this.store.metadata<string>(conversationKey) === conversationId;
  }

  currentWorkspace(): AssistantWorkspace { return this.store.metadata<AssistantWorkspace>(workspaceKey) || emptyWorkspace(); }

  getState(): AssistantState {
    const conversationId = this.initialize();
    let workspace = this.currentWorkspace();
    // Removed records must not return as ghost windows after reload.
    const tabs = workspace.tabs.filter(tab => {
      try { this.makeTab({ action: "open", ...tab }); return true; } catch { return false; }
    });
    if (tabs.length !== workspace.tabs.length) {
      const activeTabId = tabs.some(tab => tab.id === workspace.activeTabId) ? workspace.activeTabId : tabs.at(-1)?.id || null;
      workspace = this.commit(workspace, { tabs, activeTabId });
    }
    const presentation = this.store.metadata<AssistantState["presentation"]>("assistant:last-presentation");
    const owner = presentation && this.store.metadata<{ presentation?: PresentationRequest }>(`delivery:${presentation.runId}`)?.presentation;
    const ownsRequest = owner && owner.requestId === this.store.metadata("assistant:presentation-request") && owner.generation === this.store.metadata("assistant:presentation-generation");
    return { conversationId, workspace, ...deliveryState(this.store), ...(ownsRequest && presentation?.revision === workspace.revision ? { presentation } : {}) };
  }

  validateTarget(input: AssistantWorkspaceAction): AssistantWorkspaceTab { return this.makeTab(input); }

  private commit(previous: AssistantWorkspace, next: Pick<AssistantWorkspace, "tabs" | "activeTabId">): AssistantWorkspace {
    if (JSON.stringify(previous.tabs) === JSON.stringify(next.tabs) && previous.activeTabId === next.activeTabId) return previous;
    const saved = { ...next, revision: previous.revision + 1 };
    this.store.setMetadata(workspaceKey, saved);
    this.changed();
    return saved;
  }

  private makeTab(input: AssistantWorkspaceAction): AssistantWorkspaceTab {
    const conversationId = text(input.conversationId, "对话");
    const conversation = this.store.require("conversations", conversationId);
    const kind = input.kind || "conversation";
    if (input.messageId) {
      const message = this.store.require("messages", text(input.messageId, "原文位置"));
      if (message.conversationId !== conversationId) throw new HttpError(403, "原文不属于该对话");
    }
    if (kind === "conversation") {
      if (input.artifactId || input.appId || input.objectId) throw new HttpError(400, "对话窗口不接受应用或产物引用");
      return { id: `conversation:${conversationId}`, kind, conversationId, title: conversation.title, ...(input.messageId ? { messageId: input.messageId } : {}) };
    }
    if (kind === "artifact") {
      if (input.appId || input.objectId || input.messageId) throw new HttpError(400, "产物窗口引用无效");
      const artifact = this.store.require("artifacts", text(input.artifactId, "产物"));
      if (artifact.conversationId !== conversationId) throw new HttpError(403, "产物不属于该对话");
      return { id: `artifact:${artifact.id}`, kind, conversationId, title: artifact.title, artifactId: artifact.id };
    }
    if (kind === "app") {
      if (input.artifactId || input.messageId) throw new HttpError(400, "应用窗口引用无效");
      const appId = text(input.appId, "应用");
      const app = this.apps.find(item => item.manifest.id === appId);
      if (!app) throw new HttpError(404, "应用尚未接入");
      const object = input.objectId ? this.store.require("objects", text(input.objectId, "对象")) : undefined;
      if (object && (object.conversationId !== conversationId || object.appId !== appId)) throw new HttpError(403, "对象不属于该对话或应用");
      return { id: `app:${conversationId}:${appId}:${object?.id || ""}`, kind, conversationId, title: object?.title || app.manifest.name, appId, ...(object ? { objectId: object.id } : {}) };
    }
    throw new HttpError(400, "未知的工作区类型");
  }

  workspace(input: AssistantWorkspaceAction): AssistantWorkspace {
    if (!input || typeof input !== "object") throw new HttpError(400, "工作区操作无效");
    const previous = this.getState().workspace;
    if (input.expectedRevision !== undefined && input.expectedRevision !== previous.revision) throw new HttpError(409, "工作区已变化，请刷新后重试");
    if (input.action === "clear") return this.commit(previous, { tabs: [], activeTabId: null });
    if (input.action === "open") {
      const tab = this.makeTab(input);
      const tabs = previous.tabs.some(item => item.id === tab.id)
        ? previous.tabs.map(item => item.id === tab.id ? tab : item)
        : [...previous.tabs, tab];
      return this.commit(previous, { tabs, activeTabId: tab.id });
    }
    if (input.action === "close" || input.action === "activate") {
      const tabId = text(input.tabId, "窗口");
      if (input.action === "activate") {
        if (!previous.tabs.some(tab => tab.id === tabId)) throw new HttpError(404, "窗口已关闭");
        return this.commit(previous, { tabs: previous.tabs, activeTabId: tabId });
      }
      const tabs = previous.tabs.filter(tab => tab.id !== tabId);
      const activeTabId = previous.activeTabId === tabId ? tabs.at(-1)?.id || null : previous.activeTabId;
      return this.commit(previous, { tabs, activeTabId });
    }
    throw new HttpError(400, "未知的工作区操作");
  }

  captureContext(input?: AssistantMessageContext): AssistantContextSnapshot | undefined {
    if (input === undefined) return undefined;
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "本轮引用无效");
    const hasArtifact = input.artifactId !== undefined;
    const hasApp = input.appId !== undefined || input.objectId !== undefined;
    if (hasArtifact && hasApp) throw new HttpError(400, "同一引用不能同时指定产物和应用对象");
    if (input.messageId !== undefined && (hasArtifact || hasApp)) throw new HttpError(400, "原文消息不能与产物或应用对象混合作为同一引用");
    if (input.objectId !== undefined && input.appId === undefined) throw new HttpError(400, "引用对象需要应用 ID");
    if ((hasArtifact || hasApp) && input.conversationId === undefined) throw new HttpError(400, "引用产物或应用需要对话 ID");
    const captured: AssistantContextSnapshot = {};
    if (input.conversationId !== undefined) {
      const conversation = this.store.require("conversations", text(input.conversationId, "对话"));
      captured.conversation = { id: conversation.id, title: conversation.title };
    }
    if (input.messageId !== undefined) {
      if (!captured.conversation) throw new HttpError(400, "引用原文需要对话 ID");
      const message = this.store.require("messages", text(input.messageId, "原文位置"));
      if (message.conversationId !== captured.conversation.id) throw new HttpError(403, "原文不属于该对话");
      captured.message = { id: message.id, role: message.role, content: message.content.slice(0, 12000) };
    }
    if (hasArtifact) {
      const artifact = this.store.require("artifacts", text(input.artifactId, "引用产物"));
      if (artifact.conversationId !== captured.conversation!.id) throw new HttpError(403, "引用产物不属于该对话");
      captured.artifact = {
        id: artifact.id, title: artifact.title.slice(0, 240), content: artifact.content.slice(0, 12000),
        ...(artifact.content.length > 12000 ? { contentTruncated: true as const } : {}),
      };
      captured.artifactFingerprint = createHash("sha256").update(JSON.stringify([artifact.content, artifact.updatedAt])).digest("hex");
    }
    if (hasApp) {
      const appId = text(input.appId, "引用应用");
      const app = this.apps.find(item => item.manifest.id === appId);
      if (!app) throw new HttpError(404, "引用应用尚未接入");
      captured.app = { id: appId, name: app.manifest.name };
      if (input.objectId !== undefined) {
        const object = this.store.require("objects", text(input.objectId, "引用对象"));
        if (object.conversationId !== captured.conversation!.id || object.appId !== appId) throw new HttpError(403, "引用对象不属于该对话或应用");
        const serialized = JSON.stringify(object.data);
        captured.object = {
          id: object.id, title: object.title.slice(0, 240), appId, version: object.version,
          ...(serialized.length > 12000
            ? { data: serialized.slice(0, 12000), dataTruncated: true as const }
            : { data: structuredClone(object.data) }),
        };
      }
    }
    if (input.quote !== undefined) captured.quote = text(input.quote, "引用文字", 4000);
    return Object.keys(captured).length ? captured : undefined;
  }

  saveNote(input: { conversationId: string; title: string; content: string; artifactId?: string }, options: { open?: boolean } = {}) {
    const conversationId = text(input.conversationId, "归属对话");
    this.store.require("conversations", conversationId);
    const title = text(input.title, "标题", 240);
    const content = text(input.content, "内容", 100000);
    const existing = input.artifactId ? this.store.require("artifacts", text(input.artifactId, "产物")) : undefined;
    if (existing && existing.conversationId !== conversationId) throw new HttpError(403, "不能修改其他对话的产物");
    const artifact = this.store.put("artifacts", { ...existing, id: existing?.id || id("artifact"), conversationId, title, content, format: "markdown", updatedAt: now() });
    this.store.activity(conversationId, "object", "已保存工作成果", title);
    if (options.open !== false) this.workspace({ action: "open", kind: "artifact", conversationId, artifactId: artifact.id });
    this.changed();
    return artifact;
  }

  appendNote(input: { conversationId: string; content: string }) {
    const conversationId = text(input.conversationId, "归属对话");
    this.store.require("conversations", conversationId);
    const message = this.store.addMessage(conversationId, "assistant", text(input.content, "成果内容", 20000));
    this.store.activity(conversationId, "workspace", "主助手保存了成果", "成果已归档到当前事项，没有恢复历史任务。");
    this.changed();
    return message;
  }
}
