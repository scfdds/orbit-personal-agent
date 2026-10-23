import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { OrbitStore, now } from "./store.ts";
import { OrbitRuntime } from "./runtime.ts";
import { AssistantHomeService } from "./assistant-home.ts";
import { createOrbitServer, startServer } from "./http.ts";
import { loadApps } from "../apps/registry.ts";
import { safeErrorMessage } from "./model-config.ts";

async function harness() {
  const dir = await mkdtemp(join(tmpdir(), "orbit-desktop-test-"));
  const store = new OrbitStore(":memory:");
  const runtime = new OrbitRuntime(store, await loadApps({ installedOnly: true }), dir);
  runtime.pump = () => {};
  runtime.initialize({ seed: false });
  runtime.home.generate = async () => ({ action: "answer", reason: "在这里回答" });
  const first = runtime.createConversation("客户方案");
  const source = store.addMessage(first.id, "user", "只在客户事项中的背景 CLIENT_ONLY_7481");
  const second = runtime.createConversation("杭州旅行");
  store.addMessage(second.id, "assistant", "旅行停在选择日期 TRAVEL_ONLY_2481");
  return { dir, store, runtime, first, second, source,
    async close() { await runtime.close(); store.close(); await rm(dir, { recursive: true, force: true }); } };
}
function active(conversationId: string, runId: string) {
  return { run: { id: runId, conversationId, parentId: null, title: "request", status: "running" as const, startedAt: now(), summary: "" }, cancelled: false, pendingSteers: [], children: new Set<AgentSession>(), childSlots: 0, text: "" };
}

test("home recall remains global; actual resume executes in the target with one durable handoff", async () => {
  const h = await harness();
  try {
    const main = h.runtime.assistant.getState().conversationId;
    h.runtime.assistant.workspace({ action: "open", conversationId: h.second.id });
    h.runtime.home.generate = async input => {
      const data = JSON.parse(input);
      assert.equal(data.explicitReference, undefined);
      assert.equal(data.conversations.some((c: {id: string}) => c.id === main), false);
      return { action: "answer", reason: "仅回顾进展" };
    };
    const recall = await h.runtime.home.submit({ requestId: "recall", content: "客户方案上次讨论到哪里了？" });
    assert.equal(recall.action, "answer"); assert.equal(recall.conversationId, main);
    assert.equal(h.store.pending()[0].conversationId, main);
    assert.doesNotMatch(h.store.pending()[0].prompt, /TRAVEL_ONLY/);
    assert.equal(h.store.list("messages").filter(m => m.conversationId === h.first.id).length, 1);
    let decisions = 0;
    h.runtime.home.generate = async () => { decisions++; return { action: "resume", conversationId: h.first.id, confidence: .98, reason: "明确继续客户方案" }; };
    const request = { requestId: "resume", content: "继续完善客户方案，补全实施步骤" };
    const [a, b] = await Promise.all([h.runtime.home.submit(request), h.runtime.home.submit(request)]);
    assert.deepEqual(a, b); assert.equal(decisions, 1); assert.equal(a.conversationId, h.first.id);
    assert.equal(h.store.pending().filter(p => p.conversationId === h.first.id).length, 1);
    assert.equal(h.store.list("messages").filter(m => m.kind === "conversation_link" && m.linkedConversationId === h.first.id).length, 1);
    assert.equal(h.store.list("messages").filter(m => m.conversationId === main && m.content === request.content).length, 1);
    const source = h.store.list("messages").find(m => m.conversationId === main && m.content === request.content)!;
    const forwarded = h.store.list("messages").filter(m => m.conversationId === h.first.id && m.content === request.content);
    assert.equal(forwarded.length, 1);
    assert.deepEqual(forwarded[0].handoff, { sourceConversationId: main, sourceMessageId: source.id, action: "resume" });
    const recovered = new AssistantHomeService(h.runtime);
    recovered.generate = async () => { throw new Error("must not reroute"); };
    assert.deepEqual(await recovered.submit(request), a);
    await assert.rejects(recovered.submit({ ...request, content: "different" }), /重新发送/);
    await recovered.close();
  } finally { await h.close(); }
});

