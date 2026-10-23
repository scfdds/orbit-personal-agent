import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AppManifest, AppObject, PanelRef } from "./types.ts";

export interface SaveObjectInput {
  id?: string;
  appId: string;
  type: string;
  title: string;
  data: Record<string, unknown>;
  expectedVersion?: number;
}
export interface AppContext {
  memory?: {
    search(query?: string, all?: boolean): unknown;
    read(id: string): unknown;
    source(id: string, messageId: string): unknown;
  };
  conversationId: string;
  readOnly: boolean;
  getObjects(appId?: string): AppObject[];
  getObject(id: string): AppObject | undefined;
  saveObject(input: SaveObjectInput): AppObject;
  openPanel(panel: PanelRef): void;
  recordActivity(title: string, detail: string): void;
}
export interface AppDefinition {
  manifest: AppManifest;
  createTools(context: AppContext): ToolDefinition[];
  seed(): Omit<SaveObjectInput, "id" | "expectedVersion">[];
  exportFile?(
    context: AppContext,
    format: string,
  ): Promise<{ content: Uint8Array | string; contentType: string; filename: string }>;
  validateObject?(
    data: Record<string, unknown>,
    type: string,
    context: AppContext,
  ): void;
  onDemoEvent?(context: AppContext): { eventName: string; detail: string };
}
