import { spawn as spawnProcess } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import { loadConfig, validateConfig } from './config.mjs';

const helper = fileURLToPath(new URL('../native/bin/wechat-notification-db-reader', import.meta.url));
const nativeErrors = new Set(['full_disk_access', 'database_missing', 'schema_unsupported', 'database_busy', 'database_read_failed']);
const retryableErrors = new Set(['database_missing', 'database_busy', 'database_read_failed']);
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000000;
const timestamp = value => typeof value === 'string' && value.length <= 50 && Number.isFinite(Date.parse(value));

export class NotificationCollector {
  constructor({ store, dataDir, config, helperPath = helper, spawn = spawnProcess, platform = process.platform,
    demo = false, startupTimeoutMs = 10000, configPollMs = 1000, now = Date.now } = {}) {
    this.store = store;
    this.config = config ?? (() => loadConfig(dataDir));
    this.helperPath = helperPath; this.spawn = spawn; this.platform = platform; this.demo = demo;
    this.startupTimeoutMs = startupTimeoutMs; this.configPollMs = configPollMs; this.now = now;
    this.generation = 0; this.child = null; this.pending = null; this.resolveStart = null; this.readerReady = false;
    this.state = { status: 'stopped', permission: 'unknown', mechanism: 'notification_database', reason: null, error: null,
      startedAt: null, lastScanAt: null, lastNotificationAt: null,
      counts: { received: 0, inserted: 0, duplicates: 0, ignored: 0, rejected: 0 }, database: null };
  }
  snapshot() { return structuredClone(this.state); }
  status() { this.checkConfiguration(); return this.snapshot(); }
  checkConfiguration() {
    if (this.demo) return true;
    try {
      const config = validateConfig(this.config());
      if (!config.enabled) { this.halt('stopped', 'DISABLED'); return false; }
      if (!config.allowAll && !config.allowedTitles.length) { this.halt('stopped', 'NO_ALLOWED_SOURCES'); return false; }
      return true;
    } catch { this.halt('error', 'INVALID_CONFIG'); return false; }
  }
  settle() {
    clearTimeout(this.startTimer);
    if (this.resolveStart) { const resolve = this.resolveStart; this.resolveStart = null; resolve(this.snapshot()); }
  }
  halt(status, reason = null) {
    this.generation++;
    this.readerReady = false;
    clearInterval(this.configTimer); clearTimeout(this.startTimer);
    const child = this.child; this.child = null;
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 1200);
      timer.unref(); child.once('exit', () => clearTimeout(timer));
    }
    this.state = { ...this.state, status, reason,
      error: ['error', 'blocked'].includes(status) ? { code: reason, at: new Date(this.now()).toISOString() } : null };
    this.settle();
  }
  stop() { this.halt('stopped'); return this.snapshot(); }
  retry(reason) {
    // Swift owns bounded retry/backoff. Preserve that process and the revocation
    // watcher, while making any last successful scan explicitly non-current.
    this.readerReady = false;
    this.state = { ...this.state, status: 'retrying', reason,
      error: { code: reason, at: new Date(this.now()).toISOString() } };
    this.settle();
  }
  armStartupTimeout(generation) {
    clearTimeout(this.startTimer);
    this.startTimer = setTimeout(() => { if (generation === this.generation) this.halt('error', 'STARTUP_TIMEOUT'); }, this.startupTimeoutMs);
  }
  start() {
    if (this.pending) return this.pending;
    if (this.demo) { this.halt('stopped', 'DEMO_MODE'); return Promise.resolve(this.snapshot()); }
    if (!this.checkConfiguration()) return Promise.resolve(this.snapshot());
    // A retrying reader already owns recovery; repeated MCP queries must not
    // launch a second helper or reset its retry delay.
    if (this.child) return Promise.resolve(this.snapshot());
    if (this.platform !== 'darwin') { this.state.permission = 'unsupported'; this.halt('blocked', 'UNSUPPORTED_PLATFORM'); return Promise.resolve(this.snapshot()); }
    this.state = { ...this.state, status: 'starting', permission: 'unknown', reason: null, error: null,
      startedAt: new Date(this.now()).toISOString(), lastScanAt: null, database: null };
    const generation = ++this.generation;
    const ready = new Promise(resolve => { this.resolveStart = resolve; });
    this.pending = ready.finally(() => { this.pending = null; });
    this.readerReady = false;
    this.armStartupTimeout(generation);
    this.configTimer = setInterval(() => this.checkConfiguration(), this.configPollMs);
    this.configTimer.unref();
    void this.launch(generation);
    return this.pending;
  }
  async launch(generation) {
    try { await access(this.helperPath, constants.X_OK); }
    catch { if (generation === this.generation) this.halt('error', 'HELPER_UNAVAILABLE'); return; }
    if (generation !== this.generation || !this.checkConfiguration()) return;
    let child;
    try { child = this.spawn(this.helperPath, [], { stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch { this.halt('error', 'READER_START_FAILED'); return; }
    this.child = child;
    if (!child.stdout) { this.halt('error', 'READER_START_FAILED'); return; }
    let buffer = '';
    const decoder = new StringDecoder('utf8');
    child.stdout.on('data', chunk => {
      if (generation !== this.generation) return;
      // Split bounded chunks before accumulation; raw notification text is never logged.
      if (chunk.length > 1048576) { this.halt('error', 'EVENT_TOO_LARGE'); return; }
      for (const part of decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)).split(/(?<=\n)/)) {
        if (buffer.length + part.length > 64000) { this.halt('error', 'EVENT_TOO_LARGE'); return; }
        buffer += part;
        if (buffer.endsWith('\n')) {
          const line = buffer.slice(0, -1); buffer = '';
          this.receive(line);
          if (generation !== this.generation) return;
        }
      }
    });
    child.once('error', () => { if (generation === this.generation) this.halt('error', 'READER_START_FAILED'); });
    child.once('exit', () => { if (generation === this.generation) this.halt('error', 'READER_EXITED'); });
  }
  reject(reason) { this.state.counts.rejected++; this.halt('error', reason); }
  receive(line) {
    if (!this.checkConfiguration()) return;
    let event;
    try { event = JSON.parse(line); }
    catch { this.reject('INVALID_EVENT'); return; }
    if (!event || typeof event !== 'object' || Array.isArray(event)) { this.reject('INVALID_EVENT'); return; }
    if (event.type === 'status') {
      if (event.status === 'listening') {
        // The helper can emit notifications now, but callers see 'starting'
        // until the matching scan diagnostics confirm a completed scan.
        this.readerReady = true;
        this.state.status = 'starting'; this.state.permission = 'granted'; this.state.reason = null; this.state.error = null;
        this.armStartupTimeout(this.generation);
      } else if (['blocked', 'error'].includes(event.status)) {
        const reason = nativeErrors.has(event.reason) ? event.reason : 'database_read_failed';
        if (reason === 'full_disk_access') this.state.permission = 'required';
        if (retryableErrors.has(reason)) this.retry(reason);
        else this.halt(reason === 'full_disk_access' ? 'blocked' : 'error', reason);
      } else this.reject('INVALID_EVENT');
      return;
    }
    if (event.type === 'db_diagnostics') {
      if (!this.readerReady || !timestamp(event.scannedAt)
        || !['rowsRead', 'parsedRecords', 'emittedRecords', 'invalidRecords'].every(key => count(event[key]))
        || ![0, 1].includes(event.limited)) { this.reject('INVALID_DIAGNOSTICS'); return; }
      this.state.lastScanAt = new Date(event.scannedAt).toISOString();
      this.state.database = Object.fromEntries(['rowsRead', 'parsedRecords', 'emittedRecords', 'invalidRecords', 'limited'].map(key => [key, event[key]]));
      this.state.status = 'listening'; this.state.reason = null; this.state.error = null;
      this.settle(); return;
    }
    if (event.type !== 'notification' || !this.readerReady) { this.reject('INVALID_EVENT'); return; }
    this.state.counts.received++;
    try {
      const result = this.store.ingest(event);
      for (const key of ['inserted', 'duplicates', 'ignored']) this.state.counts[key] += result[key];
      if (result.inserted > 0) this.state.lastNotificationAt = new Date(this.now()).toISOString();
    } catch (error) {
      if (error?.code === 'DISABLED') this.halt('stopped', 'DISABLED');
      else this.reject(error?.code === 'INVALID_NOTIFICATION' ? 'INVALID_NOTIFICATION' : 'STORAGE_FAILED');
    }
  }
}
