import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { OrbitStore, now } from "./store.ts";
import { OrbitRuntime } from "./runtime.ts";
import { loadApps } from "../apps/registry.ts";
import { SubagentManager } from "./subagents.ts";
import { connectMcpTools } from "./subagent-capabilities.ts";
import type {
  AgentSession,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { WorkspaceSessionOptions } from "./pi-session.ts";
import type { Run } from "../shared/types.ts";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "orbit-child-"));
  const store = new OrbitStore(join(dir, "test.sqlite"));
  const runtime = new OrbitRuntime(store, await loadApps(), dir);
  runtime.seed();
  const parent = {
    run: {
      id: "parent-run",
      conversationId: "work-feedback",
      workId: "unused-goal",
      parentId: null,
      title: "main",
      status: "running",
      startedAt: now(),
      summary: "",
    } as Run,
    cancelled: false,
    children: new Set<AgentSession>(),
  };
  store.put("runs", parent.run);
  return {
    dir,
    store,
    runtime,
    parent,
    cleanup: async () => {
      await runtime.close();
      store.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("child identity persists across delegation, actual capability allowlist and execution definition snapshots", async () => {
  const f = await fixture();
  const opened: WorkspaceSessionOptions[] = [];
  const manager = new SubagentManager(
    f.store,
    f.dir,
    () => {},
    (conversationId, runId, guard) =>
      f.runtime.apps.flatMap((a) =>
        a.createTools(f.runtime.appContext(conversationId, true, runId, guard)),
      ),
  );
  manager.openSession = (async (options: WorkspaceSessionOptions) => {
    opened.push(options);
    let subscriber: (event: unknown) => void = () => {};
    return {
      session: {
        sessionManager: {
          getSessionFile: () => join(options.dataDir, "session.jsonl"),
        },
        subscribe: (fn: typeof subscriber) => {
          subscriber = fn;
        },
        prompt: async () => {
          subscriber({
            type: "tool_execution_start",
            toolCallId: "read",
            toolName: "feedback_read",
            args: { objectId: "example" },
          });
          subscriber({
            type: "tool_execution_end",
            toolCallId: "read",
            toolName: "feedback_read",
            result: { content: [{ type: "text", text: "evidence" }] },
            isError: false,
          });
          subscriber({
            type: "message_end",
            message: {
              role: "assistant",
              stopReason: "stop",
              content: [{ type: "text", text: "有证据的结论" }],
            },
          });
        },
        getLastAssistantText: () => "有证据的结论",
        dispose: () => {},
        abort: async () => {},
      },
    };
  }) as unknown as typeof manager.openSession;
  try {
    const first = await manager.run("work-feedback", f.parent, {
      title: "研究",
      instructions: "研究新用户",
      systemPrompt: "只研究新用户",
      skillIds: ["feedback-research"],
      toolNames: ["feedback_read"],
    });
    assert.equal(first.status, "completed");
    const agentId = first.agentId;
    assert.deepEqual(opened[0]!.activeTools, ["feedback_read"]);
    assert.deepEqual(
      opened[0]!.tools.map((t) => t.name),
      ["feedback_read"],
    );
    assert.match(opened[0]!.systemPrompt, /先读取最新反馈/);
    assert.doesNotMatch(opened[0]!.systemPrompt, /逐项对照原始反馈/);
    assert.equal(f.store.require("runs", first.runId).workId, undefined);
    assert.equal(f.store.require("subagents", agentId).status, "idle");
    manager.configure("work-feedback", {
      agentId,
      name: "研究",
      systemPrompt: "复核新证据",
      skillIds: ["evidence-review"],
      toolNames: [],
    });
    const next = await manager.run("work-feedback", f.parent, {
      agentId,
      title: "补充研究",
      instructions: "结合另一子任务的结论继续",
      systemPrompt: "复核新证据",
      skillIds: ["evidence-review"],
      toolNames: [],
    });
    assert.equal(next.agentId, agentId);
    assert.equal(
      opened[1]!.sessionFile,
      join(opened[0]!.dataDir, "session.jsonl"),
    );
    assert.deepEqual(opened[1]!.tools, []);
    assert.equal(f.store.require("runs", first.runId).definition?.version, 1);
    assert.equal(f.store.require("runs", next.runId).definition?.version, 2);
    assert.equal(
      f.store.list("subagentEvents").filter((e) => e.kind === "input").length,
      2,
    );
    assert.equal(
      f.store.list("subagentEvents").filter((e) => e.kind === "result").length,
      2,
    );
    assert.throws(() => manager.require("work-notes", agentId), /不属于/);
    assert.throws(
      () =>
        manager.configure("work-feedback", {
          name: "bad",
          systemPrompt: "bad",
          toolNames: ["feedback_update"],
        }),
      /可用/,
    );
    assert.throws(
      () =>
        manager.configure("work-feedback", {
          name: "bad",
          systemPrompt: "bad",
          skillIds: ["invented"],
        }),
      /可用/,
    );
    const reopened = new OrbitStore(join(f.dir, "test.sqlite"));
    assert.equal(reopened.require("subagents", agentId).version, 2);
    assert.equal(
      reopened.list("subagentEvents").length,
      f.store.list("subagentEvents").length,
    );
    reopened.close();
  } finally {
    await f.cleanup();
  }
});

test("follow-up routing is scoped to the selected child while visible chat stays readable", async () => {
  const f = await fixture();
  f.runtime.pump = () => {};
  try {
    const agent = f.runtime.subagents.configure("work-feedback", {
      name: "证据复核",
      systemPrompt: "复核证据",
      toolNames: [],
    });
    const text = "继续委派给「证据复核」：\n补充两句结论。";
    const runId = await f.runtime.send("work-feedback", text, undefined, agent.id);
    const message = f.store.list("messages").find((m) => m.runId === runId);
    assert.equal(message?.content, text);
    assert(!message?.content.includes(agent.id));
    const queued = f.store.pending().find((p) => p.runId === runId);
    assert(queued?.prompt.includes(agent.id));
    assert.equal(queued?.workId, undefined);
    assert.equal(f.store.list("works").length, 0);
    await assert.rejects(
      f.runtime.send("work-notes", text, undefined, agent.id),
      /不属于/,
    );
  } finally {
    await f.cleanup();
  }
});

test("stopping one child cancels only that execution; definitions remain; legacy history is not fabricated", async () => {
  const f = await fixture();
  const manager = f.runtime.subagents;
  let began!: () => void;
  const started = new Promise<void>((r) => (began = r));
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  manager.openSession = (async () => ({
    session: {
      sessionManager: { getSessionFile: () => undefined },
      subscribe: () => {},
      prompt: async () => {
        began();
        await gate;
      },
      abort: async () => release(),
      dispose: () => {},
      getLastAssistantText: () => "",
    },
  })) as unknown as typeof manager.openSession;
  try {
    const agent = manager.configure("work-feedback", {
      name: "研究",
      systemPrompt: "研究",
      toolNames: [],
    });
    const pending = manager.run("work-feedback", f.parent, {
      agentId: agent.id,
      title: "研究",
      instructions: "研究",
    });
    await started;
    assert.throws(
      () =>
        manager.configure("work-feedback", {
          agentId: agent.id,
          name: "changed",
          systemPrompt: "changed",
        }),
      /执行结束/,
    );
    await assert.rejects(
      manager.run("work-feedback", f.parent, {
        agentId: agent.id,
        title: "repeat",
        instructions: "repeat",
      }),
      /已在执行/,
    );
    await manager.stop("work-feedback", agent.id);
    const result = await pending;
    assert.equal(result.status, "cancelled");
    assert.equal(f.parent.cancelled, false);
    assert.equal(f.store.require("subagents", agent.id).status, "idle");
    f.store.put("runs", {
      id: "legacy",
      conversationId: "work-feedback",
      parentId: "old-main",
      title: "旧记录",
      status: "completed",
      summary: "旧结果",
      startedAt: now(),
    });
    manager.migrateHistory();
    manager.migrateHistory();
    assert.equal(manager.list("work-feedback").length, 2);
    assert.equal(f.store.require("subagents", "legacy-legacy").legacy, true);
    assert.equal(
      f.store.require("subagents", "legacy-legacy").systemPrompt,
      "",
    );
  } finally {
    await f.cleanup();
  }
});

test("configured MCP uses real stdio protocol and exposes only assigned tools", async () => {
  const connected = await connectMcpTools(
    [
      {
        id: "test",
        name: "文字统计",
        command: process.execPath,
        args: [resolve("scripts/fixtures/mcp-test-server.mjs")],
        readOnlyTools: ["text_length"],
      },
    ],
    ["mcp_test__text_length"],
    () => {},
  );
  try {
    assert.deepEqual(
      connected.tools.map((t) => t.name),
      ["mcp_test__text_length"],
    );
    const result = await connected.tools[0]!.execute(
      "test",
      { text: "Orbit你好" },
      undefined,
      undefined,
      {} as ExtensionContext,
    );
    assert.deepEqual(result.content, [{ type: "text", text: "7" }]);
  } finally {
    await connected.close();
  }
});