test("a visible learning matter is reference context for a main question, not an implicit execution target", async () => {
  const h = await harness();
  try {
    const main = h.runtime.assistant.getState().conversationId;
    const learning = h.runtime.createConversation("理解 3D 表示");
    const explanation = h.store.addMessage(learning.id, "assistant", "SDF_LEARNING_SOURCE：有符号距离用于描述点与表面的关系。");
    const count = h.store.list("conversations").length;
    h.runtime.assistant.workspace({ action: "open", conversationId: learning.id });
    h.runtime.home.generate = async input => {
      const request = JSON.parse(input);
      assert.equal(request.request, "这里的 SDF 是啥？");
      assert.equal(request.visibleContext.conversation.id, learning.id);
      assert.equal(request.visibleContext.message, undefined);
      return { action: "answer", useVisibleContext: true, reason: "在主对话中解释可见内容" };
    };
    const result = await h.runtime.home.submit({ requestId: "main-sdf", content: "这里的 SDF 是啥？", visibleContext: { conversationId: learning.id } });
    assert.equal(result.action, "answer");
    assert.equal(result.conversationId, main);
    assert.match(h.store.pending().find(p => p.runId === result.runId)!.prompt, /SDF_LEARNING_SOURCE/);
    const delivery = h.store.metadata<{ prefetchedContext?: { messages: Array<{ id: string; content: string }>; previewTarget?: unknown } }>(`delivery:${result.runId}`)!;
    assert.equal(delivery.prefetchedContext?.messages.some(m => m.id === explanation.id && m.content.includes("SDF_LEARNING_SOURCE")), true);
    assert.equal(delivery.prefetchedContext?.previewTarget, undefined);
    assert.equal(h.store.list("messages").filter(m => m.conversationId === learning.id).length, 1);
    assert.equal(h.store.list("messages").filter(m => m.conversationId === main && m.role === "user").length, 1);
    assert.equal(h.store.list("messages").some(m => m.handoff), false);
    assert.equal(h.store.list("conversations").length, count);
    assert.equal(h.store.list("artifacts").length, 0);
    assert.equal(h.store.list("works").length, 0);
    const tools = h.runtime.hostTools(main, active(main, result.runId), () => undefined);
    assert.equal(tools.some(t => t.name === "workspace_continue" || t.name === "save_workspace_note" || t.name === "create_work"), false);

    // An explicit reference to another matter wins; do not silently add the visible matter too.
    h.runtime.home.generate = async () => ({ action: "answer", useVisibleContext: true });
    const explicit = await h.runtime.home.submit({ requestId: "main-explicit", content: "解释这条原文", context: { conversationId: h.first.id, messageId: h.source.id }, visibleContext: { conversationId: learning.id } });
    const explicitPrompt = h.store.pending().find(p => p.runId === explicit.runId)!.prompt;
    assert.match(explicitPrompt, /CLIENT_ONLY_7481/);
    assert.doesNotMatch(explicitPrompt, /SDF_LEARNING_SOURCE/);

    h.runtime.home.generate = async () => ({ action: "answer", useVisibleContext: false });
    const unrelated = await h.runtime.home.submit({ requestId: "main-unrelated", content: "讲个笑话", visibleContext: { conversationId: learning.id, messageId: explanation.id } });
    assert.doesNotMatch(h.store.pending().find(p => p.runId === unrelated.runId)!.prompt, /SDF_LEARNING_SOURCE/);
  } finally { await h.close(); }
});

