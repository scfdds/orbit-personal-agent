const { readFile, writeFile, rename, rm, mkdir } = require('node:fs/promises');
const { join, dirname } = require('node:path');
const { randomUUID } = require('node:crypto');

const DEFAULT_PREFERENCES = Object.freeze({ spokenDelivery: true });
function sanitizePreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !Object.keys(value).length
    || Object.keys(value).some(key => !['spokenDelivery', 'sidebarCollapsed', 'recentMatterIds'].includes(key))
    || value.spokenDelivery !== undefined && typeof value.spokenDelivery !== 'boolean'
    || value.sidebarCollapsed !== undefined && typeof value.sidebarCollapsed !== 'boolean'
    || value.recentMatterIds !== undefined && (!Array.isArray(value.recentMatterIds) || value.recentMatterIds.length > 7
      || value.recentMatterIds.some(id => typeof id !== 'string' || !id || id.length > 256))) throw new Error('偏好设置格式不正确');
  return {
    ...(typeof value.spokenDelivery === 'boolean' ? { spokenDelivery: value.spokenDelivery } : {}),
    ...(typeof value.sidebarCollapsed === 'boolean' ? { sidebarCollapsed: value.sidebarCollapsed } : {}),
    ...(value.recentMatterIds ? { recentMatterIds: [...new Set(value.recentMatterIds)] } : {}),
  };
}
/** Native storage survives the random loopback port used by each app launch. */
class PreferenceStore {
  constructor(directory) { this.file = join(directory, 'preferences.json'); this.queue = Promise.resolve(); this.value = null; }
  async load() {
    if (this.value) return;
    try { this.value = { ...DEFAULT_PREFERENCES, ...sanitizePreferences(JSON.parse(await readFile(this.file, 'utf8'))) }; }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error('无法读取已保存的偏好设置');
      this.value = { ...DEFAULT_PREFERENCES };
    }
  }
  read() {
    const operation = this.queue.then(async () => { await this.load(); return { ...this.value }; });
    this.queue = operation.then(() => {}, () => {});
    return operation;
  }
  write(value) {
    let clean;
    try { clean = sanitizePreferences(value); } catch (error) { return Promise.reject(error); }
    const operation = this.queue.then(async () => {
      await this.load();
      const updated = { ...this.value, ...clean };
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(updated), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        await rename(temporary, this.file);
        this.value = updated;
      } finally { await rm(temporary, { force: true }); }
      return { ...updated };
    });
    this.queue = operation.then(() => {}, () => {});
    return operation;
  }
  flush() { return this.queue; }
}
module.exports = { PreferenceStore, sanitizePreferences, DEFAULT_PREFERENCES };
