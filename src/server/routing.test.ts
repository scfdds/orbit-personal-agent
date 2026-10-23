import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AgentSession, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { OrbitStore, now } from "./store.ts";
import { OrbitRuntime } from "./runtime.ts";
import { ConversationRouter } from "./routing.ts";
import { createOrbitServer } from "./http.ts";

function setup() {
  const store = new OrbitStore(":memory:");
  const runtime = new OrbitRuntime(store, [], "/tmp/orbit-routing-test");
  runtime.pump = () => {};
  const parent = store.createConversation("Orbit 云端方案", { project: "产品设计" });
  const source = store.addMessage(parent.id, "user", "Orbit 优先本地，云端通过 Git 接续。");
  const other = store.createConversation("周末旅行", { project: "生活" });
  store.addMessage(other.id, "user", "周末去杭州。");
  return { store, runtime, parent, source, other,
    close: async () => { await runtime.close(); store.close(); } };
}
const input = (requestId: string, content = "接着讨论 Orbit 云端方案") => ({ requestId, content, mode: "auto" as const });

test("intake resumes the matched conversation once, including concurrent retries and receipt recovery", async () => {
  const {store,runtime,parent,other,close} = setup();
  let calls = 0;
  runtime.router.generate = async () => { calls++; return { action:"resume", conversationId:parent.id, confidence:.95, reason:"同一方案的延续" }; };
  try {
    store.setMetadata(`surface:${parent.id}`, {view:"memory"});
    const [first, second] = await Promise.all([runtime.router.submit(input("once")), runtime.router.submit(input("once"))]);
    assert.deepEqual(first, second);
    assert.equal(calls, 1);
    assert.equal(first.conversationId, parent.id);
    assert.equal(first.route.action,"resume");
    assert.equal(store.list("conversations").length,2);
    assert.equal(store.list("messages").filter(m=>m.conversationId===parent.id).length,2);
    assert.equal(store.list("messages").filter(m=>m.conversationId===other.id).length,1);
    assert.equal(store.pending().length,1);
    assert.equal(store.metadata(`surface:${parent.id}`),null);
    assert.match(runtime.contextSummary(parent.id),/entryRouting/);
    const recovered = new ConversationRouter(runtime, async()=>{throw new Error("must not call model");});
    assert.deepEqual(await recovered.submit(input("once")),first);
    await assert.rejects(recovered.submit(input("once","edited request")),/重新发送/);
    await recovered.close();
    assert.equal(store.pending().length,1);
  } finally { await close(); }
});

test("manual new bypasses routing; automatic new can organize a section; negated new is not a keyword override", async () => {
  const {store,runtime,parent,close} = setup();
  let calls=0;
  runtime.router.generate=async()=>{calls++;return {action:"new",title:"准备面试",project:"求职",reason:"独立事项"};};
  try {
    const manual=await runtime.router.submit({...input("manual"),mode:"new",project:"我指定的分区"});
    assert.equal(calls,0);
    assert.equal(manual.route.project,"我指定的分区");
    assert.notEqual(manual.conversationId,parent.id);
    const fresh=await runtime.router.submit(input("fresh","准备产品经理面试"));
    assert.equal(fresh.route.project,"求职");
    assert.ok(runtime.sections.list().some(s=>s.name==="求职"));
    runtime.router.generate=async(text)=>{
      assert.match(text,/不要新建对话/);
      return {action:"resume",conversationId:parent.id,confidence:.99};
    };
    assert.equal((await runtime.router.submit(input("negated","不要新建对话，继续 Orbit 的方案"))).conversationId,parent.id);
  } finally { await close(); }
});

test("invalid, uncertain and unavailable routing safely creates a conversation without touching unrelated history", async () => {
  const {store,runtime,parent,close} = setup();
  try {
    for(const [index,decision] of [
      {action:"resume",conversationId:parent.id,confidence:.3},
      {action:"resume",conversationId:"invented-id",confidence:1},
      {action:"resume",conversationId:parent.id,confidence:"0.99"},
      {action:"unknown"},
      null,
    ].entries()) {
      runtime.router.generate=async()=>decision;
      const result=await runtime.router.submit(input(`bad-${index}`));
      assert.equal(result.route.action,"new");assert.notEqual(result.conversationId,parent.id);
    }
    runtime.router.generate=async()=>{throw new Error("unavailable");};
    const fallback=await runtime.router.submit(input("offline"));
    assert.equal(fallback.route.fallback,true);
    assert.equal(store.list("messages").filter(m=>m.conversationId===parent.id).length,1);
  } finally {await close();}
});

test("explicit section scope and concurrent archive are revalidated after model selection", async()=>{
  const {store,runtime,parent,other,close}=setup();
  try {
    runtime.router.generate=async text=>{
      const data=JSON.parse(text);
      assert.ok(data.conversations.every((c:{project:string})=>c.project==="产品设计"));
      return {action:"resume",conversationId:other.id,confidence:1,project:"生活"};
    };
    const scoped=await runtime.router.submit({...input("scoped"),project:"产品设计"});
    assert.equal(scoped.route.action,"new");assert.equal(scoped.route.project,"产品设计");
    runtime.router.generate=async()=>{
      store.updateConversation(parent.id,{archived:true});
      return {action:"resume",conversationId:parent.id,confidence:1};
    };
    assert.equal((await runtime.router.submit(input("archived"))).route.action,"new");
    assert.equal(runtime.router.catalog().some(c=>c.id===parent.id),false);
  } finally {await close();}
});