test("one-flow routing reads canonical replies and carries semantic followups without making the visible pane the owner", async () => {
  const h = await harness();
  try {
    const main = h.runtime.assistant.getState().conversationId;
    h.runtime.home.generate = async () => ({ action: "new", title: "理解 3D 表示", project: "学习与研究", confidence: .99 });
    const first = await h.runtime.home.submit({ requestId: "one-flow-learn", content: "逐步比较 Mesh 和 SDF，让我理解 3D 表示" });
    const learned = h.store.addMessage(first.conversationId, "assistant", "CANONICAL_3D_ANSWER：Mesh 保存三角形表面；SDF 返回空间中的点到表面的有符号距离。", first.runId);
    // A later local turn must not leak into the earlier projected run.
    h.store.addMessage(first.conversationId, "assistant", "LOCAL_UNRELATED_ANSWER", "a-separate-local-run");
    const revision = h.runtime.assistant.getState().workspace.revision;
    h.runtime.home.generate = async input => {
      const context = JSON.parse(input);
      assert.equal(context.recentDiscussion.conversationId, first.conversationId);
      assert.equal(context.recentDiscussion.request, "逐步比较 Mesh 和 SDF，让我理解 3D 表示");
      assert.equal(context.recentHome.some((message: { id: string; content: string }) => message.id === learned.id && message.content.includes("CANONICAL_3D_ANSWER")), true);
      assert.equal(context.recentHome.some((message: { content: string }) => message.content.includes("LOCAL_UNRELATED_ANSWER")), false);
      assert.equal(context.visibleContext.conversation.id, h.second.id);
      return { action: "resume", conversationId: first.conversationId, confidence: .98, reason: "自然追问刚刚的SDF解释", useVisibleContext: false };
    };
    const followup = await h.runtime.home.submit({ requestId: "one-flow-sdf", content: "SDF 是啥，举个例子", visibleContext: { conversationId: h.second.id } });
    assert.equal(followup.conversationId, first.conversationId);
    assert.equal(followup.action, "resume");
    const carriedPrompt = h.store.pending().find(item => item.runId === followup.runId)!.prompt;
    assert.match(carriedPrompt, /CANONICAL_3D_ANSWER/);
    assert.doesNotMatch(carriedPrompt, /LOCAL_UNRELATED_ANSWER/);
    const target = h.store.list("messages").find(message => message.runId === followup.runId && message.role === "user")!;
    assert.equal(target.handoff?.sourceConversationId, main);
    assert.equal(h.store.require("messages", target.handoff!.sourceMessageId).content, "SDF 是啥，举个例子");
    assert.doesNotMatch(h.store.pending().find(pending => pending.runId === followup.runId)!.prompt, /TRAVEL_ONLY/);
    assert.equal(h.runtime.assistant.getState().workspace.revision, revision);
    assert.equal(h.store.metadata<{ allowConversationNavigation: boolean }>(`delivery:${followup.runId}`)?.allowConversationNavigation, false);
    h.store.addMessage(first.conversationId, "assistant", "SDF_FOLLOWUP_ANSWER：例如单位球，球心为负，表面为零。", followup.runId);

    h.runtime.home.generate = async () => ({ action: "answer", reason: "独立小问题", useVisibleContext: false });
    const aside = await h.runtime.home.submit({ requestId: "one-flow-aside", content: "法国首都是哪里" });
    h.store.addMessage(main, "assistant", "法国首都是巴黎。", aside.runId);
    h.runtime.home.generate = async input => {
      const context = JSON.parse(input);
      assert.equal(context.recentDiscussion, null, "an unrelated latest main turn must clear the implicit prior matter");
      assert.equal(context.recentHome.at(-1).content, "法国首都是巴黎。");
      assert.equal(context.recentHome.some((message: { content: string }) => message.content.includes("SDF_FOLLOWUP_ANSWER")), true);
      return { action: "answer", reason: "沿用最近首都问题，不是旧学习", useVisibleContext: false };
    };
    const asideFollowup = await h.runtime.home.submit({ requestId: "one-flow-aside-followup", content: "为什么是它", visibleContext: { conversationId: first.conversationId } });
    assert.equal(asideFollowup.conversationId, main);
    assert.equal(h.store.list("messages").some(message => message.conversationId === first.conversationId && message.content === "为什么是它"), false);

    // Explicit return can still find the matter through real canonical history.
    h.runtime.home.generate = async input => {
      const context = JSON.parse(input);
      assert.equal(context.recentDiscussion, null);
      assert.equal(context.conversations.some((candidate: { id: string }) => candidate.id === first.conversationId), true);
      return { action: "resume", conversationId: first.conversationId, confidence: .99, reason: "明确回到3D" };
    };
    const back = await h.runtime.home.submit({ requestId: "one-flow-return", content: "回到刚才的 3D，比较 SDF 和 Mesh" });
    assert.equal(back.conversationId, first.conversationId);
    assert.equal(h.runtime.assistant.getState().workspace.revision, revision);
    assert.equal(h.store.list("conversations").filter(conversation => conversation.title === "理解 3D 表示").length, 1);
  } finally { await h.close(); }
});

