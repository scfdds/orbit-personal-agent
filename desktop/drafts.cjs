const { readFile, writeFile, rename, rm, stat, mkdir } = require('node:fs/promises');
const { join, dirname } = require('node:path');
const { randomUUID } = require('node:crypto');

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_DRAFTS = 100;
function validId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 160 && !/[\u0000-\u001f]/.test(id) && !['__proto__', 'prototype', 'constructor'].includes(id);
}
function sanitizeDraft(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.text !== 'string' || value.text.length > 40000) throw new Error('草稿格式不正确');
  let reference = null;
  if (value.reference !== null && value.reference !== undefined) {
    if (typeof value.reference !== 'object' || Array.isArray(value.reference)) throw new Error('草稿引用格式不正确');
    reference = {};
    for (const key of ['conversationId', 'messageId', 'artifactId', 'appId', 'objectId', 'quote']) {
      const field = value.reference[key];
      if (field === undefined) continue;
      if (typeof field !== 'string' || field.length > (key === 'quote' ? 4000 : 160)) throw new Error('草稿引用内容过长');
      if (field) reference[key] = field;
    }
    if (!Object.keys(reference).length) reference = null;
  }
  return { text: value.text, reference };
}
function bounded(entries) {
  while (entries.size > MAX_DRAFTS || Buffer.byteLength(JSON.stringify(Object.fromEntries(entries)), 'utf8') > MAX_BYTES) entries.delete(entries.keys().next().value);
  return entries;
}
class DraftStore {
  constructor(directory) {
    this.file = join(directory, 'drafts.json');
    this.queue = Promise.resolve();
    this.entries = null;
  }
  async load() {
    if (this.entries) return;
    const entries = new Map();
    try {
      if ((await stat(this.file)).size > MAX_BYTES) throw new Error('草稿文件超过大小限制');
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('草稿文件格式不正确');
      for (const [id, value] of Object.entries(data)) {
        if (!validId(id)) continue;
        try { entries.set(id, sanitizeDraft(value)); } catch { /* Ignore individual malformed records. */ }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('无法读取已保存的草稿');
    }
    this.entries = bounded(entries);
  }
  read() {
    const operation = this.queue.then(async () => {
      await this.load();
      return JSON.parse(JSON.stringify(Object.fromEntries(this.entries)));
    });
    this.queue = operation.then(() => {}, () => {});
    return operation;
  }
  write(id, draft) {
    if (!validId(id)) return Promise.reject(new Error('无效的草稿 ID'));
    let clean;
    try { clean = sanitizeDraft(draft); } catch (error) { return Promise.reject(error); }
    const operation = this.queue.then(async () => {
      await this.load();
      const next = new Map(this.entries);
      next.delete(id);
      if (clean.text || clean.reference) next.set(id, clean);
      bounded(next);
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(Object.fromEntries(next)), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        await rename(temporary, this.file);
        this.entries = next;
      } finally { await rm(temporary, { force: true }); }
    });
    this.queue = operation.then(() => {}, () => {});
    return operation;
  }
  flush() { return this.queue; }
}
module.exports = { DraftStore, sanitizeDraft, validId, MAX_BYTES, MAX_DRAFTS };
