import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ConversationHandoff } from "../shared/types.ts";
import { OrbitStore, now } from "./store.ts";
import { OrbitRuntime } from "./runtime.ts";

async function harness() {
  const dir = await mkdtemp(join(tmpdir(), "orbit-matter-harness-"));
  const store = new OrbitStore(":memory:");
  const runtime = new OrbitRuntime(store, [], dir);
  runtime.pump = () => {};
  runtime.initialize({ seed: false });
  runtime.memory.schedule = async () => {};
  runtime.discussion.schedule = async () => {};
  runtime.deliveries.generate = async () => ({ spokenText: "先看一个例子，再继续理解这个概念。" });
  return { dir, store, runtime, main: runtime.assistant.getState().conversationId,
    async close() { await runtime.close(); store.close(); await rm(dir, { recursive: true, force: true }); } };
}
function active(conversationId: string, runId: string) {
  return { run: { id: runId, conversationId, parentId: null, title: "学习", status: "running" as const, startedAt: now(), summary: "" }, cancelled: false, pendingSteers: [] as string[], children: new Set<AgentSession>(), childSlots: 0, text: "" };
}

test("a handoff steering an active matter preserves one source and remains idempotent", async () => {
  const h = await harness();
  try {
    const matter = h.runtime.createConversation("理解 3D 表示");
    const source = h.store.addMessage(h.main, "user", "在这次学习里继续展开 SDF");
    const handoff: ConversationHandoff = { sourceConversationId: h.main, sourceMessageId: source.id, action: "resume" };
    const running = active(matter.id, "matter-already-running");
    h.store.put("runs", running.run);
    h.runtime.active.set(matter.id, running);
    const send = () => h.runtime.send(matter.id, source.content, undefined, undefined, undefined, undefined, { requestId: "steer-from-main", handoff });
    assert.equal(await send(), running.run.id);
    assert.equal(await send(), running.run.id);
    const messages = h.store.list("messages").filter(message => message.conversationId === matter.id && message.role === "user");
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0].handoff, handoff);
    assert.equal(running.pendingSteers.length, 1);
    assert.match(running.pendingSteers[0], /当前消息属于独立事项对话/);
    assert.match(running.pendingSteers[0], /聊天正文按需求充分说明/);
    assert.equal(h.store.pending().length, 0);
    const otherSource = h.store.addMessage(h.main, "user", source.content);
    await assert.rejects(h.runtime.send(matter.id, source.content, undefined, undefined, undefined, undefined, { requestId: "steer-from-main", handoff: { ...handoff, sourceMessageId: otherSource.id } }), /重新发送/);
    h.runtime.active.delete(matter.id);
  } finally { await h.close(); }
});

test("handoff provenance cannot mislabel unrelated or non-user history", async () => {
  const h = await harness();
  try {
    const matter = h.runtime.createConversation("理解 3D 表示");
    const source = h.store.addMessage(h.main, "user", "学习 3D 表示");
    const invalidSources = [
      { sourceConversationId: matter.id, sourceMessageId: source.id, content: source.content },
      { sourceConversationId: h.main, sourceMessageId: source.id, content: "另一个请求" },
      { sourceConversationId: h.main, sourceMessageId: h.store.addMessage(h.main, "assistant", source.content).id, content: source.content },
    ];
    for (const entry of invalidSources) await assert.rejects(h.runtime.send(matter.id, entry.content, undefined, undefined, undefined, undefined, { handoff: { sourceConversationId: entry.sourceConversationId, sourceMessageId: entry.sourceMessageId, action: "new" } }), /来源/);
    assert.equal(h.store.list("runs").length, 0);
    assert.equal(h.store.list("messages").filter(message => message.conversationId === matter.id).length, 0);
  } finally { await h.close(); }
});