test("routing history is bounded and uses the latest request ownership rather than a late reply", async () => {
  const h = await harness();
  try {
    const main = h.runtime.assistant.getState().conversationId;
    h.runtime.home.generate = async () => ({ action: "resume", conversationId: h.first.id, confidence: .99 });
    const old = await h.runtime.home.submit({ requestId: "late-original", content: "把客户方案补全" });
    h.runtime.home.generate = async () => ({ action: "answer" });
    for (let index = 0; index < 8; index++) {
      const turn = await h.runtime.home.submit({ requestId: `bounded-${index}`, content: `独立闲聊 ${index}` });
      h.store.addMessage(main, "assistant", `当轮答复 ${index} ${"字".repeat(1800)}`, turn.runId);
    }
    h.store.addMessage(h.first.id, "assistant", "LATE_CUSTOMER_COMPLETION", old.runId);
    h.runtime.home.generate = async input => {
      const context = JSON.parse(input);
      assert.equal(context.recentDiscussion, null);
      assert.equal(context.recentHome.length, 12);
      assert.equal(context.recentHome.some((message: { content: string }) => message.content.includes("LATE_CUSTOMER_COMPLETION")), false);
      assert.equal(context.recentHome.every((message: { content: string }) => message.content.length <= 1600), true);
      assert.equal(context.recentHome.at(-1).contentTruncated, true);
      return { action: "answer" };
    };
    await h.runtime.home.submit({ requestId: "bounded-check", content: "再说说" });
  } finally { await h.close(); }
});

test("a new learning handoff keeps its durable origin across a post-dispatch retry and creates no plan or artifact", async () => {
  const h = await harness();
  try {
    const main = h.runtime.assistant.getState().conversationId;
    const introduction = "我们先用同一个物体，对比几种表示方式，再逐步展开。";
    h.runtime.home.generate = async () => ({ action: "new", title: "理解 3D 表示", project: "学习与研究", confidence: .97, introduction, reason: "独立学习任务" });
    const request = { requestId: "learning-once", content: "我要深入学习 3D 表示，对比几种方式，帮我逐步理解" };
    const actualSend = h.runtime.send.bind(h.runtime);
    let failAfterDispatch = true;
    h.runtime.send = async (...args) => {
      const runId = await actualSend(...args);
      if (failAfterDispatch) { failAfterDispatch = false; throw new Error("simulated interruption after durable queue"); }
      return runId;
    };
    await assert.rejects(h.runtime.home.submit(request), /simulated interruption/);
    const beforeRetry = h.store.list("messages").find(m => m.handoff)!;
    assert.ok(beforeRetry);
    h.runtime.home.generate = async () => { throw new Error("must not reroute a durable handoff"); };
    const recovered = new AssistantHomeService(h.runtime);
    recovered.generate = h.runtime.home.generate;
    const result = await recovered.submit(request);
    assert.equal(result.action, "new");
    assert.equal(h.store.require("conversations", result.conversationId).title, "理解 3D 表示");
    const sources = h.store.list("messages").filter(m => m.conversationId === main && m.role === "user" && m.content === request.content);
    const forwarded = h.store.list("messages").filter(m => m.conversationId === result.conversationId && m.role === "user");
    assert.equal(sources.length, 1); assert.equal(forwarded.length, 1);
    assert.equal(forwarded[0].id, beforeRetry.id);
    assert.deepEqual(forwarded[0].handoff, { sourceConversationId: main, sourceMessageId: sources[0].id, action: "new" });
    const links = h.store.list("messages").filter(m => m.kind === "conversation_link" && m.linkedConversationId === result.conversationId);
    assert.equal(links.length, 1); assert.equal(links[0].content, "已整理至「理解 3D 表示」");
    assert.equal(h.store.pending().filter(p => p.conversationId === result.conversationId).length, 1);
    assert.equal(h.store.list("runs").length, 1);
    assert.equal(h.store.list("works").length, 0);
    assert.equal(h.store.list("artifacts").length, 0);
    assert.deepEqual(await recovered.submit(request), result);
    await recovered.close();
  } finally { await h.close(); }
});

