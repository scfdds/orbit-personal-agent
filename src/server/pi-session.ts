import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  createExtensionRuntime,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ResourceLoader,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { readModelConfig } from "./model-config.ts";

export interface WorkspaceSessionOptions {
  dataDir: string;
  systemPrompt: string;
  tools: ToolDefinition[];
  activeTools: string[];
  sessionFile?: string;
  thinkingLevel?: "off" | "low" | "high";
}

/** The host owns tools/resources; Pi owns model execution and conversation state. */
export async function createWorkspaceSession(options: WorkspaceSessionOptions) {
  const config = readModelConfig();
  const dataDir = resolve(options.dataDir);
  const cwd = resolve(dataDir, "workspace");
  await mkdir(cwd, { recursive: true });
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    modelsStorePath: resolve(dataDir, "models-cache.json"),
    allowModelNetwork: false,
  });
  await modelRuntime.setRuntimeApiKey("deepseek", config.apiKey);
  const catalogModel = modelRuntime.getModel("deepseek", config.modelId);
  if (!catalogModel) throw new Error("Pi 模型目录尚未包含所选 DeepSeek 模型");
  const model = { ...catalogModel, baseUrl: config.baseUrl, maxTokens: 2048 };
  const resourceLoader: ResourceLoader = {
    getExtensions: () => ({
      extensions: [],
      errors: [],
      runtime: createExtensionRuntime(),
    }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => options.systemPrompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
  const result = await createAgentSession({
    cwd,
    agentDir: resolve(dataDir, "pi"),
    modelRuntime,
    model,
    thinkingLevel: options.thinkingLevel ?? "off",
    resourceLoader,
    customTools: options.tools,
    // Pi's allowlist also limits the registry. Register every permitted tool,
    // then select the initial active subset before the first model request.
    tools: options.tools.map((tool) => tool.name),
    sessionManager: options.sessionFile
      ? SessionManager.open(options.sessionFile)
      : SessionManager.create(cwd, resolve(dataDir, "sessions")),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: true },
      retry: { enabled: false },
    }),
  });
  result.session.setActiveToolsByName(options.activeTools);
  return result;
}