test("automatic fork inherits the selected snapshot and dispatches only in the child", async()=>{
  const {store,runtime,parent,source,close}=setup();
  let summaryInput="";
  runtime.router.generate=async()=>{
    store.addMessage(parent.id,"user","选择开始以后补充的内容");
    return {action:"fork",conversationId:parent.id,title:"Git 冲突处理",confidence:.96};
  };
  runtime.memory.generate=async text=>{
    summaryInput=text;
    return {summary:"本地优先，用 Git 接续",items:[{kind:"decision",text:"采用 Git 接续",sourceIds:[source.id]}]};
  };
  try {
    const result=await runtime.router.submit(input("branch","在 Orbit 方案基础上，单独研究 Git 冲突处理"));
    const child=store.require("conversations",result.conversationId);
    assert.equal(result.route.action,"fork");
    assert.equal(child.parentId,parent.id);assert.equal(child.forkMessageId,source.id);
    assert.equal(child.project,parent.project);
    assert.match(child.inheritedContext!,/Git/);
    assert.doesNotMatch(summaryInput,/选择开始以后补充的内容/);
    assert.deepEqual(child.inheritedSources,[source.id]);
    assert.equal(store.pending()[0].conversationId,child.id);
    assert.equal(store.list("works").length,0);
    assert.equal(store.list("triggers").length,0);
    await assert.rejects(runtime.router.fork(parent.id," "),/标题/);
  } finally {await close();}
});

test("agent tools inspect, paginate, inherit and forward once, without recursively forwarding routed input",async()=>{
  const {store,runtime,parent,source,other,close}=setup();
  const run={id:"origin-run",conversationId:other.id,parentId:null,title:"request",status:"running" as const,startedAt:now(),summary:""};
  store.addMessage(other.id,"user","去 Orbit 对话接着完善方案",run.id);
  const active={run,cancelled:false,pendingSteers:[],children:new Set<AgentSession>(),childSlots:0,text:""};
  const tools=runtime.hostTools(other.id,active,()=>undefined);
  const call=(name:string,args:Record<string,unknown>)=>tools.find(t=>t.name===name)!.execute(name,args,undefined,undefined,{} as ExtensionContext);
  runtime.memory.generate=async()=>({summary:"Git 接续",items:[{kind:"fact",text:"Git 接续",sourceIds:[source.id]}]});
  try {
    for(let i=0;i<15;i++) store.addMessage(parent.id,"user",`discussion ${i}`);
    const page=runtime.router.read(parent.id);
    assert.equal(page.messages.length,12);assert.equal(page.hasEarlier,true);
    const earlier=runtime.router.read(parent.id,page.nextBeforeMessageId);
    assert.equal(earlier.messages.length,4);
    assert.equal(earlier.messages.some(m=>page.messages.some(p=>m.id===p.id)),false);
    assert.throws(()=>runtime.router.read(parent.id,store.list("messages").find(m=>m.conversationId===other.id)!.id));
    assert.match(JSON.stringify(await call("workspace_list",{project:"产品设计"})),/Orbit 云端方案/);
    assert.match(JSON.stringify(await call("workspace_read",{conversationId:parent.id})),/discussion 14/);
    await Promise.all([call("workspace_continue",{conversationId:parent.id,request:"完善方案"}),call("workspace_continue",{conversationId:parent.id,request:"完善方案"})]);
    assert.equal(store.pending().length,1);
    assert.equal(store.list("messages").filter(m=>m.kind==="conversation_link").length,1);
    await call("workspace_fork",{conversationId:parent.id,title:"独立分支",messageId:source.id});
    assert.ok(store.list("conversations").find(c=>c.title==="独立分支")?.inheritedContext);
    await call("workspace_create",{title:"独立问题",project:"新分区",request:"先梳理目标"});
    assert.equal(store.pending().length,2);
    const forwarded=store.list("messages").find(m=>m.route)!;
    const nextActive={...active,run:{...run,id:forwarded.runId!,conversationId:parent.id}};
    const nextTools=runtime.hostTools(parent.id,nextActive,()=>undefined);
    const before=store.list("conversations").length;
    await assert.rejects(nextTools.find(t=>t.name==="workspace_create")!.execute("loop",{title:"不该产生空对话",request:"转发"},undefined,undefined,{} as ExtensionContext),/重复转发/);
    assert.equal(store.list("conversations").length,before);
  } finally {await close();}
});

test("intake HTTP validation rejects malformed requests before mutation and returns a durable routing receipt",async()=>{
  const {store,runtime,parent,close}=setup();
  const server=createOrbitServer(runtime);server.listen(0,"127.0.0.1");await once(server,"listening");
  const address=server.address();assert.ok(address&&typeof address!=="string");
  const send=(body:unknown)=>fetch(`http://127.0.0.1:${address.port}/api/intake`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  runtime.router.generate=async()=>({action:"resume",conversationId:parent.id,confidence:1});
  try {
    for(const body of [{...input("x"),mode:"bad"},{...input("x"),content:" "},{...input("x"),requestId:"invalid/key"}]) assert.equal((await send(body)).status,400);
    assert.equal(store.list("messages").length,2);
    const response=await send(input("http"));assert.equal(response.status,202);
    const result=await response.json() as {conversationId:string;runId:string};
    assert.equal(result.conversationId,parent.id);assert.ok(result.runId);
    assert.deepEqual(await (await send(input("http"))).json(),result);
    assert.equal((await send(input("http","different"))).status,409);
    assert.equal(store.pending().length,1);
  } finally {await close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