test("uncertain, unavailable or changed home decisions never create or modify old matters", async () => {
  const h = await harness();
  try {
    const count = h.store.list("conversations").length;
    for (const [i, decision] of [null, {action:"resume",conversationId:h.first.id,confidence:.1}, {action:"resume",conversationId:"not-real",confidence:1}, {action:"new",title:"不确定",confidence:.2}].entries()) {
      h.runtime.home.generate = async () => decision;
      const result = await h.runtime.home.submit({ requestId: `uncertain-${i}`, content: "继续上次那个" });
      assert.equal(result.action, "answer"); assert.equal(result.fallback, true);
    }
    h.runtime.home.generate = async () => { throw new Error("offline"); };
    assert.equal((await h.runtime.home.submit({requestId:"offline",content:"那个方案"})).action, "answer");
    h.runtime.home.generate = async () => { h.store.updateConversation(h.first.id,{archived:true}); return {action:"resume",conversationId:h.first.id,confidence:1}; };
    assert.equal((await h.runtime.home.submit({requestId:"archived",content:"继续客户方案"})).action, "answer");
    assert.equal(h.store.list("conversations").length, count);
    assert.equal(h.store.list("messages").filter(m => m.conversationId === h.first.id).length, 1);
    assert.equal(h.store.list("artifacts").length, 0);
  } finally { await h.close(); }
});

test("a just-read historical source remains resumable beyond the recent catalog page", async () => {
  const h = await harness();
  try {
    h.store.put("conversations", { ...h.first, updatedAt: "2000-01-01T00:00:00.000Z" });
    for(let i=0;i<65;i++) h.store.createConversation(`较新的事项 ${i}`);
    assert.equal(h.runtime.router.catalog().some(c=>c.id===h.first.id),false);
    const main=h.runtime.assistant.getState().conversationId;
    const link=h.store.addMessage(main,"system","找到客户旧方案");
    h.store.put("messages",{...link,kind:"conversation_link",linkedConversationId:h.first.id});
    h.runtime.home.generate=async input=>{
      assert.equal(JSON.parse(input).conversations.some((c:{id:string})=>c.id===h.first.id),true);
      return {action:"resume",conversationId:h.first.id,confidence:.98};
    };
    const result=await h.runtime.home.submit({requestId:"old-resume",content:"继续处理刚找到的客户方案"});
    assert.equal(result.action,"resume");assert.equal(result.conversationId,h.first.id);
  } finally {await h.close();}
});

test("explicit new work is created once; direct thread submissions never reroute or implicitly steer", async () => {
  const h = await harness();
  try {
    h.runtime.home.generate = async () => ({ action: "new", title: "准备演讲", project: "工作", confidence: .96 });
    const request = { requestId: "new-work", content: "帮我制定一个演讲准备计划" };
    const result = await h.runtime.home.submit(request);
    assert.equal(result.action, "new"); assert.equal(h.store.require("conversations", result.conversationId).title, "准备演讲");
    await h.runtime.home.submit(request);
    assert.equal(h.store.list("conversations").filter(c => c.title === "准备演讲").length, 1);
    h.runtime.active.set(h.second.id, active(h.second.id, "old-running"));
    h.runtime.home.generate = async () => { throw new Error("direct message must not route"); };
    const direct = { requestId: "direct", conversationId: h.second.id, content: "调整旅行日期" };
    const [a,b] = await Promise.all([h.runtime.home.sendTo(direct), h.runtime.home.sendTo(direct)]);
    assert.deepEqual(a,b); assert.notEqual(a.runId, "old-running");
    assert.equal(h.runtime.active.get(h.second.id)?.pendingSteers.length, 0);
    assert.equal(h.store.pending().filter(p => p.conversationId === h.second.id).length, 1);
    h.runtime.active.delete(h.second.id);
  } finally { await h.close(); }
});