test("existing matter sessions receive current scope and retain a full local explanation without creating artifacts", async () => {
  const h = await harness();
  try {
    const matter = h.runtime.createConversation("理解 3D 表示");
    h.store.addMessage(matter.id, "assistant", "先比较 Mesh 和 SDF，再讨论使用场景。");
    const oldFile = join(h.dir, "existing-learning-session.jsonl");
    h.store.setMetadata(`session:${matter.id}`, oldFile);
    h.store.setMetadata(`session:${matter.id}:memory-scope`, h.runtime.sessionMemoryState(matter.id).signature);
    let systemPrompt = "", turnPrompt = "", sessionFile: string | undefined;
    const answer = "SDF 是有符号距离函数。给它一个空间中的点，它返回到物体表面的距离。\n\n例如半径为 1 的球：球心处为 -1，表面为 0，球外则为正值。负号表示在内部，正号表示在外部。\n\n它保存的是查询空间的规则，所以与直接存储顶点和三角形的 Mesh 不同。";
    h.runtime.openSession = (async options => {
      systemPrompt = options.systemPrompt; sessionFile = options.sessionFile;
      let notify: (event: unknown) => void = () => {};
      return { session: { sessionManager: { getSessionFile: () => oldFile }, subscribe: (fn: (event: unknown) => void) => { notify = fn; }, prompt: async (prompt: string) => { turnPrompt = prompt; notify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: answer }] } }); }, dispose: () => {}, abort: async () => {} } };
    }) as OrbitRuntime["openSession"];
    const runId = await h.runtime.send(matter.id, "SDF 是啥", undefined, undefined, undefined, undefined, { requestId: "local-sdf-followup", forceNewRun: true });
    const caller = { ...active(matter.id, runId), run: h.store.require("runs", runId) };
    h.runtime.active.set(matter.id, caller);
    await h.runtime.execute(caller, h.store.pending().find(item => item.runId === runId)!);
    assert.equal(sessionFile, oldFile);
    assert.match(systemPrompt, /当前是一个独立事项对话/);
    assert.match(systemPrompt, /默认是纯文字协作/);
    assert.match(systemPrompt, /短概念追问通常200–400个中文字/);
    assert.match(systemPrompt, /不为比喻牺牲准确性/);
    assert.doesNotMatch(systemPrompt, /先用 workspace_list 查找已有讨论|详细分析用 save_report 保存|只用1–2句交代关键结论/);
    assert.match(turnPrompt, /当前消息属于独立事项对话/);
    assert.match(turnPrompt, /不重新路由、不先查找或创建事项/);
    assert.match(turnPrompt, /聊天正文按需求充分说明/);
    assert.match(turnPrompt, /短概念追问通常200–400个中文字/);
    assert.match(turnPrompt, /界面支持普通 Markdown，不支持 LaTeX/);
    assert.match(turnPrompt, /不默认追加/);
    assert.equal(h.store.require("runs", runId).status, "completed");
    assert.deepEqual(h.store.list("messages").filter(message => message.runId === runId && message.role === "assistant").map(message => ({ conversationId: message.conversationId, content: message.content })), [{ conversationId: matter.id, content: answer }]);
    assert.equal(h.store.list("messages").filter(message => message.conversationId === h.main).length, 0);
    assert.equal(h.store.list("artifacts").length, 0);
    assert.equal(h.store.list("works").length, 0);
  } finally { await h.close(); }
});

test("main reference answers keep their own scope and cannot gain matter-write tools", async () => {
  const h = await harness();
  try {
    const matter = h.runtime.createConversation("理解 3D 表示");
    h.runtime.assistant.workspace({ action: "open", conversationId: matter.id });
    const runId = await h.runtime.send(h.main, "这里的 SDF 是什么意思", undefined, undefined, undefined, undefined, { requestId: "main-sdf-reference", homeAnswer: true, forceNewRun: true });
    const caller = { ...active(h.main, runId), run: h.store.require("runs", runId) };
    const tools = h.runtime.hostTools(h.main, caller, () => undefined);
    for (const name of ["workspace_create", "workspace_continue", "workspace_fork", "save_report", "save_workspace_note", "append_conversation_note"])
      assert.equal(tools.some(tool => tool.name === name), false, name);
    assert.equal(h.store.list("messages").filter(message => message.conversationId === matter.id).length, 0);
    assert.equal(h.store.pending()[0].conversationId, h.main);
    const context = JSON.parse(h.runtime.contextSummary(h.main, undefined, runId).split("\n")[1]);
    assert.equal(context.conversationRole, "main");
  } finally { await h.close(); }
});


