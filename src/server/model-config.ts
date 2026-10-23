export interface ModelConfig {
  apiKey: string;
  baseUrl: string;
  modelId: string;
}

const models = ["deepseek-flash", "deepseek-v4-pro"];
const knownSecrets = new Set<string>();
export function modelConfigurationPath() {
  return resolve(process.env.ORBIT_CONFIG_PATH || resolve(process.env.ORBIT_DATA_DIR || resolve(fileURLToPath(new URL("../../", import.meta.url)), ".agent-data/orbit"), "model-config.json"));
}
function storedConfig(): { apiKey?: string; model?: string } {
  const path = modelConfigurationPath();
  if (!existsSync(path)) return {};
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    if (typeof value.apiKey === "string" && value.apiKey) knownSecrets.add(value.apiKey);
    return { ...(typeof value.apiKey === "string" ? { apiKey: value.apiKey } : {}), ...(typeof value.model === "string" ? { model: value.model } : {}) };
  } catch { throw new Error("模型配置文件无法读取，请重新保存设置"); }
}
function currentSettings() {
  const stored = storedConfig();
  const apiKey = (stored.apiKey ?? process.env.DEEPSEEK_API_KEY ?? "").trim();
  if (apiKey) knownSecrets.add(apiKey);
  return { apiKey, model: stored.model || process.env.DEEPSEEK_MODEL || "deepseek-flash" };
}
export function modelConfigurationState(): ModelConfigurationState {
  try { const { apiKey, model } = currentSettings(); return { configured: Boolean(apiKey), model }; }
  catch { return { configured: false, model: "deepseek-flash" }; }
}
export function saveModelConfiguration(input: Record<string, unknown>): ModelConfigurationState {
  if (input.apiKey !== undefined && (typeof input.apiKey !== "string" || !input.apiKey.trim() || input.apiKey.length > 512 || /[\r\n]/.test(input.apiKey))) throw new HttpError(400, "请输入有效的 API Key");
  if (input.model !== undefined && !models.includes(String(input.model))) throw new HttpError(400, "不支持该模型");
  if (input.clear !== undefined && input.clear !== true && input.clear !== false) throw new HttpError(400, "无效的配置操作");
  if (input.clear === true && input.apiKey !== undefined) throw new HttpError(400, "不能同时清除和设置 API Key");
  let current = { apiKey: "", model: "deepseek-flash" };
  try { current = currentSettings(); } catch { /* A valid save repairs a damaged file. */ }
  const saved = { apiKey: input.clear === true ? "" : typeof input.apiKey === "string" ? input.apiKey.trim() : current.apiKey, model: typeof input.model === "string" ? input.model : current.model };
  if (saved.apiKey) knownSecrets.add(saved.apiKey);
  const path = modelConfigurationPath(), temporary = `${path}.${randomUUID()}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(temporary, JSON.stringify(saved), { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
    chmodSync(path, 0o600);
  } catch { throw new Error("无法保存模型设置，请检查用户数据目录"); }
  finally { rmSync(temporary, { force: true }); }
  return { configured: Boolean(saved.apiKey), model: saved.model };
}

/** Called only by the server. Never serialize the returned config to a client. */
export function readModelConfig(): ModelConfig {
  const settings = currentSettings();
  const apiKey = settings.apiKey;
  if (!apiKey) throw new Error("请先在设置中配置 DeepSeek API Key");
  const baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
  const url = new URL(baseUrl);
  if (
    url.origin !== "https://api.deepseek.com" ||
    url.username ||
    url.password
  ) {
    throw new Error("当前 DeepSeek 适配器仅允许官方 HTTPS 接口");
  }
  const modelId = settings.model;
  if (!["deepseek-flash", "deepseek-v4-pro"].includes(modelId)) {
    throw new Error("当前适配器尚未验证该模型");
  }
  return { apiKey, baseUrl, modelId };
}

export function safeErrorMessage(error: unknown): string {
  let text = error instanceof Error ? error.message : String(error);
  for (const key of [...knownSecrets, process.env.DEEPSEEK_API_KEY, process.env.ORBIT_AUTH_TOKEN])
    if (key) text = text.split(key).join("[REDACTED]");
  return text;
}
import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, chmodSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { HttpError } from "./store.ts";
import type { ModelConfigurationState } from "../shared/assistant.ts";