test("reference snapshots are explicit, owned, frozen across retries and absent from the next request", async () => {
  const h = await harness();
  try {
    const artifact = h.store.put("artifacts", {id:"selected",conversationId:h.first.id,title:"选择的方案",content:"VERSION_ONE",format:"markdown",updatedAt:now()});
    h.store.put("artifacts", {id:"other",conversationId:h.first.id,title:"另一份方案",content:"OTHER_ARTIFACT",format:"markdown",updatedAt:now()});
    const request = {requestId:"snapshot",content:"解释这份",context:{conversationId:h.first.id,artifactId:artifact.id}};
    const result = await h.runtime.home.submit(request);
    const prompt = h.store.pending().find(p => p.runId === result.runId)!.prompt;
    assert.match(prompt,/VERSION_ONE/); assert.doesNotMatch(prompt,/OTHER_ARTIFACT/);
    h.store.put("artifacts",{...artifact,content:"VERSION_TWO"});
    assert.deepEqual(await h.runtime.home.submit(request),result);
    assert.equal(h.store.pending().find(p=>p.runId===result.runId)!.prompt,prompt);
    const next = await h.runtime.home.submit({requestId:"no-ref",content:"说个笑话"});
    assert.doesNotMatch(h.store.pending().find(p=>p.runId===next.runId)!.prompt,/VERSION_ONE|VERSION_TWO|OTHER_ARTIFACT/);
    const before = h.store.list("runs").length;
    await assert.rejects(h.runtime.home.submit({...request,requestId:"invalid",context:{conversationId:h.second.id,artifactId:artifact.id}}),/不属于/);
    assert.equal(h.store.list("runs").length,before);
  } finally { await h.close(); }
});

test("home recall tools cannot mutate business data; reading creates a source receipt without dispatch", async () => {
  const h = await harness();
  try {
    const response = await h.runtime.home.submit({requestId:"readonly",content:"回顾旅行计划"});
    const tools = h.runtime.hostTools(response.conversationId, active(response.conversationId,response.runId),()=>undefined);
    for (const name of ["workspace_continue","workspace_create","workspace_fork","save_report","save_workspace_note","append_conversation_note","create_work"])
      assert.equal(tools.some(t=>t.name===name),false,name);
    await tools.find(t=>t.name==="workspace_read")!.execute("read",{conversationId:h.second.id},undefined,undefined,{} as ExtensionContext);
    assert.equal(h.store.list("messages").filter(m=>m.kind==="conversation_link"&&m.linkedConversationId===h.second.id).length,1);
    assert.equal(h.store.list("runs").length,1);
    const object = h.store.list("objects").find(o=>o.conversationId===h.first.id&&o.appId==="career")!;
    const appTools = h.runtime.executionAppTools(response.conversationId,response.runId,()=>{});
    assert.equal(appTools.some(t=>t.name==="career_update_resume"),false);
    assert.throws(()=>h.runtime.appContext(h.first.id,true).saveObject({...object,expectedVersion:object.version,data:{resume:"SHOULD_NOT_WRITE"}}),/读取权限/);
    assert.equal(h.store.require("objects",object.id).version,object.version);
  } finally { await h.close(); }
});