test("organized answers do not open a matter window even when an old model habit requests conversation delivery", async () => {
  const h = await harness();
  try {
    const matter = h.runtime.createConversation("理解 3D 表示");
    const source = h.store.addMessage(h.main, "user", "SDF 是啥");
    const presentation = h.runtime.deliveries.beginRequest("one-flow-delivery");
    const runId = await h.runtime.send(matter.id, source.content, undefined, undefined, undefined, undefined, {
      requestId: "one-flow-delivery", forceNewRun: true, presentation, allowConversationNavigation: false,
      handoff: { sourceConversationId: h.main, sourceMessageId: source.id, action: "resume" },
    });
    const current = h.runtime.assistant.getState().workspace;
    const caller = { ...active(matter.id, runId), run: h.store.require("runs", runId) };
    const tool = h.runtime.hostTools(matter.id, caller, () => undefined).find(tool => tool.name === "present_delivery")!;
    const response = await tool.execute("unnecessary-chat-window", { spokenText: "SDF 用到表面的距离描述物体。我们用一个球看它怎么表示内外。", target: { kind: "conversation", conversationId: matter.id } }, undefined, undefined, {} as never);
    const payload = JSON.parse((response.content[0] as { text: string }).text);
    assert.equal(payload.target, undefined);
    assert.equal(payload.presented, true);
    assert.equal(payload.conversationId, matter.id);
    assert.equal(h.runtime.assistant.getState().workspace.revision, current.revision);
    assert.equal(h.runtime.presentWorkspace(matter.id, { kind: "conversation" }, runId).presented, false);
    assert.equal(h.runtime.assistant.getState().workspace.revision, current.revision);
    // Independent visual artifacts can still be presented in a real workspace.
    const artifact = h.runtime.assistant.saveNote({ conversationId: matter.id, title: "示意图说明", content: "球心为负，表面为零。" }, { open: false });
    assert.equal(h.runtime.presentWorkspace(matter.id, { kind: "artifact", artifactId: artifact.id }, runId).presented, true);
  } finally { await h.close(); }
});

test("all visible assistant prose is persisted once even when tools accompany it, while thinking and tool results stay separate", async () => {
  const h = await harness();
  try {
    const matter = h.runtime.createConversation("理解 3D 表示");
    const explanation = "Mesh 用顶点和三角形描述球的表面。SDF 则保存一个函数：给定任意位置，返回到表面的有符号距离。\n\n半径为 1 的球可以写成 f(x,y,z) = sqrt(x*x+y*y+z*z)-1；球心为负，表面为零，球外为正。这个定义保存了查询空间的规则，而不是一层三角形。";
    const closing = "两者的关键区别是：Mesh 直接记录表面，SDF 通过距离函数描述表面及其内外。";
    let notify: (event: unknown) => void = () => {};
    let duringPresentation = -1;
    h.runtime.openSession = (async () => ({ session: {
      sessionManager: { getSessionFile: () => undefined },
      subscribe: (fn: (event: unknown) => void) => { notify = fn; },
      prompt: async () => {
        notify({ type: "message_end", message: { role: "assistant", content: [
          { type: "thinking", thinking: "PRIVATE_REASONING_MUST_NOT_PERSIST" },
          { type: "text", text: "先读取已有材料。" },
          { type: "toolCall", name: "workspace_read", id: "read", arguments: {} },
        ] } });
        notify({ type: "message_end", message: { role: "toolResult", content: [{ type: "text", text: "TOOL_RESULT_MUST_NOT_BECOME_PROSE" }] } });
        notify({ type: "message_end", message: { role: "assistant", content: [
          { type: "text", text: explanation },
          { type: "toolCall", name: "present_delivery", id: "speech", arguments: { spokenText: "两种方式分别存储表面和查询距离的规则。" } },
        ] } });
        duringPresentation = h.store.list("messages").filter(message => message.conversationId === matter.id && message.role === "assistant").length;
        notify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: closing }] } });
      }, dispose: () => {}, abort: async () => {},
    } })) as unknown as OrbitRuntime["openSession"];
    const runId = await h.runtime.send(matter.id, "用球的例子解释 Mesh 和 SDF", undefined, undefined, undefined, undefined, { requestId: "complete-visible-body", forceNewRun: true });
    const caller = { ...active(matter.id, runId), run: h.store.require("runs", runId) };
    h.runtime.active.set(matter.id, caller);
    await h.runtime.execute(caller, h.store.pending().find(item => item.runId === runId)!);
    assert.equal(duringPresentation, 0, "no partial canonical answer can hide the later cumulative stream");
    const messages = h.store.list("messages").filter(message => message.runId === runId && message.role === "assistant");
    assert.equal(messages.length, 1);
    assert.equal(messages[0].content, `先读取已有材料。\n\n${explanation}\n\n${closing}`);
    assert.doesNotMatch(messages[0].content, /PRIVATE_REASONING|TOOL_RESULT/);
    assert.equal(h.store.require("runs", runId).summary, messages[0].content.slice(0, 240));
    assert.equal(h.store.require("runs", runId).status, "completed");
  } finally { await h.close(); }
});

