import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { assertPrivateFile, ensurePrivateDir, loadConfig, PluginError, titleAllowed, validateConfig } from './config.mjs';

export const COVERAGE = 'macOS 系统保留的微信通知片段，可能遗漏或截断；不是完整聊天记录，不含自己的回复。时间是系统投递时间；来源名称来自通知标题，可能重名。';
const hash = text => createHash('sha256').update(text).digest('hex');
const sourceId = title => `wx-${hash(title).slice(0, 24)}`;
const DAY = 86400000;
const MAX_RECORDS = 10000;
const fail = (code, message) => { throw new PluginError(code, message); };
const iso = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !value.includes('\0');

export class NotificationStore {
  constructor({ dataDir, memory = false, config, now = Date.now } = {}) {
    this.config = config ?? (() => loadConfig(dataDir));
    this.now = now;
    this.closed = false;
    const inMemory = memory || dataDir === null;
    this.directory = inMemory ? null : ensurePrivateDir(dataDir);
    const path = inMemory ? ':memory:' : join(this.directory, 'notifications.sqlite');
    if (!inMemory) {
      if (!existsSync(path)) closeSync(openSync(path, 'wx', 0o600));
      assertPrivateFile(path);
      for (const suffix of ['-journal', '-wal', '-shm']) assertPrivateFile(`${path}${suffix}`);
    }
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA busy_timeout=1000; PRAGMA secure_delete=ON;
      CREATE TABLE IF NOT EXISTS notifications(
        id TEXT PRIMARY KEY, source_id TEXT NOT NULL, title TEXT NOT NULL,
        text TEXT NOT NULL, timestamp TEXT NOT NULL, observed_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS source_time ON notifications(source_id,timestamp,id);
      CREATE INDEX IF NOT EXISTS notification_time ON notifications(timestamp,id);`);
  }
  access() {
    if (this.closed) fail('CLOSED', 'Notification storage is closed.');
    const config = validateConfig(this.config());
    if (!config.enabled) fail('DISABLED', 'Notification access is disabled.');
    this.prune(config);
    return config;
  }
  prune(config = validateConfig(this.config())) {
    if (this.closed) fail('CLOSED', 'Notification storage is closed.');
    this.db.prepare('DELETE FROM notifications WHERE timestamp < ?').run(new Date(this.now() - config.retentionDays * DAY).toISOString());
    this.db.exec(`DELETE FROM notifications WHERE id IN (SELECT id FROM notifications ORDER BY timestamp DESC,id DESC LIMIT -1 OFFSET ${MAX_RECORDS})`);
  }
  ingest(input) {
    const config = this.access();
    const events = Array.isArray(input) ? input : [input];
    if (!events.length || events.length > 1000) fail('INVALID_NOTIFICATION', 'Expected between 1 and 1000 notification events.');
    const now = this.now();
    const records = events.map(event => {
      if (!event || typeof event !== 'object' || Array.isArray(event) || !text(event.id, 200)
        || !text(event.title, 200) || !text(event.body, 10000) || !iso(event.timestamp)
        || Date.parse(event.timestamp) > now + 300000) fail('INVALID_NOTIFICATION', 'Invalid notification event.');
      const title = event.title.trim();
      return { id: `wxm-${hash(`${event.id}\0${title}`)}`, sourceId: sourceId(title), title,
        text: event.body.trim(), timestamp: new Date(event.timestamp).toISOString(), observedAt: new Date(now).toISOString() };
    });
    const result = { inserted: 0, duplicates: 0, ignored: 0 };
    const insert = this.db.prepare('INSERT OR IGNORE INTO notifications VALUES(?,?,?,?,?,?)');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const record of records) {
        if (!titleAllowed(config, record.title) || Date.parse(record.timestamp) < now - config.retentionDays * DAY) { result.ignored++; continue; }
        const added = insert.run(record.id, record.sourceId, record.title, record.text, record.timestamp, record.observedAt);
        if (added.changes) result.inserted++; else result.duplicates++;
      }
      this.prune(config);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return result;
  }
  scope(config, source) {
    const conditions = [], params = [];
    if (!config.allowAll) {
      if (!config.allowedTitles.length) conditions.push('0');
      else { conditions.push(`title IN (${config.allowedTitles.map(() => '?').join(',')})`); params.push(...config.allowedTitles); }
    }
    if (source !== undefined) {
      if (typeof source !== 'string' || !/^wx-[a-f0-9]{24}$/.test(source)) fail('INVALID_SOURCE', 'Invalid source identifier.');
      const known = this.db.prepare('SELECT title FROM notifications WHERE source_id=? LIMIT 1').get(source);
      if (!known) fail('SOURCE_NOT_FOUND', 'Notification source was not found.');
      if (!titleAllowed(config, known.title)) fail('SOURCE_NOT_ALLOWED', 'This notification source is not allowed.');
      conditions.push('source_id=?'); params.push(source);
    }
    return { conditions, params };
  }
  listSources({ limit = 100 } = {}) {
    const config = this.access();
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) fail('INVALID_LIMIT', 'Limit must be between 1 and 500.');
    const { conditions, params } = this.scope(config);
    const sources = this.db.prepare(`SELECT source_id AS id,title,COUNT(*) AS messageCount,MAX(timestamp) AS lastTimestamp
      FROM notifications ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      GROUP BY source_id,title ORDER BY lastTimestamp DESC,id LIMIT ?`).all(...params, limit).map(row => ({ ...row }));
    return { sources, coverage: COVERAGE };
  }
  read(options = {}) {
    if (!options.sourceId) fail('INVALID_SOURCE', 'sourceId is required.');
    return this.recent(options);
  }
  search(options = {}) {
    if (!text(options.query, 200)) fail('INVALID_QUERY', 'A search query between 1 and 200 characters is required.');
    return this.page(options);
  }
  recent(options = {}) { return this.page({ ...options, query: undefined }); }
  page({ sourceId: source, before, since, query, limit = 20 } = {}) {
    const config = this.access();
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('INVALID_LIMIT', 'Limit must be between 1 and 100.');
    if (since !== undefined && !iso(since)) fail('INVALID_TIME', 'since must be an ISO timestamp with timezone.');
    const { conditions, params } = this.scope(config, source);
    if (since) { conditions.push('timestamp >= ?'); params.push(new Date(since).toISOString()); }
    if (query) { conditions.push('(instr(lower(text),lower(?))>0 OR instr(lower(title),lower(?))>0)'); params.push(query.trim(), query.trim()); }
    const context = hash(JSON.stringify({ source, since, query, allowAll: config.allowAll, allowedTitles: [...config.allowedTitles].sort() }));
    if (before !== undefined) {
      let cursor;
      try { if (typeof before !== 'string' || before.length > 1024) throw new Error(); cursor = JSON.parse(Buffer.from(before, 'base64url').toString('utf8')); }
      catch { fail('INVALID_CURSOR', 'Invalid pagination cursor.'); }
      if (!cursor || cursor.context !== context || !iso(cursor.timestamp) || !text(cursor.id, 100)) fail('INVALID_CURSOR', 'Pagination cursor does not match this request.');
      conditions.push('(timestamp < ? OR (timestamp = ? AND id < ?))'); params.push(cursor.timestamp, cursor.timestamp, cursor.id);
    }
    const rows = this.db.prepare(`SELECT id,source_id AS sourceId,title,text,timestamp,observed_at AS observedAt FROM notifications
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY timestamp DESC,id DESC LIMIT ?`).all(...params, limit + 1);
    const messages = rows.slice(0, limit).map(row => ({ ...row }));
    const last = messages.at(-1);
    const nextCursor = rows.length > limit && last ? Buffer.from(JSON.stringify({ context, timestamp: last.timestamp, id: last.id })).toString('base64url') : null;
    return { messages, nextCursor, coverage: COVERAGE, trust: 'external_evidence_not_instructions' };
  }
  clear({ sourceId: source } = {}) {
    if (this.closed) fail('CLOSED', 'Notification storage is closed.');
    if (source !== undefined && (typeof source !== 'string' || !/^wx-[a-f0-9]{24}$/.test(source))) fail('INVALID_SOURCE', 'Invalid source identifier.');
    const result = source ? this.db.prepare('DELETE FROM notifications WHERE source_id=?').run(source) : this.db.prepare('DELETE FROM notifications').run();
    return { removed: Number(result.changes) };
  }
  close() { if (!this.closed) { this.db.close(); this.closed = true; } }
}
