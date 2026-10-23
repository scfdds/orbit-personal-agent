import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createInterface, type Interface } from 'node:readline';
import type { WechatCollectorState, WechatCollectorDiagnostics, WechatCollectorError, WechatNativeDiagnostics, WechatDatabaseDiagnostics, WechatCollectorMechanism } from '../shared/wechat.ts';
import type { WechatContextService } from './wechat.ts';
import { HttpError } from './store.ts';

const waitingDetail = '已连接系统通知记录，尚未收到新的微信通知片段。';
const databaseErrors = {
  full_disk_access: '需要在系统设置 → 隐私与安全性 → 完全磁盘访问中允许 Orbit，然后返回重新检测。',
  database_missing: '尚未找到系统通知数据库，请确认微信已产生系统通知后重试。',
  schema_unsupported: '当前 macOS 的通知数据库格式尚不支持，暂时无法读取。',
  database_busy: '系统通知数据库正在使用中，请稍后重试。',
  database_read_failed: '系统通知记录读取失败，请重新检测。',
} satisfies Partial<Record<WechatCollectorError, string>>;
const diagnostics = (): WechatCollectorDiagnostics => ({
  stage: 'idle', linesReceived: 0, eventsParsed: 0, notificationsReceived: 0,
  messagesInserted: 0, duplicates: 0, rejectedEvents: 0, importFailures: 0,
  ignoredNotifications: 0, callbackFailures: 0, lastOutputAt: null, lastNotificationAt: null,
  lastError: null, native: null, database: null,
});
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000;
const isTimestamp = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 50 && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)
    && Number.isFinite(Date.parse(value));

function databaseDiagnostics(event: Record<string, unknown>): WechatDatabaseDiagnostics | null {
  if (!isTimestamp(event.scannedAt) || !isCount(event.rowsRead) || !isCount(event.parsedRecords)
    || !isCount(event.emittedRecords) || !isCount(event.invalidRecords) || (event.limited !== 0 && event.limited !== 1)) return null;
  return { scannedAt: new Date(event.scannedAt).toISOString(), rowsRead: event.rowsRead,
    parsedRecords: event.parsedRecords, emittedRecords: event.emittedRecords,
    invalidRecords: event.invalidRecords, limited: event.limited };
}

/** Copy only known numeric counters. Native output is data, not a trusted status message. */
function nativeDiagnostics(event: Record<string, unknown>): WechatNativeDiagnostics | null {
  const source = event.counters;
  if (!isRecord(source) || !isRecord(source.axErrors) || !isTimestamp(event.scannedAt)) return null;
  const keys = ['processes', 'windows', 'nodes', 'uuidNodes', 'wechatCandidates', 'parsedCards', 'emittedCards', 'traversalLimited'] as const;
  if (keys.some(key => !isCount(source[key]))) return null;
  const counters = Object.fromEntries(keys.map(key => [key, source[key]])) as Omit<WechatNativeDiagnostics['counters'], 'axErrors'>;
  const axErrors: Record<string, number> = {};
  // AXError.h documents -25200 through -25214. Do not retain unknown keys or error text.
  for (let code = -25200; code >= -25214; code--) {
    const value = source.axErrors[String(code)];
    if (value === undefined) continue;
    if (!isCount(value)) return null;
    axErrors[String(code)] = value;
  }
  return { scannedAt: new Date(event.scannedAt).toISOString(), counters: { ...counters, axErrors } };
}

function importError(error: unknown): WechatCollectorError {
  if (error instanceof HttpError && error.status === 400) return 'invalid_notification';
  if (isRecord(error) && typeof error.code === 'string'
    && (error.code === 'ERR_INVALID_STATE' || /^(?:ERR_)?SQLITE(?:_|$)/.test(error.code))) return 'storage_failed';
  return 'import_failed';
}

export interface WechatCollectorOptions {
  /** Synthetic workspaces must never start a native notification reader. */
  disabled?: boolean;
  platform?: string;
  /** Legacy AX collection is opt-in; a database failure must never switch readers. */
  mechanism?: WechatCollectorMechanism;
  helperPath?: string;
  spawn?: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
}