test("ordinary deep explanation has no file-writing capability and cannot navigate through visual delivery", async () => {
  const h = await harness();
  try {
    h.runtime.home.generate = async () => ({ action: "new", title: "理解 3D 表示", project: "学习", confidence: .99 });
    const response = await h.runtime.home.submit({ requestId: "deep-answer-no-file", content: "深入对比 Mesh 与 SDF，解释各自的优缺点" });
    const caller = { ...active(response.conversationId, response.runId), run: h.store.require("runs", response.runId) };
    const tools = h.runtime.hostTools(response.conversationId, caller, () => undefined);
    assert.equal(tools.some(tool => tool.name === "save_report" || tool.name === "save_workspace_note"), false);
    const artifact = h.runtime.assistant.saveNote({ conversationId: response.conversationId, title: "已有资料", content: "旧讲解" }, { open: false });
    const before = h.runtime.assistant.currentWorkspace();
    assert.equal(h.runtime.presentWorkspace(response.conversationId, { kind: "artifact", artifactId: artifact.id }, response.runId).presented, false);
    const spoken = await tools.find(tool => tool.name === "present_delivery")!.execute("speech-only", { spokenText: "Mesh 保存表面，SDF 用距离函数描述空间，我们通过球来比较。", target: { kind: "artifact", conversationId: response.conversationId, artifactId: artifact.id } }, undefined, undefined, {} as never);
    const delivery = JSON.parse((spoken.content[0] as { text: string }).text);
    assert.equal(delivery.target, undefined);
    assert.equal(delivery.presented, true);
    assert.deepEqual(h.runtime.assistant.currentWorkspace(), before);
  } finally { await h.close(); }
});

test("file intent and window intent are independent and do not leak into later turns", async () => {
  const h = await harness();
  try {
    h.runtime.home.generate = async () => ({ action: "new", title: "3D 学习笔记", project: "学习", confidence: .99, artifactRequested: true, visualRequested: false });
    const saved = await h.runtime.home.submit({ requestId: "save-only", content: "把这次比较保存成笔记，先不打开" });
    const caller = { ...active(saved.conversationId, saved.runId), run: h.store.require("runs", saved.runId) };
    const tools = h.runtime.hostTools(saved.conversationId, caller, () => undefined);
    const output = await tools.find(tool => tool.name === "save_report")!.execute("save", { title: "3D 比较笔记", content: "Mesh 记录表面，SDF 查询距离。" }, undefined, undefined, {} as never);
    const artifact = JSON.parse((output.content[0] as { text: string }).text);
    assert.equal(h.runtime.assistant.currentWorkspace().tabs.length, 0);
    assert.equal(h.store.require("artifacts", artifact.id).content, "Mesh 记录表面，SDF 查询距离。");
    assert.equal(h.runtime.presentWorkspace(saved.conversationId, { kind: "artifact", artifactId: artifact.id }, saved.runId).presented, false);
    h.runtime.home.generate = async () => ({ action: "answer", visualRequested: true, relatedSource: { conversationId: saved.conversationId, artifactId: artifact.id, confidence: .99, openRequested: true } });
    const opened = await h.runtime.home.submit({ requestId: "explicit-open", content: "现在把刚才的笔记打开" });
    assert.equal(h.runtime.assistant.currentWorkspace().tabs.at(-1)?.artifactId, artifact.id);
    h.runtime.assistant.workspace({ action: "clear" });
    assert.equal(h.runtime.presentWorkspace(saved.conversationId, { kind: "artifact", artifactId: artifact.id }, opened.runId).presented, false, "manual close still revokes navigation");
    h.runtime.home.generate = async () => ({ action: "resume", conversationId: saved.conversationId, confidence: .99 });
    const followup = await h.runtime.home.submit({ requestId: "explain-after-file", content: "为什么 SDF 的负数表示内部？" });
    const followupTools = h.runtime.hostTools(followup.conversationId, { ...active(followup.conversationId, followup.runId), run: h.store.require("runs", followup.runId) }, () => undefined);
    assert.equal(followupTools.some(tool => tool.name === "save_report"), false);
    assert.equal(h.runtime.presentWorkspace(saved.conversationId, { kind: "artifact", artifactId: artifact.id }, followup.runId).presented, false);
  } finally { await h.close(); }
});