test("late presentation cannot reopen a manually closed workspace and never prevents saving", async () => {
  const h = await harness();
  try {
    const response = await h.runtime.home.sendTo({requestId:"foreground",conversationId:h.first.id,content:"生成方案"});
    const opened = h.runtime.presentWorkspace(h.first.id,{kind:"conversation"},response.runId);
    assert.equal(opened.presented,true);
    assert.deepEqual(h.runtime.assistant.getState().presentation,{runId:response.runId,conversationId:h.first.id,revision:opened.revision});
    h.runtime.assistant.workspace({action:"clear"});
    assert.equal(h.runtime.assistant.getState().presentation,undefined);
    assert.equal(h.runtime.presentWorkspace(h.first.id,{kind:"conversation"},response.runId).presented,false);
    assert.equal(h.runtime.assistant.getState().presentation,undefined);
    const artifact = h.runtime.assistant.saveNote({conversationId:h.first.id,title:"后台成果",content:"已保存"},{open:false});
    assert.equal(h.runtime.presentWorkspace(h.first.id,{kind:"artifact",artifactId:artifact.id},response.runId).presented,false);
    assert.ok(h.store.get("artifacts",artifact.id)); assert.equal(h.runtime.assistant.getState().workspace.tabs.length,0);
    const newer = await h.runtime.home.sendTo({requestId:"new-foreground",conversationId:h.second.id,content:"旅行"});
    assert.equal(h.runtime.presentWorkspace(h.second.id,{kind:"conversation"},newer.runId).presented,true);
    assert.equal(h.runtime.presentWorkspace(h.first.id,{kind:"conversation"},response.runId).presented,false);
    assert.equal(h.runtime.assistant.getState().presentation?.runId,newer.runId);
    const referenced=h.runtime.presentWorkspace(h.first.id,{kind:"conversation"},newer.runId);
    assert.deepEqual(h.runtime.assistant.getState().presentation,{runId:newer.runId,conversationId:h.second.id,revision:referenced.revision});
    h.runtime.assistant.workspace({action:"activate",tabId:`conversation:${h.second.id}`});
    assert.equal(h.runtime.assistant.getState().presentation,undefined);
  } finally { await h.close(); }
});

test("overview uses stored sources and omits the main conversation and empty drafts", async () => {
  const h = await harness();
  try {
    const empty = h.runtime.createConversation("空白草稿");
    h.store.updateConversation(h.first.id,{summary:"真实客户进度",unread:true});
    h.store.put("runs",{...active(h.first.id,"latest").run,status:"failed",summary:"真实执行失败",finishedAt:now()});
    h.store.put("artifacts",{id:"overview-result",conversationId:h.first.id,title:"客户成果",content:"真实内容",format:"markdown",updatedAt:now()});
    const overview=h.runtime.home.overview();
    assert.equal(overview.items.some(i=>i.conversationId===empty.id||h.runtime.assistant.isMain(i.conversationId)),false);
    const first=overview.items.find(i=>i.conversationId===h.first.id)!;
    assert.equal(first.summary,"真实客户进度");assert.equal(first.lastRun?.summary,"真实执行失败");assert.equal(first.artifacts[0].id,"overview-result");
  } finally { await h.close(); }
});

test("separate matters open independent Pi session paths with only their own host background", async () => {
  const h = await harness();
  try {
    const calls: Array<{dataDir:string;sessionFile?:string;prompt:string}> = [];
    h.runtime.memory.schedule = async () => {};
    h.runtime.discussion.schedule = async () => {};
    h.runtime.openSession = (async options => {
      const call = {dataDir:options.dataDir,sessionFile:options.sessionFile,prompt:""}; calls.push(call);
      let notify: (event: unknown)=>void = ()=>{};
      return { session: { sessionManager:{getSessionFile:()=>join(options.dataDir,"mock-session.jsonl")}, subscribe:(fn:(event:unknown)=>void)=>{notify=fn;}, prompt:async (prompt:string)=>{call.prompt=prompt;notify({type:"message_end",message:{role:"assistant",content:[{type:"text",text:"完成"}]}});}, dispose:()=>{}, abort:async()=>{} } };
    }) as OrbitRuntime["openSession"];
    for (const [i,c] of [h.first,h.second].entries()) {
      const response=await h.runtime.home.sendTo({requestId:`isolated-${i}`,conversationId:c.id,content:"继续本事项"});
      const run=h.store.require("runs",response.runId), pending=h.store.pending().find(p=>p.runId===response.runId)!;
      await h.runtime.execute({...active(c.id,run.id),run},pending);
    }
    assert.notEqual(calls[0].dataDir,calls[1].dataDir);
    assert.match(calls[0].dataDir,new RegExp(h.first.id)); assert.match(calls[1].dataDir,new RegExp(h.second.id));
    assert.doesNotMatch(calls[0].prompt,/TRAVEL_ONLY/);assert.doesNotMatch(calls[1].prompt,/CLIENT_ONLY/);
    assert.notEqual(h.store.metadata(`session:${h.first.id}`),h.store.metadata(`session:${h.second.id}`));
  } finally { await h.close(); }
});