/** Explicitly started local reader. Construction never reads notifications or requests permission. */
export class WechatCollector {
  private child?: ChildProcess;
  private lines?: Interface;
  private generation = 0;
  private closed = false;
  private startupTimer?: ReturnType<typeof setTimeout>;
  private readonly savedNotificationIds = new Set<string>();
  private readonly platform: string;
  private readonly mechanism: WechatCollectorMechanism;
  private readonly spawn: NonNullable<WechatCollectorOptions['spawn']>;
  private context: WechatContextService;
  private dataDir: string;
  private changed: () => void;
  private options: WechatCollectorOptions;
  state: WechatCollectorState = {
    mechanism: 'notification_database',
    status: 'stopped', permission: 'unknown',
    detail: '尚未开启。开启后只读系统保留的微信通知记录。', lastEventAt: null,
    diagnostics: diagnostics(),
  };
  constructor(
    context: WechatContextService,
    dataDir: string,
    changed: () => void = () => {},
    options: WechatCollectorOptions = {},
  ) {
    this.context = context; this.dataDir = dataDir; this.changed = changed; this.options = options;
    this.platform = options.platform ?? process.platform;
    this.mechanism = options.mechanism ?? 'notification_database';
    this.state.mechanism = this.mechanism;
    if (this.mechanism === 'accessibility') this.state.detail = '尚未开启。当前使用旧版辅助功能通知读取器。';
    this.spawn = options.spawn ?? spawn;
    if (this.platform !== 'darwin') this.state.permission = 'unsupported';
  }
  get supported() { return this.platform === 'darwin'; }
  private update(patch: Partial<WechatCollectorState>, diagnosticPatch: Partial<WechatCollectorDiagnostics> = {}) {
    this.state = { ...this.state, ...patch, diagnostics: { ...this.state.diagnostics, ...diagnosticPatch } };
    try { this.changed(); }
    catch {
      // A UI callback failure must not turn a successful database write into an import failure.
      this.state = { ...this.state, detail: '通知状态更新失败，请重新打开设置查看。', diagnostics: {
        ...this.state.diagnostics, stage: 'error', callbackFailures: this.state.diagnostics.callbackFailures + 1,
        lastError: { category: 'state_callback_failed', at: new Date().toISOString() },
      } };
    }
  }
  private failure(category: WechatCollectorError, detail: string, patch: Partial<WechatCollectorDiagnostics> = {}) {
    this.update({ detail }, { ...patch, stage: 'error', lastError: { category, at: new Date().toISOString() } });
  }
  private reject(category: WechatCollectorError) {
    this.failure(category, '读取器返回的数据格式异常，部分通知未保存。', {
      rejectedEvents: this.state.diagnostics.rejectedEvents + 1,
    });
  }
  private receive(line: string) {
    const now = new Date().toISOString();
    // Accumulate locally and notify once the event has been classified.
    this.state = { ...this.state, diagnostics: { ...this.state.diagnostics,
      linesReceived: this.state.diagnostics.linesReceived + 1, lastOutputAt: now,
    } };
    if (line.length > 64000) { this.reject('event_too_large'); return; }
    let event: unknown;
    try { event = JSON.parse(line); }
    catch { this.reject('invalid_json'); return; }
    if (!isRecord(event)) { this.reject('invalid_event'); return; }
    this.state = { ...this.state, diagnostics: { ...this.state.diagnostics, eventsParsed: this.state.diagnostics.eventsParsed + 1 } };
    if (event.type === 'db_diagnostics') {
      const database = databaseDiagnostics(event);
      if (!database) { this.reject('invalid_diagnostics'); return; }
      // The dedicated settings page polls diagnostics; do not broadcast every scan.
      this.state = { ...this.state, diagnostics: { ...this.state.diagnostics, database } };
      return;
    }
    if (event.type === 'diagnostics') {
      const native = nativeDiagnostics(event);
      if (!native) { this.reject('invalid_diagnostics'); return; }
      this.state = { ...this.state, diagnostics: { ...this.state.diagnostics, native } };
      return;
    }
    if (event.type === 'status' && (event.status === 'blocked' || event.status === 'listening' || event.status === 'error')) {
      clearTimeout(this.startupTimer);
      if (this.mechanism === 'notification_database' && event.status !== 'listening') {
        const reason = typeof event.reason === 'string' && Object.hasOwn(databaseErrors, event.reason)
          ? event.reason as keyof typeof databaseErrors
          : event.status === 'blocked' ? 'full_disk_access' : 'database_read_failed';
        const blocked = reason === 'full_disk_access';
        this.update({ status: blocked ? 'blocked' : 'error',
          permission: blocked ? 'required' : this.state.permission, detail: databaseErrors[reason],
        }, { stage: blocked ? 'blocked' : 'error', lastError: { category: reason, at: now } });
        return;
      }
      if (event.status === 'error') {
        this.update({ status: 'error' });
        this.failure('reader_start_failed', '读取器运行失败，请重新检测。');
        return;
      }
      const listening = event.status === 'listening';
      this.update({ status: event.status, permission: listening ? 'granted' : 'required',
        detail: listening ? this.state.diagnostics.messagesInserted > 0 ? '微信通知片段已保存到本机。'
          : this.mechanism === 'notification_database' ? waitingDetail : '已授权，尚未收到可保存的微信通知片段。'
          : '需要在系统辅助功能中允许 Orbit。完成后请重新连接。',
      }, { stage: listening ? this.state.diagnostics.messagesInserted > 0 ? 'saved' : 'waiting_for_notifications' : 'blocked' });
      return;
    }
    if (event.type !== 'notification') { this.reject('invalid_event'); return; }
    this.state = { ...this.state, diagnostics: { ...this.state.diagnostics,
      notificationsReceived: this.state.diagnostics.notificationsReceived + 1, lastNotificationAt: now,
    } };
    if (this.state.status !== 'listening') {
      this.failure('notification_before_ready', '读取器尚未就绪，收到的通知未保存。', {
        ignoredNotifications: this.state.diagnostics.ignoredNotifications + 1,
      });
      return;
    }
    // Native retries recover failed imports. Once an ID is durably present,
    // subsequent retries only update local counters, without SQL or broadcasts.
    if (typeof event.id === 'string' && this.savedNotificationIds.has(event.id)) {
      this.state = { ...this.state, diagnostics: { ...this.state.diagnostics,
        duplicates: this.state.diagnostics.duplicates + 1,
      } };
      return;
    }
    this.state = { ...this.state, diagnostics: { ...this.state.diagnostics, stage: 'receiving' } };
    let result: ReturnType<WechatContextService['import']>;
    try {
      result = this.context.import({ messages: [{
        id: event.id, chatId: event.title, chatTitle: event.title, sender: '通知中未核验', direction: 'unknown',
        text: event.body, timestamp: event.timestamp,
      }] }, 'notification');
    } catch (error) {
      const category = importError(error);
      this.failure(category, category === 'invalid_notification'
        ? '已收到微信通知片段，但格式不完整，未能保存。'
        : '已收到微信通知片段，但保存失败，请重试。', {
        importFailures: this.state.diagnostics.importFailures + 1,
        rejectedEvents: this.state.diagnostics.rejectedEvents + (category === 'invalid_notification' ? 1 : 0),
      });
      return;
    }
    if (typeof event.id === 'string') {
      this.savedNotificationIds.add(event.id);
      if (this.savedNotificationIds.size > 5000) this.savedNotificationIds.delete(this.savedNotificationIds.values().next().value!);
    }
    this.update({ detail: result.inserted > 0 ? '微信通知片段已保存到本机。' : '已收到重复通知，本地记录已保留。',
      lastEventAt: result.inserted > 0 ? now : this.state.lastEventAt,
    }, { stage: 'saved', messagesInserted: this.state.diagnostics.messagesInserted + result.inserted,
      duplicates: this.state.diagnostics.duplicates + result.duplicates,
    });
  }
  start() {
    if (this.options.disabled) return;
    if (this.closed) return this.state;
    if (['starting', 'listening'].includes(this.state.status)) return this.state;
    this.stop();
    const generation = ++this.generation;
    this.savedNotificationIds.clear();
    this.state = { ...this.state, diagnostics: diagnostics() };
    if (!this.supported) {
      this.update({ status: 'blocked', permission: 'unsupported', detail: '微信通知读取目前仅支持 macOS。' }, { stage: 'blocked' });
      return this.state;
    }
    this.update({ status: 'starting', permission: 'unknown', detail: '正在检测权限并启动通知读取器…' }, { stage: 'starting' });
    this.startupTimer = setTimeout(() => {
      if (generation !== this.generation) return;
      this.stop();
      this.update({ status: 'error' });
      this.failure('startup_timeout', this.mechanism === 'notification_database'
        ? '通知读取器启动超时，请检查 Orbit 的完全磁盘访问权限后重试。'
        : '通知读取器启动超时，请检查系统辅助功能授权后重试。');
    }, 45000);
    this.startupTimer.unref();
    void this.launch(generation).catch(() => {
      if (generation !== this.generation) return;
      this.stop();
      this.update({ status: 'error' });
      this.failure('reader_prepare_failed', '读取器准备失败。开发版需要 Xcode Command Line Tools；请检查安装后重试。');
    });
    return this.state;
  }
  private async launch(generation: number) {
    const directory = join(this.dataDir, 'native');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (generation !== this.generation) return;
    const legacy = this.mechanism === 'accessibility';
    const helperName = legacy ? 'orbit-wechat-reader' : 'orbit-wechat-db-reader';
    const sourceName = legacy ? 'wechat-notifications.swift' : 'wechat-notification-db.swift';
    const bundled = fileURLToPath(new URL(`../../scripts/native/${helperName}`, import.meta.url));
    const supplied = this.options.helperPath || process.env.ORBIT_WECHAT_HELPER;
    let binary = supplied || bundled;
    if (!supplied && !await access(bundled, constants.X_OK).then(() => true, () => false)) {
      binary = join(directory, helperName);
      const source = fileURLToPath(new URL(`../../scripts/native/${sourceName}`, import.meta.url));
      await new Promise<void>((resolve, reject) => {
        const compiler = this.spawn('/usr/bin/swiftc', [source, ...(legacy ? [] : ['-lsqlite3']), '-o', binary], { stdio: 'ignore' });
        this.child = compiler;
        compiler.once('error', reject);
        compiler.once('exit', code => code === 0 ? resolve() : reject(new Error('compile failed')));
      });
    }
    if (generation !== this.generation) return;
    // The database reader never requests Accessibility or falls back to AX.
    const child = this.spawn(binary, legacy ? ['--request-permission'] : [], { stdio: ['ignore', 'pipe', 'ignore'] });
    this.child = child;
    if (!child.stdout) throw new Error('reader stdout unavailable');
    const lines = createInterface({ input: child.stdout }); this.lines = lines;
    lines.on('line', line => {
      if (generation === this.generation) this.receive(line);
    });
    child.once('error', () => {
      if (generation !== this.generation) return;
      clearTimeout(this.startupTimer);
      this.update({ status: 'error' });
      this.failure('reader_start_failed', '读取器无法启动，请重新连接。');
    });
    child.once('exit', () => {
      lines.close();
      if (generation !== this.generation) return;
      clearTimeout(this.startupTimer);
      this.child = undefined;
      if (['starting', 'listening'].includes(this.state.status)) {
        this.update({ status: 'error' });
        this.failure('reader_exited', '读取器已退出，请重新连接。');
      }
    });
  }
  stop() {
    this.generation++; clearTimeout(this.startupTimer);
    this.lines?.close(); this.lines = undefined;
    const child = this.child; this.child = undefined;
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      const force = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 1200);
      force.unref(); child.once('exit', () => clearTimeout(force));
    }
    this.update({ status: 'stopped', detail: '通知采集已暂停，已有本地记录保留。' }, { stage: 'idle' });
    return this.state;
  }
  close() { this.closed = true; this.stop(); this.savedNotificationIds.clear(); }
}
