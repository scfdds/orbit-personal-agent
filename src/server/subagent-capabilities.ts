import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Type } from "typebox";
import {
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const skills = [
  {
    id: "feedback-research",
    name: "反馈研究",
    description: "按用户群研究反馈，区分问题与改进机会。",
  },
  {
    id: "evidence-review",
    name: "证据复核",
    description: "复核结论、反馈引用与不确定性。",
  },
].map((skill) => ({
  ...skill,
  content: readFileSync(resolve(root, "skills", skill.id, "SKILL.md"), "utf8"),
}));

export interface McpConfig {
  id: string;
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  readOnlyTools: string[];
}
export function readMcpConfig(): McpConfig[] {
  const path = process.env.ORBIT_MCP_CONFIG || resolve(root, "mcp.local.json");
  if (!existsSync(path)) return [];
  const config = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(config.servers))
    throw new Error("MCP 配置需要 servers 数组");
  const ids = new Set<string>();
  return config.servers.map((server: McpConfig) => {
    if (
      !server ||
      !/^[a-z][a-z0-9-]{0,40}$/.test(server.id) ||
      ids.has(server.id) ||
      typeof server.name !== "string" ||
      typeof server.command !== "string" ||
      !Array.isArray(server.readOnlyTools) ||
      !server.readOnlyTools.every(
        (t) => typeof t === "string" && /^[a-zA-Z0-9_-]+$/.test(t),
      ) ||
      (server.args !== undefined &&
        (!Array.isArray(server.args) ||
          !server.args.every((a) => typeof a === "string"))) ||
      (server.env !== undefined &&
        (!server.env ||
          typeof server.env !== "object" ||
          !Object.values(server.env).every((v) => typeof v === "string")))
    )
      throw new Error("MCP 配置无效，请检查服务 ID、命令与只读工具白名单");
    ids.add(server.id);
    return server;
  });
}
export const mcpToolName = (serverId: string, tool: string) =>
  `mcp_${serverId.replaceAll("-", "_")}__${tool}`;

/** Only administrator-configured, explicitly selected tools reach the child registry. */
export async function connectMcpTools(
  config: McpConfig[],
  names: string[],
  guard: () => void,
) {
  const clients: Client[] = [];
  const tools: ToolDefinition[] = [];
  const close = async () => {
    await Promise.allSettled(clients.map((client) => client.close()));
  };
  try {
    for (const server of config) {
      const selected = server.readOnlyTools.filter((name) =>
        names.includes(mcpToolName(server.id, name)),
      );
      if (!selected.length) continue;
      guard();
      const client = new Client({ name: "orbit-subagent", version: "0.1.0" });
      clients.push(client);
      const transport = new StdioClientTransport({
        command: server.command,
        args: server.args,
        env: server.env,
        cwd: root,
        stderr: "pipe",
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          client.connect(transport),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`MCP ${server.name} 连接超时`)),
              10000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      const advertised = [];
      let cursor: string | undefined;
      for (let page = 0; page < 10; page++) {
        const listed = await client.listTools(cursor ? { cursor } : undefined, {
          timeout: 10000,
        });
        advertised.push(...listed.tools);
        cursor = listed.nextCursor;
        if (!cursor) break;
      }
      for (const name of selected) {
        const entry = advertised.find((t) => t.name === name);
        if (!entry) throw new Error(`MCP ${server.name} 未提供工具 ${name}`);
        tools.push(
          defineTool({
            name: mcpToolName(server.id, name),
            label: `${server.name} · ${name}`,
            description: entry.description || `调用 ${server.name} 的 ${name}`,
            parameters: Type.Unsafe<Record<string, unknown>>(entry.inputSchema),
            execute: async (_id, args, signal) => {
              guard();
              const response = await client.callTool(
                { name, arguments: args },
                undefined,
                { signal, timeout: 20000 },
              );
              guard();
              if (response.isError) throw new Error(`MCP ${name} 执行失败`);
              const text = (
                response.content as { type: string; text?: string }[]
              )
                .filter((b) => b.type === "text")
                .map((b) => b.text || "")
                .join("\n")
                .slice(0, 16000);
              return {
                content: [
                  {
                    type: "text" as const,
                    text: text || "工具已完成，没有文本输出。",
                  },
                ],
                details: undefined,
              };
            },
          }),
        );
      }
    }
    return { tools, close };
  } catch (error) {
    await close();
    throw error;
  }
}
