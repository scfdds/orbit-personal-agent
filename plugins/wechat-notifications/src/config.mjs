import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export class PluginError extends Error {
  constructor(code, message) { super(message); this.name = 'PluginError'; this.code = code; }
}

export const DEFAULT_CONFIG = Object.freeze({ schemaVersion: 1, enabled: false, allowAll: false, allowedTitles: [], retentionDays: 7 });
const keys = new Set(Object.keys(DEFAULT_CONFIG));

export function validateConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.has(key))) {
    throw new PluginError('INVALID_CONFIG', 'Configuration contains unsupported fields.');
  }
  const value = { ...DEFAULT_CONFIG, ...input };
  if (value.schemaVersion !== 1 || typeof value.enabled !== 'boolean' || typeof value.allowAll !== 'boolean'
    || !Array.isArray(value.allowedTitles) || value.allowedTitles.length > 500
    || value.allowedTitles.some(title => typeof title !== 'string' || !title.trim() || title.length > 200 || /[\r\n\0]/.test(title))
    || !Number.isSafeInteger(value.retentionDays) || value.retentionDays < 1 || value.retentionDays > 90) {
    throw new PluginError('INVALID_CONFIG', 'Invalid notification access settings.');
  }
  return { ...value, allowedTitles: [...new Set(value.allowedTitles.map(title => title.trim()))] };
}

export function ensurePrivateDir(dataDir) {
  if (typeof dataDir !== 'string' || !dataDir) throw new PluginError('INVALID_DATA_DIR', 'A local data directory is required.');
  const directory = resolve(dataDir);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new PluginError('INVALID_DATA_DIR', 'Data directory must be a real directory.');
  chmodSync(directory, 0o700);
  return directory;
}

export function assertPrivateFile(path) {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new PluginError('INVALID_DATA_FILE', 'Data files must be ordinary local files.');
  chmodSync(path, 0o600);
}

export function loadConfig(dataDir) {
  const directory = ensurePrivateDir(dataDir);
  const path = join(directory, 'config.json');
  if (!existsSync(path)) return validateConfig({});
  assertPrivateFile(path);
  try {
    const content = readFileSync(path, 'utf8');
    if (content.length > 200000) throw new Error('size');
    return validateConfig(JSON.parse(content));
  } catch (error) {
    if (error instanceof PluginError) throw error;
    throw new PluginError('INVALID_CONFIG', 'Cannot read notification access settings.');
  }
}

export function saveConfig(dataDir, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !keys.has(key))) {
    throw new PluginError('INVALID_CONFIG', 'Configuration contains unsupported fields.');
  }
  const value = validateConfig({ ...loadConfig(dataDir), ...patch });
  const directory = ensurePrivateDir(dataDir);
  const temporary = join(directory, `.config-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, join(directory, 'config.json'));
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  return value;
}

export function titleAllowed(config, title) {
  return config.enabled && (config.allowAll || config.allowedTitles.includes(title));
}
