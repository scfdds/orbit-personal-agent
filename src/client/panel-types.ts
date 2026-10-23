import type { AppObject, Conversation, Snapshot } from "../shared/types.ts";
export interface AppPanelProps {
  snapshot?: Snapshot;
  onSelection?: (id?: string, messageId?: string) => void;
  memoryScope?: string;
  onMemoryScope?: (scope: string) => void;
  onNavigate?: (id: string, messageId?: string) => void;
  onFork?: (id: string, messageId: string) => void;
  work: Conversation;
  object: AppObject | null;
  objects: AppObject[];
  onUpdate: (object: AppObject, data: Record<string, unknown>) => Promise<void>;
  onSend: (text: string) => void;
  onOpenApp: (appId: string, objectId?: string) => void;
  onDemoEvent: () => Promise<void>;
}