test("canonical answers reference only this run's real files and preserve saved results if later execution fails", async () => {
  for (const fail of [false, true]) {
    const h = await harness();
    try {
      const matter = h.runtime.createConversation("学习笔记");
      const unrelated = h.runtime.assistant.saveNote({ conversationId: matter.id, title: "另一轮文件", content: "不能挂到本轮" }, { open: false });
      let notify: (event: unknown) => void = () => {};
      h.runtime.openSession = (async (options: Parameters<OrbitRuntime["openSession"]>[0]) => ({ session: {
        sessionManager: { getSessionFile: () => undefined },
        subscribe: (fn: (event: unknown) => void) => { notify = fn; },
        prompt: async () => {
          const save = options.tools.find(tool => tool.name === "save_report")!;
          const response = await save.execute("save-source", { title: "本轮笔记", content: "真实保存的说明" }, undefined, undefined, {} as never);
          const artifact = JSON.parse((response.content[0] as { text: string }).text);
          await save.execute("update-source", { artifactId: artifact.id, title: "本轮笔记", content: "真实更新的说明" }, undefined, undefined, {} as never);
          assert.equal(h.runtime.assistant.currentWorkspace().tabs.length, 0);
          if (fail) throw new Error("test model stopped after save");
          notify({ type: "message_end", message: { role: "assistant", content: [
            { type: "text", text: "完整分析在这里，笔记保留为可回访文件。" },
            { type: "toolCall", name: "save_report", id: "record", arguments: {} },
          ] } });
          notify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "可以继续讨论。" }] } });
        }, dispose: () => {}, abort: async () => {},
      } })) as unknown as OrbitRuntime["openSession"];
      const runId = await h.runtime.send(matter.id, "保存笔记，先不打开", undefined, undefined, undefined, undefined, { forceNewRun: true, allowArtifactCreation: true, allowVisualNavigation: false });
      const caller = { ...active(matter.id, runId), run: h.store.require("runs", runId) };
      h.runtime.active.set(matter.id, caller);
      await h.runtime.execute(caller, h.store.pending().find(item => item.runId === runId)!);
      const messages = h.store.list("messages").filter(message => message.runId === runId && message.role === "assistant");
      assert.equal(messages.length, 1);
      const saved = h.store.list("artifacts").find(artifact => artifact.title === "本轮笔记")!;
      assert.deepEqual(messages[0].artifactIds, [saved.id]);
      assert.equal(messages[0].artifactIds?.includes(unrelated.id), false);
      assert.equal(saved.content, "真实更新的说明");
      assert.equal(h.store.require("runs", runId).status, fail ? "failed" : "completed");
      assert.equal(messages[0].content, fail ? "本轮未完成，已保存的文件仍可查看。" : "完整分析在这里，笔记保留为可回访文件。\n\n可以继续讨论。");
      assert.equal(h.runtime.assistant.currentWorkspace().tabs.length, 0);
    } finally { await h.close(); }
  }
});

test("context source tool uses actual read evidence and survives run completion without navigation", async () => {
  const h = await harness();
  try {
    const knowledge = h.runtime.createConversation("GPU 与带宽");
    const message = h.store.addMessage(knowledge.id, "assistant", "应用性能还取决于数据供给，真实瓶颈需要测量。");
    const caller = active(h.main, "source-card-run");
    h.store.put("runs", caller.run);
    h.store.setMetadata(`delivery:${caller.run.id}`, {homeAnswer:true});
    const tools = h.runtime.hostTools(h.main, caller, () => undefined);
    const choose = tools.find(tool => tool.name === "use_context")!;
    const read = tools.find(tool => tool.name === "workspace_read")!;
    assert.ok(choose, "main answers may select context without write tools");
    const input = {sources:[{conversationId:knowledge.id,messageId:message.id,kind:"knowledge",reason:"用于分析多窗口性能的可能限制。"}]};
    await assert.rejects(choose.execute("before-read",input,undefined,undefined,{} as never), /先读取/);
    const revision = h.runtime.assistant.getState().workspace.revision;
    await read.execute("read-source",{conversationId:knowledge.id},undefined,undefined,{} as never);
    await choose.execute("choose-source",input,undefined,undefined,{} as never);
    h.store.put("runs", {...caller.run,status:"completed"});
    assert.equal(h.store.require("runs",caller.run.id).contextSources?.[0].messageId,message.id);
    assert.equal(h.runtime.assistant.getState().workspace.revision,revision);
    assert.equal(h.store.list("messages").filter(m=>m.conversationId===knowledge.id).length,1);
  } finally { await h.close(); }
});
