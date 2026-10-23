import type { AssistantMessageContext } from './assistant.ts';

export interface OrbitDesktopDraft {
  text: string;
  reference: AssistantMessageContext | null;
}
export interface OrbitDesktopNavigation {
  conversationId?: string;
  view?: 'home' | 'settings';
  deliveryId?: string;
  runId?: string;
  requestId?: string;
  generation?: number;
  /** Continue the user's active voice mode after an explicit quick-to-main handoff. */
  voiceInput?: boolean;
}
export interface OrbitDesktopPreferences {
  spokenDelivery: boolean;
  sidebarCollapsed?: boolean;
  /** Explicitly visited matters, in stable user-facing order. */
  recentMatterIds?: string[];
}
export interface OrbitDesktopBridge {
  readonly isDesktop: true;
  readonly platform: string;
  hideQuick(): Promise<void>;
  resizeQuick(height: number): Promise<void>;
  openMain(target?: OrbitDesktopNavigation): Promise<void>;
  getInfo(): Promise<{ version: string; platform: string; shortcut: string; shortcutRegistered: boolean }>;
  /** Opens the fixed macOS permission pane; never grants access on the user's behalf. */
  openAccessibilitySettings(): Promise<void>;
  /** Opens the fixed Full Disk Access pane; the user must authorize Orbit in System Settings. */
  openFullDiskAccessSettings(): Promise<void>;
  revealApplication(): Promise<void>;
  /** Invoke after the user starts voice mode, including its explicit quick-to-main continuation. */
  requestMicrophonePermission(): Promise<boolean>;
  readDrafts(): Promise<Record<string, OrbitDesktopDraft>>;
  writeDraft(id: string, draft: OrbitDesktopDraft): Promise<void>;
  readPreferences(): Promise<OrbitDesktopPreferences>;
  writePreferences(value: Partial<OrbitDesktopPreferences>): Promise<OrbitDesktopPreferences>;
  onPreferencesChanged(callback: (value: OrbitDesktopPreferences) => void): () => void;
  /** Native lifecycle signal; macOS document.hidden can lag a real window hide. */
  onSurfaceHidden(callback: () => void): () => void;
  onNavigate(callback: (target: OrbitDesktopNavigation) => void): () => void;
}
declare global { interface Window { orbitDesktop?: OrbitDesktopBridge } }
