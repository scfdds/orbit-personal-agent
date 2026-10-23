import { readdir } from "node:fs/promises";
import type { AppDefinition } from "../shared/plugin.ts";

/** Drop an app directory with a default AppDefinition export into this folder. */
export async function loadApps(options: { installedOnly?: boolean } = {}): Promise<AppDefinition[]> {
  const folders = await readdir(new URL("./", import.meta.url), {
    withFileTypes: true,
  });
  const apps: AppDefinition[] = [];
  const ids = new Set<string>();
  const toolNames = new Set<string>();
  for (const folder of folders
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const files = await readdir(new URL(`./${folder.name}/`, import.meta.url));
    if (!files.includes("index.ts")) continue;
    // Legacy feedback demo remains on disk for historical data and explicit tests.
    if (options.installedOnly && ["feedback", "opportunities"].includes(folder.name)) continue;
    const { default: app } = (await import(
      new URL(`./${folder.name}/index.ts`, import.meta.url).href
    )) as { default: AppDefinition };
    if (
      !app?.manifest?.id ||
      typeof app.createTools !== "function" ||
      typeof app.seed !== "function"
    ) {
      throw new Error(
        `应用 ${folder.name} 缺少有效的 manifest、createTools 或 seed`,
      );
    }
    if (app.manifest.id !== folder.name)
      throw new Error(`应用 ID 必须与目录名一致：${folder.name}`);
    if (ids.has(app.manifest.id))
      throw new Error(`重复的应用 ID：${app.manifest.id}`);
    ids.add(app.manifest.id);
    for (const tool of app.manifest.tools) {
      if (toolNames.has(tool.name))
        throw new Error(`重复的应用工具名：${tool.name}`);
      toolNames.add(tool.name);
    }
    apps.push(app);
  }
  return apps;
}