test("desktop boot uses a random loopback port, an empty durable directory, authenticated settings and explicit examples", async () => {
  const dir=await mkdtemp(join(tmpdir(),"orbit-desktop-boot-"));
  const names=["ORBIT_DESKTOP","ORBIT_AUTH_TOKEN","ORBIT_PORT","ORBIT_DATA_DIR","ORBIT_CONFIG_PATH","ORBIT_MCP_CONFIG"] as const;
  const old=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  const token="test-only-auth-token-748193", key="test-only-model-key-564193";
  Object.assign(process.env,{ORBIT_DESKTOP:"1",ORBIT_AUTH_TOKEN:token,ORBIT_PORT:"0",ORBIT_DATA_DIR:dir,ORBIT_CONFIG_PATH:join(dir,"settings.json"),ORBIT_MCP_CONFIG:join(dir,"missing-mcp.json")});
  let running: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    running=await startServer();
    const address=running.server.address();assert.ok(address&&typeof address!=="string");assert.ok(address.port>0);assert.equal(address.address,"127.0.0.1");
    assert.equal(running.runtime.store.list("conversations").length,1);assert.equal(running.runtime.store.list("runs").length,0);
    assert.equal(running.runtime.dataDir,dir);assert.ok((await stat(join(dir,"orbit.sqlite"))).isFile());
    const base=`http://127.0.0.1:${address.port}`;
    const request=(path:string,method="GET",data?:unknown,headers:Record<string,string>={})=>fetch(base+path,{method,headers:{"content-type":"application/json","x-orbit-token":token,...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});
    assert.equal((await fetch(base+"/api/state")).status,401);
    assert.equal((await request("/api/state","GET",undefined,{origin:"http://localhost:5174"})).status,403);
    assert.equal((await request("/api/state","GET",undefined,{origin:base})).status,200);
    const saved=await request("/api/model-config","PUT",{apiKey:key,model:"deepseek-flash"});assert.equal(saved.status,200);
    assert.deepEqual(await saved.json(),{configured:true,model:"deepseek-flash"});
    assert.equal((await stat(join(dir,"settings.json"))).mode&0o777,0o600);
    assert.equal(JSON.parse(await readFile(join(dir,"settings.json"),"utf8")).apiKey,key);
    for(const path of ["/api/model-config","/api/health","/api/state"]) assert.equal((await (await request(path)).text()).includes(key),false);
    assert.equal(safeErrorMessage(new Error(`test ${key}`)).includes(key),false);
    const first=await (await request("/api/desktop/examples","POST",{})).json() as {created:string[]};assert.equal(first.created.length,3);
    const again=await (await request("/api/desktop/examples","POST",{})).json() as {created:string[]};assert.equal(again.created.length,0);
    assert.equal(running.runtime.store.list("runs").length,0);
    await request("/api/model-config","PUT",{clear:true});assert.equal((await (await request("/api/model-config")).json() as {configured:boolean}).configured,false);
    running.runtime.home.generate=async()=>({action:"answer"});running.runtime.pump=()=>{};
    assert.equal((await request("/api/assistant/messages","POST",{content:"缺少请求ID"})).status,400);
    const input={requestId:"http-once",content:"你好"};const a=await (await request("/api/assistant/messages","POST",input)).json();const b=await (await request("/api/assistant/messages","POST",input)).json();assert.deepEqual(a,b);
    assert.equal((await request("/api/assistant/messages","POST",{...input,content:"改了"})).status,409);
  } finally {
    if(running){await running.runtime.close();running.server.closeAllConnections();await new Promise<void>(r=>running!.server.close(()=>r()));running.runtime.store.close();}
    for(const n of names){if(old[n]===undefined)delete process.env[n];else process.env[n]=old[n];}
    await rm(dir,{recursive:true,force:true});
  }
});
