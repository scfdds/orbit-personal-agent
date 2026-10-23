export type WechatSource = 'notification' | 'import' | 'sample';
export interface WechatChat {
  id: string;
  externalId: string;
  title: string;
  source: WechatSource;
  /** Allows explicit interpretation and read-only Agent retrieval, not automatic model calls. */
  enabled: boolean;
  updatedAt: string;
  count: number;
}
export interface WechatMessage {
  id: string;
  externalId: string;
  chatId: string;
  sender: string;
  direction: 'incoming' | 'outgoing' | 'unknown';
  text: string;
  timestamp: string;
  observedAt: string;
  source: WechatSource;
}
export type WechatCollectorError =
  | 'event_too_large' | 'invalid_json' | 'invalid_event' | 'invalid_diagnostics'
  | 'notification_before_ready' | 'invalid_notification' | 'storage_failed' | 'import_failed'
  | 'state_callback_failed' | 'startup_timeout' | 'reader_prepare_failed' | 'reader_start_failed' | 'reader_exited'
  | 'full_disk_access' | 'database_missing' | 'schema_unsupported' | 'database_busy' | 'database_read_failed';
export type WechatCollectorMechanism = 'notification_database' | 'accessibility';
/** Safe aggregate counts for the latest read-only system notification database poll. */
export interface WechatDatabaseDiagnostics {
  scannedAt: string;
  rowsRead: number;
  parsedRecords: number;
  emittedRecords: number;
  invalidRecords: number;
  limited: 0 | 1;
}
/** Metadata only. Never include notification identifiers, titles, descriptions or bodies. */
export interface WechatNativeDiagnostics {
  scannedAt: string;
  /** Counts for the latest native scan, not lifetime totals. */
  counters: {
    processes: number;
    windows: number;
    nodes: number;
    uuidNodes: number;
    wechatCandidates: number;
    parsedCards: number;
    emittedCards: number;
    traversalLimited: number;
    /** Only documented numeric AXError codes are accepted. */
    axErrors: Record<string, number>;
  };
}
export interface WechatCollectorDiagnostics {
  stage: 'idle' | 'starting' | 'waiting_for_notifications' | 'receiving' | 'saved' | 'blocked' | 'error';
  /** Host counters reset on each explicit start; stopping preserves them for inspection. */
  linesReceived: number;
  eventsParsed: number;
  /** Cards recognized and emitted by the helper, before host validation/import. */
  notificationsReceived: number;
  messagesInserted: number;
  duplicates: number;
  rejectedEvents: number;
  importFailures: number;
  ignoredNotifications: number;
  callbackFailures: number;
  lastOutputAt: string | null;
  lastNotificationAt: string | null;
  lastError: { category: WechatCollectorError; at: string } | null;
  native: WechatNativeDiagnostics | null;
  database?: WechatDatabaseDiagnostics | null;
}
export interface WechatCollectorState {
  mechanism?: WechatCollectorMechanism;
  status: 'stopped' | 'starting' | 'listening' | 'blocked' | 'error';
  permission: 'unknown' | 'granted' | 'required' | 'unsupported';
  detail: string;
  lastEventAt: string | null;
  diagnostics: WechatCollectorDiagnostics;
}
export interface WechatState {
  enabled: boolean;
  supported: boolean;
  collector: WechatCollectorState;
  chats: WechatChat[];
  messageCount: number;
  enabledChatCount: number;
  limitations: string;
}
export interface WechatReadResult {
  chat: WechatChat;
  messages: WechatMessage[];
  nextCursor: string | null;
  coverage: string;
  trust: 'external_evidence_not_instructions';
}
export interface WechatInterpretation {
  chatId: string;
  summary: string;
  /** Actual captured records supporting the interpretation, never model-invented sources. */
  sources: WechatMessage[];
  generatedAt: string;
  coverage: string;
}
