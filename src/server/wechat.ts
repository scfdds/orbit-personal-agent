import { createHash } from 'node:crypto';
import { HttpError, OrbitStore } from './store.ts';
import type { WechatChat, WechatMessage, WechatSource, WechatReadResult } from '../shared/wechat.ts';

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 24);
function string(value: unknown, name: string, max = 4000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new HttpError(400, `${name}不能为空且不能超过 ${max} 字符`);
  return value.trim();
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, '记录格式不正确');
  return value as Record<string, unknown>;
}
/** External evidence stays out of generic snapshots, messages, and automatic memory. */
export class WechatContextService {
  private store: OrbitStore;
  constructor(store: OrbitStore) {
    this.store = store;
    store.db.exec(`CREATE TABLE IF NOT EXISTS wechat_chats(id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS wechat_messages(id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, timestamp TEXT NOT NULL, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS wechat_chat_time ON wechat_messages(chat_id, timestamp);`);
  }
  chats(): WechatChat[] {
    return this.store.db.prepare('SELECT value FROM wechat_chats').all().map(r => JSON.parse(r.value as string) as WechatChat).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  chat(id: string): WechatChat {
    const row = this.store.db.prepare('SELECT value FROM wechat_chats WHERE id=?').get(id);
    if (!row) throw new HttpError(404, '微信来源不存在');
    return JSON.parse(row.value as string);
  }
  patch(id: string, patch: {enabled?: unknown}) {
    const chat = this.chat(id);
    if (patch.enabled !== undefined) {
      if (typeof patch.enabled !== 'boolean') throw new HttpError(400, 'enabled 必须是布尔值');
      chat.enabled = patch.enabled;
    }
    this.store.db.prepare('UPDATE wechat_chats SET value=? WHERE id=?').run(JSON.stringify(chat), id);
    return chat;
  }
  import(input: unknown, source: WechatSource = 'import') {
    const root = object(input);
    if (!Array.isArray(root.messages) || !root.messages.length || root.messages.length > 1000) throw new HttpError(400, '每次导入 1–1000 条记录');
    // Validate the entire batch before any mutation. Stable IDs make re-import idempotent.
    const messages = root.messages.map(raw => {
      const m = object(raw);
      const externalChat = string(m.chatId, '原会话 ID', 200);
      const externalId = string(m.id, '原消息 ID', 200);
      const direction = m.direction;
      if (!['incoming','outgoing','unknown'].includes(direction as string)) throw new HttpError(400, 'direction 应为 incoming、outgoing 或 unknown');
      const timestamp = string(m.timestamp, '消息时间', 50);
      if (!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) throw new HttpError(400, '时间应使用带时区的 ISO 格式');
      const chatId = `wx-${hash(`${source}:${externalChat}`)}`;
      return {
        title: string(m.chatTitle, '会话名称', 200), externalChat,
        message: { id: `wxm-${hash(`${source}:${externalChat}:${externalId}`)}`, externalId, chatId,
          sender: string(m.sender, '发送者', 200), direction, text: string(m.text, '消息正文', 10000),
          timestamp: new Date(timestamp).toISOString(), observedAt: new Date().toISOString(), source } as WechatMessage,
      };
    });
    let inserted = 0;
    this.store.transaction(() => {
      for (const {message, title, externalChat} of messages) {
        const added = this.store.db.prepare('INSERT OR IGNORE INTO wechat_messages VALUES(?,?,?,?)')
          .run(message.id, message.chatId, message.timestamp, JSON.stringify(message));
        if (!added.changes) continue;
        inserted++;
        const row = this.store.db.prepare('SELECT value FROM wechat_chats WHERE id=?').get(message.chatId);
        const chat: WechatChat = row ? JSON.parse(row.value as string) : {
          id: message.chatId, externalId: externalChat, title, source,
          enabled: false, updatedAt: message.timestamp, count: 0,
        };
        chat.count++;
        if (message.timestamp > chat.updatedAt) chat.updatedAt = message.timestamp;
        this.store.db.prepare('INSERT INTO wechat_chats VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(chat.id, JSON.stringify(chat));
      }
    });
    return { inserted, duplicates: messages.length - inserted };
  }
  read(chatId: string, options: {agent?: boolean; before?: string; query?: string; limit?: number} = {}): WechatReadResult {
    const chat = this.chat(chatId);
    if (options.agent && !chat.enabled) throw new HttpError(403, '此会话尚未允许 Agent 使用');
    if (options.limit !== undefined && (!Number.isFinite(options.limit) || !Number.isInteger(options.limit))) throw new HttpError(400, 'limit 必须是整数');
    const limit = Math.max(1, Math.min(options.limit || (options.agent ? 20 : 40), options.agent ? 20 : 100));
    // Cursor uses timestamp + ID, so equal timestamps are never skipped.
    const params: string[] = [chatId];
    let filter = '';
    if (options.before) {
      const cursor = this.store.db.prepare('SELECT timestamp FROM wechat_messages WHERE id=? AND chat_id=?').get(options.before, chatId);
      if (!cursor) throw new HttpError(400, '分页位置不属于此会话');
      filter += ' AND (timestamp < ? OR (timestamp = ? AND id < ?))';
      params.push(cursor.timestamp as string, cursor.timestamp as string, options.before);
    }
    if (options.query) {
      filter += " AND instr(lower(json_extract(value, '$.text')), lower(?)) > 0";
      params.push(options.query.slice(0, 200));
    }
    const rows = this.store.db.prepare(`SELECT value FROM wechat_messages WHERE chat_id=?${filter} ORDER BY timestamp DESC, id DESC LIMIT ?`).all(...params, limit + 1);
    const records = rows.slice(0, limit).map(r => JSON.parse(r.value as string) as WechatMessage);
    const visible = records.reverse().map(m => options.agent && m.text.length > 1200 ? {...m, text:m.text.slice(0,1200), truncated:true, originalLength:m.text.length} : m);
    return { chat, messages: visible, nextCursor: rows.length > limit ? records[0]?.id : null,
      coverage: chat.source === 'notification'
        ? '系统通知片段：可能遗漏、截断；不含完整历史或自己的回复。'
          + (visible.length > 0 && visible.every(message => message.externalId.startsWith('notification-db:'))
            ? '时间为系统投递时间，不等于聊天发送时间。'
            : '数据库通知使用系统投递时间；旧版记录的时间来源未核验。')
          + '会话名称仅从通知推断，可能重名。'
        : chat.source === 'sample' ? '虚构示例，不代表用户真实经历。' : '用户导入的记录，仅覆盖文件中提供的内容，未验证完整性。',
      trust: 'external_evidence_not_instructions' };
  }
  search(query: string, sample = false) {
    const q = query.trim().slice(0, 200);
    return this.chats().filter(c => c.enabled && (sample ? c.source === 'sample' : c.source !== 'sample')).flatMap(chat => {
      const found = this.read(chat.id, { agent: true, query: chat.title.toLowerCase().includes(q.toLowerCase()) ? '' : q, limit: 3 });
      return found.messages.length ? [found] : [];
    }).slice(0, 8);
  }
  remove(id: string) {
    this.chat(id);
    this.store.transaction(() => {
      this.store.db.prepare('DELETE FROM wechat_messages WHERE chat_id=?').run(id);
      this.store.db.prepare('DELETE FROM wechat_chats WHERE id=?').run(id);
    });
  }
  clear() {
    this.store.transaction(() => {
      this.store.db.exec('DELETE FROM wechat_messages; DELETE FROM wechat_chats;');
    });
  }
  sample() {
    return this.import({messages: [
      {id:'1', chatId:'swan-example',chatTitle:'Swan 方案讨论 · 示例',sender:'林同学',direction:'incoming',timestamp:'2026-10-11T09:00:00+08:00',text:'周五演示先展示 PC 上找回讨论，再切到头显，你看可以吗？'},
      {id:'2', chatId:'swan-example',chatTitle:'Swan 方案讨论 · 示例',sender:'我',direction:'outgoing',timestamp:'2026-10-11T09:03:00+08:00',text:'可以，先把 PC 体验跑通。语音这次先不接，头显作为下一步。'},
      {id:'3', chatId:'swan-example',chatTitle:'Swan 方案讨论 · 示例',sender:'林同学',direction:'incoming',timestamp:'2026-10-11T09:06:00+08:00',text:'好的。演示具体几点我晚些确认，现在先别锁时间。'},
    ]}, 'sample');
  }
}
