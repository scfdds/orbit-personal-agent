import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Type } from "typebox";
import { defineTool, type AgentSession } from "@earendil-works/pi-coding-agent";
import { createWorkspaceSession } from "../src/server/pi-session.ts";
import {
  readModelConfig,
  safeErrorMessage,
} from "../src/server/model-config.ts";

const dataDir = resolve(
  ".agent-data/model-check",
  new Date().toISOString().replaceAll(":", "-"),
);
const objectPath = resolve(dataDir, "comparison.json");
let currentSession: AgentSession | undefined;
let toolLoads = 0;
let streamDeltas = 0;
let modelTurns = 0;
const reads: Array<{ version: number; budget: number }> = [];
const apiErrors: string[] = [];

const loadApp = defineTool({
  name: "load_app",
  label: "加载示例应用",
  description: "加载方案对比表应用并启用读取对象的工具。",
  parameters: Type.Object({ app: Type.Literal("comparison") }),
  async execute() {
    toolLoads++;
    currentSession!.setActiveToolsByName(["load_app", "read_demo_object"]);
    return {
      content: [
        {
          type: "text",
          text: "应用已加载。请调用 read_demo_object 读取最新数据。",
        },
      ],
      details: undefined,
    };
  },
});
const readObject = defineTool({
  name: "read_demo_object",
  label: "读取示例对象",
  description:
    "读取 comparison-1 的当前已保存预算与版本；每次用户修改后必须重新读取。",
  parameters: Type.Object({ objectId: Type.Literal("comparison-1") }),
  async execute() {
    const object = JSON.parse(await readFile(objectPath, "utf8"));
    reads.push({ version: object.version, budget: object.budget });
    return {
      content: [{ type: "text", text: JSON.stringify(object) }],
      details: object,
    };
  },
});

async function openSession(sessionFile?: string) {
  const { session } = await createWorkspaceSession({
    dataDir,
    systemPrompt:
      "你是工作区主 Agent。根据可用工具读取应用中的事实，用户说内容发生变化时必须重新读取。需要工具未启用时先加载应用。最终用一句中文报告预算数字。",
    tools: [loadApp, readObject],
    activeTools: ["load_app"],
    sessionFile,
    thinkingLevel: "low",
  });
  currentSession = session;
  session.subscribe((event) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    )
      streamDeltas++;
    if (event.type === "message_end" && event.message.role === "assistant") {
      modelTurns++;
      if (event.message.stopReason === "error")
        apiErrors.push(event.message.errorMessage ?? "模型返回错误");
    }
  });
  return session;
}

try {
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    objectPath,
    JSON.stringify({ id: "comparison-1", version: 1, budget: 1200 }),
  );
  let session = await openSession();
  const watchdog = setTimeout(() => {
    void currentSession?.abort();
  }, 90000);
  try {
    await session.prompt(
      "请加载方案对比表应用，读取 comparison-1 并告诉我当前预算。",
    );
    assert.equal(apiErrors.length, 0, apiErrors.join("; "));
    assert(
      reads.some((read) => read.version === 1 && read.budget === 1200),
      "首轮没有实际读取对象",
    );
    assert(
      session.getLastAssistantText()?.includes("1200"),
      "首轮未根据工具结果回答",
    );
    const sessionFile = session.sessionManager.getSessionFile();
    assert(sessionFile, "未保存 Pi 会话");
    session.dispose();

    // Simulates an application's saved edit; no GUI has been implemented yet.
    await writeFile(
      objectPath,
      JSON.stringify({ id: "comparison-1", version: 2, budget: 750 }),
    );
    session = await openSession(sessionFile);
    await session.prompt(
      "我修改了 comparison-1，请读取最新对象，告诉我现在的预算。",
    );
    assert.equal(apiErrors.length, 0, apiErrors.join("; "));
    assert(
      reads.some((read) => read.version === 2 && read.budget === 750),
      "恢复后未读取最新版本",
    );
    assert(
      session.getLastAssistantText()?.includes("750"),
      "恢复后未使用最新预算",
    );
    assert(streamDeltas > 0, "未收到文本流式事件");
    const report = {
      ok: true,
      checkedAt: new Date().toISOString(),
      provider: "deepseek",
      model: readModelConfig().modelId,
      piVersion: "0.87.1",
      thinkingLevel: "low",
      checks: [
        "streaming",
        "dynamic-tool-activation",
        "tool-result-followup",
        "session-save-and-reopen",
        "latest-object-version",
      ],
      toolLoads,
      modelTurns,
      streamDeltas,
      reads,
      note: "真实模型和 Pi 工具调用；业务对象为本地测试数据，尚无 GUI。",
    };
    await writeFile(
      resolve(dataDir, "result.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    clearTimeout(watchdog);
    currentSession?.dispose();
  }
} catch (error) {
  currentSession?.dispose();
  console.error(safeErrorMessage(error));
  process.exitCode = 1;
}
