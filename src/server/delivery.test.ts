import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OrbitStore, now } from "./store.ts";
import { OrbitRuntime } from "./runtime.ts";
import { loadApps } from "../apps/registry.ts";
import type { AssistantDelivery, PresentDeliveryInput } from "../shared/delivery.ts";
import type { AgentSession, ExtensionContext } from "@earendil-works/pi-coding-agent";

async function harness() {
  const dir=await mkdtemp(join(tmpdir(),"orbit-delivery-")),store=new OrbitStore(":memory:");
  const runtime=new OrbitRuntime(store,await loadApps({installedOnly:true}),dir);runtime.pump=()=>{};runtime.initialize({seed:false});
  runtime.home.generate=async()=>({action:"answer"});
  const first=runtime.createConversation("杭州周末计划"), second=runtime.createConversation("客户提案");
  const message=store.addMessage(first.id,"assistant","预算2000元，尚未确定周末；没有预订。");
  const artifact=runtime.assistant.saveNote({conversationId:first.id,title:"雨天方案",content:"# 雨天方案\n\n## 预算\n总额不超过2000元。\n\n## 待确认\n日期还没定。"},{open:false});
  return {dir,store,runtime,first,second,message,artifact,async close(){await runtime.close();store.close();await rm(dir,{recursive:true,force:true});}};
}
function caller(runtime:OrbitRuntime,runId:string) {
  const run=runtime.store.require("runs",runId);
  const active={run,cancelled:false,pendingSteers:[],children:new Set<AgentSession>(),childSlots:0,text:""};
  const tools=runtime.hostTools(run.conversationId,active,()=>undefined);
  return async(name:string,input:Record<string,unknown>,callId=`${name}-call`) => {
    const tool=tools.find(tool=>tool.name===name);assert.ok(tool,`${name} is registered`);
    const response=await tool.execute(callId,input,undefined,undefined,{} as ExtensionContext);
    return JSON.parse(response.content.filter(c=>c.type==="text").map(c=>c.text).join(""));
  };
}

test("an exact home match prefetches only real bounded content and previews it before model execution",async()=>{
  const h=await harness();
  try {
    const before=JSON.stringify({messages:h.store.list("messages").filter(m=>m.conversationId===h.first.id),artifacts:h.store.list("artifacts"),conversation:h.store.get("conversations",h.first.id)});
    let catalog:Record<string,any>={};
    h.runtime.home.generate=async input=>{catalog=JSON.parse(input);return {action:"answer",relatedSource:{conversationId:h.first.id,artifactId:h.artifact.id,confidence:.98,openRequested:true}};};
    const response=await h.runtime.home.submit({requestId:"prefetch",content:"打开雨天方案，简单介绍进展"});
    const indexed=catalog.conversations.find((c:any)=>c.id===h.first.id).artifacts;
    assert.deepEqual(indexed,[{id:h.artifact.id,title:h.artifact.title,updatedAt:h.artifact.updatedAt}]);
    assert.equal(JSON.stringify(catalog).includes(h.artifact.content),false);
    const prompt=h.store.pending().find(p=>p.runId===response.runId)!.prompt;
    assert.match(prompt,/本轮没有附加窗口引用/);assert.match(prompt,/宿主仅为本轮预读/);assert.ok(prompt.includes(JSON.stringify(h.artifact.content)));
    assert.doesNotMatch(prompt,/本轮明确引用的快照/);
    const preview=h.runtime.assistant.getState().deliveries.at(-1)!;
    assert.equal(preview.kind,"preview");assert.equal(preview.spokenText,"");assert.equal(preview.presented,true);assert.equal(preview.target?.artifactId,h.artifact.id);
    const context=JSON.parse(h.runtime.contextSummary(response.conversationId,undefined,response.runId).split("\n")[1]!);
    assert.equal(context.prefetchedPreview.presented,true);assert.equal(context.prefetchedPreview.target.artifactId,h.artifact.id);
    const call=caller(h.runtime,response.runId);
    await assert.rejects(()=>call("open_workspace",{conversationId:h.first.id}),/not|registered/);
    await assert.rejects(()=>call("open_panel",{kind:"artifact",artifactId:h.artifact.id}),/not|registered/);
    assert.equal(h.store.list("runs").filter(run=>run.conversationId===h.first.id).length,0);
    assert.equal(JSON.stringify({messages:h.store.list("messages").filter(m=>m.conversationId===h.first.id),artifacts:h.store.list("artifacts"),conversation:h.store.get("conversations",h.first.id)}),before);
    const final=h.runtime.deliveries.present(response.runId,"final-without-read",{spokenText:"方案保留了两千元预算，出行日期还没确认。",target:{kind:"artifact",conversationId:h.first.id,artifactId:h.artifact.id}});
    assert.equal(final.kind,"final");assert.equal(final.presented,true);assert.equal(final.workspaceRevision,preview.workspaceRevision);assert.notEqual(final.id,preview.id);
    assert.deepEqual(await h.runtime.home.submit({requestId:"prefetch",content:"打开雨天方案，简单介绍进展"}),response);
    assert.equal(h.runtime.assistant.getState().deliveries.length,2);
    h.runtime.home.generate=async()=>({action:"answer"});
    const next=await h.runtime.home.submit({requestId:"no-prefetch-next",content:"新问题，解释一下咖啡萃取"});
    assert.doesNotMatch(h.store.pending().find(p=>p.runId===next.runId)!.prompt,/宿主仅为本轮预读|总额不超过2000元/);
  }finally{await h.close();}
});

test("catalog identifiers never count as reading, and invalid or uncertain sources cannot preview",async()=>{
  const h=await harness();
  try {
    const others=Array.from({length:4},(_,i)=>h.store.put("artifacts",{...h.artifact,id:`indexed-${i}`,title:`资料 ${i}`,content:`UNREAD_BODY_${i}`,updatedAt:`2099-01-0${i+1}`}));
    for(const [index,source] of [
      {conversationId:h.first.id,artifactId:others[3].id,confidence:.84,openRequested:true},
      {conversationId:"missing",confidence:1,openRequested:true},
      {conversationId:h.second.id,artifactId:others[3].id,confidence:1,openRequested:true},
      {conversationId:h.first.id,artifactId:others[0].id,confidence:1,openRequested:true},
      {conversationId:h.first.id,artifactId:"invented",confidence:1,openRequested:true},
    ].entries()) {
      h.runtime.home.generate=async input=>{
        const catalog=JSON.parse(input).conversations.find((c:any)=>c.id===h.first.id);
        assert.equal(catalog.artifacts.length,3);assert.equal(JSON.stringify(catalog).includes("UNREAD_BODY"),false);
        return {action:"answer",relatedSource:source};
      };
      const response=await h.runtime.home.submit({requestId:`invalid-source-${index}`,content:"打开那份资料"});
      assert.doesNotMatch(h.store.pending().find(p=>p.runId===response.runId)!.prompt,/宿主仅为本轮预读/);
      assert.throws(()=>h.runtime.deliveries.present(response.runId,"unread-index",{spokenText:"这是刚才的资料。",target:{kind:"artifact",conversationId:h.first.id,artifactId:others[3].id}}),/先读取/);
    }
    assert.equal(h.runtime.assistant.getState().workspace.tabs.length,0);assert.equal(h.runtime.assistant.getState().deliveries.length,0);
  }finally{await h.close();}
});

test("read-only recall without an explicit open and ambiguous or independent decisions never preview",async()=>{
  const h=await harness();
  try {
    for(const [index,content] of ["不要打开，只回顾一下杭州方案","比较杭州和客户方案","先不管旅行，解释什么是光合作用"].entries()) {
      h.runtime.home.generate=async()=>index===0?{action:"answer",relatedSource:{conversationId:h.first.id,artifactId:h.artifact.id,confidence:1,openRequested:false}}:{action:"answer"};
      const response=await h.runtime.home.submit({requestId:`non-opening-${index}`,content});
      assert.equal(h.runtime.assistant.getState().deliveries.filter(d=>d.runId===response.runId).length,0);
    }
    h.runtime.home.generate=async()=>{h.store.updateConversation(h.first.id,{archived:true});return {action:"answer",relatedSource:{conversationId:h.first.id,artifactId:h.artifact.id,confidence:1,openRequested:true}};};
    const archived=await h.runtime.home.submit({requestId:"archived-prefetch",content:"打开杭州"});
    assert.doesNotMatch(h.store.pending().find(p=>p.runId===archived.runId)!.prompt,/宿主仅为本轮预读/);
    assert.equal(h.runtime.assistant.getState().workspace.tabs.length,0);
  }finally{await h.close();}
});

test("superseded routing cannot preview and closing an early preview prevents final delivery from reopening it",async()=>{
  const h=await harness();
  try {
    let decide!:(value:unknown)=>void;h.runtime.home.generate=async()=>new Promise(resolve=>{decide=resolve;});
    const oldPending=h.runtime.home.submit({requestId:"slow-prefetch",content:"打开杭州方案"});
    h.runtime.home.generate=async()=>({action:"answer"});await h.runtime.home.submit({requestId:"newer-foreground",content:"先聊别的"});
    decide({action:"answer",relatedSource:{conversationId:h.first.id,artifactId:h.artifact.id,confidence:1,openRequested:true}});
    const old=await oldPending;
    const late=h.runtime.assistant.getState().deliveries.find(d=>d.runId===old.runId)!;
    assert.equal(late.kind,"preview");assert.equal(late.presented,false);assert.equal(late.reason,"superseded");assert.equal(h.runtime.assistant.getState().workspace.tabs.length,0);
    h.runtime.home.generate=async()=>({action:"answer",relatedSource:{conversationId:h.first.id,artifactId:h.artifact.id,confidence:1,openRequested:true}});
    const current=await h.runtime.home.submit({requestId:"preview-close",content:"现在打开杭州方案"});
    h.runtime.assistant.workspace({action:"clear"});
    const context=JSON.parse(h.runtime.contextSummary(current.conversationId,undefined,current.runId).split("\n")[1]!);
    assert.equal(context.prefetchedPreview.presented,false);
    const final=h.runtime.deliveries.present(current.runId,"closed-final",{spokenText:"资料已读过，日期还没有确认。",target:{kind:"artifact",conversationId:h.first.id,artifactId:h.artifact.id}});
    assert.equal(final.presented,false);assert.equal(final.reason,"workspace_changed");assert.equal(h.runtime.assistant.getState().workspace.tabs.length,0);
  }finally{await h.close();}
});

test("a truncated prefetched artifact carries a full-version fingerprint and cannot prove a changed tail was read",async()=>{
  const h=await harness();
  try {
    const original={...h.artifact,content:"a".repeat(13000)};h.store.put("artifacts",original);
    h.runtime.home.generate=async()=>({action:"answer",relatedSource:{conversationId:h.first.id,artifactId:h.artifact.id,confidence:1,openRequested:true}});
    const send=h.runtime.send.bind(h.runtime);
    h.runtime.send=async(...args)=>{h.store.put("artifacts",{...original,content:original.content+"later-tail"});return send(...args);};
    const response=await h.runtime.home.submit({requestId:"changed-tail",content:"打开这份长文"});
    const metadata=h.store.metadata<any>(`delivery:${response.runId}`);
    assert.equal(metadata.prefetchedContext.snapshot.artifact.content.length,12000);
    assert.equal(metadata.prefetchedContext.snapshot.artifact.contentTruncated,true);
    assert.equal(typeof metadata.prefetchedContext.snapshot.artifactFingerprint,"string");
    assert.equal(h.runtime.assistant.getState().deliveries.length,0);assert.equal(h.runtime.assistant.getState().workspace.tabs.length,0);
    assert.throws(()=>h.runtime.deliveries.present(response.runId,"stale-prefetch",{spokenText:"当前文档已准备。",target:{kind:"artifact",conversationId:h.first.id,artifactId:h.artifact.id}}),/当前版本/);
    await caller(h.runtime,response.runId)("workspace_read",{conversationId:h.first.id,artifactId:h.artifact.id});
    // The stale prefetch did not narrow the active read-only tool contract.
    const opened=await caller(h.runtime,response.runId)("open_workspace",{conversationId:h.first.id,kind:"artifact",artifactId:h.artifact.id});
    assert.equal(opened.presented,true);
  }finally{await h.close();}
});

test("an explicit home source-open reads before delivery and never runs or writes the old matter",async()=>{
  const h=await harness();
  try {
    const response=await h.runtime.home.submit({requestId:"recall",content:"打开杭州旅行的原对话，定位上次停下来的那条消息"}),call=caller(h.runtime,response.runId);
    // Exercise the post-routing explicit-open contract without host prefetch, so the
    // agent still has to acquire evidence before presenting the original message.
    const delivery = h.store.metadata<Record<string, unknown>>(`delivery:${response.runId}`)!;
    h.store.setMetadata(`delivery:${response.runId}`, { ...delivery, allowConversationNavigation: true });
    const input={spokenText:"上次确定了两千元以内的预算，具体周末还没定。原讨论里保留着待确认的安排。",target:{kind:"conversation",conversationId:h.first.id,focus:{messageId:h.message.id}}};
    await assert.rejects(()=>call("present_delivery",input),/先读取/);
    const before=JSON.stringify(h.store.list("messages").filter(m=>m.conversationId===h.first.id));
    await call("workspace_read",{conversationId:h.first.id});
    const delivered=await call("present_delivery",input) as AssistantDelivery;
    assert.equal(delivered.presented,true);assert.equal(delivered.target?.title,h.first.title);assert.equal(delivered.runId,response.runId);assert.equal(delivered.requestId,"recall");assert.equal(delivered.generation,1);
    assert.equal(h.runtime.assistant.getState().workspace.tabs[0].messageId,h.message.id);
    assert.equal(JSON.stringify(h.store.list("messages").filter(m=>m.conversationId===h.first.id)),before);
    assert.equal(h.store.list("runs").filter(r=>r.conversationId===h.first.id).length,0);
    assert.equal(h.store.list("artifacts").length,1);
    assert.equal(h.store.list("messages").filter(m=>m.linkedConversationId===h.first.id).length,1);
    assert.equal(h.runtime.assistant.getState().deliveries[0].spokenText,input.spokenText);
  }finally{await h.close();}
});

test("artifact delivery checks exact ownership, prior read, current content and real heading",async()=>{
  const h=await harness();
  try {
    h.runtime.home.generate=async()=>({action:"answer",visualRequested:true});
    const response=await h.runtime.home.submit({requestId:"artifact",content:"打开这份方案"}),call=caller(h.runtime,response.runId);
    const input:PresentDeliveryInput={spokenText:"预算仍不超过两千元，出发日期尚未确认。",target:{kind:"artifact",conversationId:h.first.id,artifactId:h.artifact.id,focus:{heading:"预算"}}};
    assert.throws(()=>h.runtime.deliveries.present(response.runId,"unread",input),/先读取/);
    assert.throws(()=>h.runtime.deliveries.present(response.runId,"wrong-owner",{...input,target:{...input.target!,conversationId:h.second.id}}),/不属于/);
    await call("workspace_read",{conversationId:h.first.id,artifactId:h.artifact.id});
    assert.throws(()=>h.runtime.deliveries.present(response.runId,"invented-heading",{...input,target:{...input.target!,focus:{heading:"不存在"}}}),/标题不在/);
    h.store.put("artifacts",{...h.artifact,content:h.artifact.content+"\n用户后来修改了内容。",updatedAt:"2099-01-01"});
    assert.throws(()=>h.runtime.deliveries.present(response.runId,"stale",input),/当前版本/);
    await call("workspace_read",{conversationId:h.first.id,artifactId:h.artifact.id},"read-new");
    const delivered=h.runtime.deliveries.present(response.runId,"current",input);
    assert.equal(delivered.presented,true);assert.equal(delivered.target?.updatedAt,"2099-01-01");assert.equal(delivered.target?.focus?.heading,"预算");
  }finally{await h.close();}
});

test("app delivery checks installed app, object ownership and the exact version read by a tool",async()=>{
  const h=await harness();
  try {
    const response=await h.runtime.home.sendTo({requestId:"app",conversationId:h.first.id,content:"看看这个对象"});
    const appId=h.runtime.apps[0].manifest.id;
    let object=h.store.saveObject(h.first.id,{appId,type:"test",title:"预算表",data:{amount:2000}});
    const input:PresentDeliveryInput={spokenText:"预算表目前列出了两千元的总额。",target:{kind:"app",conversationId:h.first.id,appId,objectId:object.id}};
    assert.throws(()=>h.runtime.deliveries.present(response.runId,"unread",input),/先读取/);
    assert.throws(()=>h.runtime.deliveries.present(response.runId,"wrong-owner",{...input,target:{...input.target!,conversationId:h.second.id}}),/不属于/);
    h.runtime.appContext(h.first.id,true,response.runId).getObject(object.id);
    object=h.store.saveObject(h.first.id,{id:object.id,appId,type:object.type,title:object.title,expectedVersion:object.version,data:{amount:1900}});
    assert.throws(()=>h.runtime.deliveries.present(response.runId,"stale",input),/当前版本/);
    h.runtime.appContext(h.first.id,true,response.runId).getObject(object.id);
    const delivered=h.runtime.deliveries.present(response.runId,"current",{...input,spokenText:"预算表更新为一千九百元。"});
    assert.equal(delivered.target?.objectVersion,2);assert.equal(delivered.target?.title,"预算表");
  }finally{await h.close();}
});

test("new requests immediately supersede old delivery; manual navigation invalidates automatic display",async()=>{
  const h=await harness();
  try {
    const old=await h.runtime.home.submit({requestId:"old",content:"回顾杭州"});
    h.runtime.deliveries.readConversation(old.runId,h.first.id);
    let decide!:(value:unknown)=>void;h.runtime.home.generate=async()=>new Promise(resolve=>{decide=resolve;});
    const pending=h.runtime.home.submit({requestId:"new",content:"我换个问题"});
    const late=h.runtime.deliveries.present(old.runId,"late",{spokenText:"原计划仍待确认日期。",target:{kind:"conversation",conversationId:h.first.id}});
    assert.equal(late.presented,false);assert.equal(late.reason,"superseded");assert.equal(h.runtime.assistant.getState().workspace.tabs.length,0);
    decide({action:"answer"});await pending;
    const direct=await h.runtime.home.sendTo({requestId:"direct",conversationId:h.first.id,content:"本事项继续"});
    assert.equal(h.runtime.assistant.getState().deliveryGeneration,3);
    const shown=h.runtime.deliveries.present(direct.runId,"first",{spokenText:"当前事项保持原来的预算。"});assert.equal(shown.presented,true);
    h.runtime.assistant.workspace({action:"open",conversationId:h.second.id});
    const rejected=h.runtime.deliveries.present(direct.runId,"manual",{spokenText:"口头稿仍已保存。"});assert.equal(rejected.reason,"workspace_changed");
    const gen=h.runtime.assistant.getState().deliveryGeneration;
    await h.runtime.send(h.second.id,"旧版HTTP入口请求");assert.equal(h.runtime.assistant.getState().deliveryGeneration,gen+1);
  }finally{await h.close();}
});

test("speech-only or current-conversation delivery does not force a duplicate window; background cannot present",async()=>{
  const h=await harness();
  try {
    const response=await h.runtime.home.sendTo({requestId:"short",conversationId:h.first.id,content:"解释一下预算"});
    const before=h.runtime.assistant.getState().workspace;
    assert.equal(h.runtime.deliveries.present(response.runId,"speech",{spokenText:"这只是预算上限，还不代表已经付款。"}).presented,true);
    assert.equal(h.runtime.deliveries.present(response.runId,"same",{spokenText:"具体周末还没确定。",target:{kind:"conversation",conversationId:h.first.id}}).presented,true);
    assert.deepEqual(h.runtime.assistant.getState().workspace,before);
    const background=h.runtime.queue(h.first.id,"后台工作","trigger","后台检查");
    const delivered=h.runtime.deliveries.present(background,"background",{spokenText:"后台结果已留在事项中。"});assert.equal(delivered.reason,"background");assert.equal(delivered.requestId,null);
    for(const spokenText of ["","字".repeat(91),"# Markdown标题","看https://example.com","第一段\n第二段"])assert.throws(()=>h.runtime.deliveries.present(response.runId,"invalid",{spokenText}),/口头讲解/);
  }finally{await h.close();}
});

test("brief delivery accepts the 90-character boundary and rejects longer narration without saving or truncating it",async()=>{
  const h=await harness();
  try {
    const response=await h.runtime.home.sendTo({requestId:"brief-limit",conversationId:h.first.id,content:"简单介绍一下"});
    const run=h.store.require("runs",response.runId);
    const tool=h.runtime.hostTools(run.conversationId,{run,cancelled:false,pendingSteers:[],children:new Set<AgentSession>(),childSlots:0,text:""},()=>undefined).find(tool=>tool.name==="present_delivery")!;
    assert.equal((tool.parameters as any).properties.spokenText.maxLength,90);
    const before=h.runtime.assistant.getState().deliveries.length;
    assert.throws(()=>h.runtime.deliveries.present(response.runId,"rewrite",{spokenText:"字".repeat(91)}),/重新撰写.*最多90字/);
    assert.equal(h.runtime.assistant.getState().deliveries.length,before);
    const boundary="字".repeat(90);
    const accepted=h.runtime.deliveries.present(response.runId,"boundary",{spokenText:boundary});
    assert.equal(accepted.spokenText,boundary);
    // A validation failure did not consume the call ID: the model may rewrite and retry.
    const rewritten="预算已调整，完整分配在旁边。接下来只需确认出行日期。";
    assert.equal(h.runtime.deliveries.present(response.runId,"rewrite",{spokenText:rewritten}).spokenText,rewritten);
  }finally{await h.close();}
});

test("delivery calls are idempotent, latest state is bounded, and older records remain durable",async()=>{
  const h=await harness();
  try {
    const response=await h.runtime.home.sendTo({requestId:"bounded",conversationId:h.first.id,content:"解释"});
    const first=h.runtime.deliveries.present(response.runId,"call-0",{spokenText:"预算尚未执行。"});
    assert.deepEqual(h.runtime.deliveries.present(response.runId,"call-0",{spokenText:"预算尚未执行。"}),first);
    assert.throws(()=>h.runtime.deliveries.present(response.runId,"call-0",{spokenText:"替换了原口头稿。"}),/已完成/);
    for(let i=1;i<25;i++)h.runtime.deliveries.present(response.runId,`call-${i}`,{spokenText:`这是第${i}条独立讲解。`});
    assert.equal(h.runtime.assistant.getState().deliveries.length,20);
    assert.deepEqual(h.store.metadata(`assistant:delivery:${first.id}`),first);
    const reload=new OrbitRuntime(h.store,h.runtime.apps,h.dir);reload.pump=()=>{};
    assert.deepEqual(reload.assistant.getState().deliveries,h.runtime.assistant.getState().deliveries);await reload.close();
  }finally{await h.close();}
});

test("visible context is explicit request data, frozen and idempotent, with active reference kept separate",async()=>{
  const h=await harness();
  try {
    let observed:Record<string,any>={};h.runtime.home.generate=async input=>{observed=JSON.parse(input);h.store.put("artifacts",{...h.artifact,content:"窗口中的文档随后改变了。",updatedAt:now()});return {action:"answer",useVisibleContext:true};};
    const input={requestId:"visible",content:"这里的预算是多少",context:{conversationId:h.second.id,quote:"主动引用优先"},visibleContext:{conversationId:h.first.id,artifactId:h.artifact.id}};
    const response=await h.runtime.home.submit(input);
    assert.equal(observed.explicitReference.quote,"主动引用优先");assert.equal(observed.visibleContext.artifact.content,h.artifact.content);
    const pending=h.store.pending().find(p=>p.runId===response.runId)!;assert.match(pending.prompt,/本轮发送时可见内容/);assert.match(pending.prompt,/主动引用context优先/);assert.match(pending.prompt,/总额不超过2000元/);assert.doesNotMatch(pending.prompt,/窗口中的文档随后改变了/);
    assert.deepEqual(await h.runtime.home.submit(input),response);
    await assert.rejects(()=>h.runtime.home.submit({...input,visibleContext:{conversationId:h.second.id}}),/重新发送/);
    const count=h.store.list("runs").length;
    await assert.rejects(()=>h.runtime.home.sendTo({requestId:"invalid-visible",conversationId:h.first.id,content:"这里",visibleContext:{conversationId:h.second.id,artifactId:h.artifact.id}}),/不属于/);
    assert.equal(h.store.list("runs").length,count);
    const next=await h.runtime.home.sendTo({requestId:"next",conversationId:h.first.id,content:"新问题"});
    assert.doesNotMatch(h.store.pending().find(p=>p.runId===next.runId)!.prompt,/本轮发送时可见内容/);
    h.runtime.home.generate=async()=>({action:"new",title:"独立新主题",confidence:1,useVisibleContext:false});
    const unrelated=await h.runtime.home.submit({requestId:"unrelated",content:"新建独立的学习计划",visibleContext:input.visibleContext});
    assert.doesNotMatch(h.store.pending().find(p=>p.runId===unrelated.runId)!.prompt,/本轮发送时可见内容|窗口中的文档随后改变了/);
  }finally{await h.close();}
});

test("host completion authors one bounded targetless delivery and never reads unrelated history",async()=>{
  const h=await harness();
  try {
    const response=await h.runtime.home.submit({requestId:"missing-speech",content:"我们之前干了些啥"});
    h.store.addMessage(h.second.id,"assistant","UNRELATED_HISTORY_NOT_FOR_SPEECH");
    let calls=0,input:any;
    h.runtime.deliveries.generate=async value=>{calls++;input=JSON.parse(value);return {spokenText:"之前主要整理了杭州行程，预算范围已定，具体日期和预订还没有确认。"};};
    const content={request:"我们之前干了些啥",answer:"我们整理了杭州行程，预算范围已定，具体日期与预订还没有确认。"+"已有的详细讨论。".repeat(1800),toolResults:[{name:"workspace_read",isError:false,text:"实际已读资料。".repeat(700)}]};
    const before=h.runtime.assistant.currentWorkspace();
    await h.runtime.deliveries.completeFinal(response.runId,content,new AbortController().signal);
    await h.runtime.deliveries.completeFinal(response.runId,content,new AbortController().signal);
    assert.equal(calls,1);assert.equal(input.answer.length,10000);assert.equal(input.answerTruncated,true);assert.equal(input.toolResults[0].text.length,2000);assert.equal(input.toolResults[0].contentTruncated,true);
    assert.ok(!JSON.stringify(input).includes("UNRELATED_HISTORY_NOT_FOR_SPEECH"));
    const delivery=h.runtime.assistant.getState().deliveries.at(-1)!;
    assert.equal(delivery.kind,"final");assert.equal(delivery.target,undefined);assert.equal(delivery.presented,true);assert.equal(delivery.requestId,"missing-speech");assert.ok(delivery.spokenText.length<=90);assert.notEqual(delivery.spokenText,content.answer.slice(0,90));
    assert.deepEqual(h.runtime.assistant.currentWorkspace(),before);assert.equal(h.store.metadata<any>(`delivery-completion:${response.runId}`).status,"completed");
  }finally{await h.close();}
});

test("an existing tool final prevents repair even after bounded delivery history evicts it",async()=>{
  const h=await harness();
  try {
    const first=await h.runtime.home.submit({requestId:"already-delivered",content:"你好"});
    h.runtime.deliveries.present(first.runId,"normal-tool",{spokenText:"你好，想接着聊哪件事？"});
    const second=await h.runtime.home.submit({requestId:"later-history",content:"继续"});
    for(let i=0;i<22;i++)h.runtime.deliveries.present(second.runId,`tool-${i}`,{spokenText:"保留在对话中。"});
    assert.equal(h.runtime.assistant.getState().deliveries.some(d=>d.runId===first.runId),false);assert.equal(h.runtime.deliveries.hasFinal(first.runId),true);
    let calls=0;h.runtime.deliveries.generate=async()=>{calls++;return {spokenText:"不应生成"};};
    await h.runtime.deliveries.completeFinal(first.runId,{request:"你好",answer:"你好",toolResults:[]},new AbortController().signal);
    await h.runtime.deliveries.completeFinal(second.runId,{request:"继续",answer:"继续",toolResults:[]},new AbortController().signal);
    assert.equal(calls,0);
  }finally{await h.close();}
});

test("preview-only completion supplies speech without reopening or selecting a target",async()=>{
  const h=await harness();
  try {
    h.runtime.home.generate=async()=>({action:"answer",relatedSource:{conversationId:h.first.id,artifactId:h.artifact.id,confidence:1,openRequested:true}});
    const response=await h.runtime.home.submit({requestId:"preview-no-final",content:"打开雨天方案"});
    const workspace=h.runtime.assistant.currentWorkspace();h.runtime.deliveries.generate=async()=>({spokenText:"雨天方案保留了预算上限，日期还需要确认。"});
    await h.runtime.deliveries.completeFinal(response.runId,{request:"打开雨天方案",answer:"雨天方案保留预算上限，日期尚未确认。",toolResults:[]},new AbortController().signal);
    const deliveries=h.runtime.assistant.getState().deliveries;
    assert.deepEqual(deliveries.map(d=>d.kind),["preview","final"]);assert.equal(deliveries[1].target,undefined);assert.equal(deliveries[1].workspaceRevision,workspace.revision);assert.deepEqual(h.runtime.assistant.currentWorkspace(),workspace);
    assert.equal(h.store.list("runs").filter(r=>r.conversationId===h.first.id).length,0);
  }finally{await h.close();}
});

test("late repair respects newer requests, manual workspace edits, cancellation and concurrent tool delivery",async()=>{
  for(const mode of ["superseded","manual","cancelled","tool-final"] as const) {
    const h=await harness();
    try {
      const response=await h.runtime.home.submit({requestId:`late-${mode}`,content:"回顾"});
      let finish!:(value:unknown)=>void;h.runtime.deliveries.generate=async()=>new Promise(resolve=>{finish=resolve;});
      const pending=h.runtime.deliveries.completeFinal(response.runId,{request:"回顾",answer:"日期还没定。",toolResults:[]},new AbortController().signal);
      if(mode==="superseded")h.runtime.deliveries.beginRequest("new-user-request");
      if(mode==="manual")h.runtime.assistant.workspace({action:"open",conversationId:h.second.id});
      if(mode==="cancelled")h.store.put("runs",{...h.store.require("runs",response.runId),status:"cancelled"});
      if(mode==="tool-final")h.runtime.deliveries.present(response.runId,"tool-won",{spokenText:"本轮已经提供讲解。"});
      finish({spokenText:"这条晚到的讲解不应自动播放。"});await pending;
      assert.equal(h.runtime.assistant.getState().deliveries.length,mode==="tool-final"?1:0);assert.equal(h.store.list("messages").some(m=>m.content.includes("未能生成")),false);
    }finally{await h.close();}
  }
});

test("invalid, unavailable and timed-out repairs fail explicitly once without leaking errors or fabricating speech",async()=>{
  for(const mode of ["long","target","provider","timeout"] as const) {
    const h=await harness();
    try {
      const response=await h.runtime.home.submit({requestId:`failed-${mode}`,content:"回顾"});let calls=0;
      h.runtime.deliveries.generate=async()=>{calls++;if(mode==="provider")throw new Error("SECRET_IN_PROVIDER_ERROR");if(mode==="timeout")return new Promise(()=>{});return mode==="long"?{spokenText:"字".repeat(91)}:{spokenText:"已打开新文档。",target:{kind:"artifact",artifactId:"invented"}};};
      const controller=new AbortController();const content={request:"回顾",answer:"文字答复已保留。",toolResults:[]};
      const pending=h.runtime.deliveries.completeFinal(response.runId,content,controller.signal);if(mode==="timeout")controller.abort("delivery-timeout");await pending;
      await h.runtime.deliveries.completeFinal(response.runId,content,new AbortController().signal);
      assert.equal(calls,1);assert.equal(h.runtime.assistant.getState().deliveries.length,0);assert.equal(h.store.metadata<any>(`delivery-completion:${response.runId}`).status,"failed");
      const activity=h.store.list("activities").find(a=>a.runId===response.runId&&a.title==="语音讲解未生成");assert.equal(activity?.status,"failed");assert.match(activity!.detail,/文字答复已保留/);
      assert.equal(JSON.stringify({messages:h.store.list("messages"),activities:h.store.list("activities")}).includes("SECRET_IN_PROVIDER_ERROR"),false);
      assert.equal(h.runtime.assistant.currentWorkspace().tabs.length,0);
    }finally{await h.close();}
  }
});

test("explicit legacy spoken delivery completes a foreground run and cancels repair on stop",async()=>{
  const previousMode=process.env.ORBIT_SPOKEN_DELIVERY; process.env.ORBIT_SPOKEN_DELIVERY="1";
  try { for(const cancel of [false,true]) {
    const h=await harness();
    try {
      h.runtime.memory.schedule=async()=>{};h.runtime.discussion.schedule=async()=>{};
      const main=h.runtime.assistant.getState().conversationId,oldFile=join(h.dir,"existing-session.jsonl");h.store.setMetadata(`session:${main}`,oldFile);
      h.store.setMetadata(`session:${main}:memory-scope`,h.runtime.sessionMemoryState(main).signature);
      let options:any,prompt="",started!:()=>void;const generating=new Promise<void>(resolve=>{started=resolve;});
      h.runtime.openSession=(async value=>{
        options=value;let notify:(event:any)=>void=()=>{};
        return {session:{sessionManager:{getSessionFile:()=>oldFile},subscribe:(fn:(event:any)=>void)=>{notify=fn;},prompt:async(value:string)=>{prompt=value;notify({type:"message_end",message:{role:"assistant",content:[{type:"text",text:"我们整理了旅行安排，具体日期尚未确认。"}]}});},dispose:()=>{},abort:async()=>{}}};
      }) as OrbitRuntime["openSession"];
      h.runtime.deliveries.generate=async()=>{started();return cancel?new Promise(()=>{}):{spokenText:"之前整理了旅行安排，具体日期还没确认。"};};
      const response=await h.runtime.home.submit({requestId:`runtime-repair-${cancel}`,content:"我们之前干了些啥"});
      const run=h.store.require("runs",response.runId),active={run,cancelled:false,pendingSteers:[],children:new Set<AgentSession>(),childSlots:0,text:""};
      h.runtime.active.set(main,active);
      const executing=h.runtime.execute(active,h.store.pending().find(p=>p.runId===run.id)!);await generating;
      if(cancel)await h.runtime.stopConversation(main);await executing;
      assert.equal(options.sessionFile,oldFile);assert.match(options.systemPrompt,/默认是纯文字协作/);assert.ok(options.activeTools.includes("present_delivery"));assert.ok(options.tools.some((tool:any)=>tool.name==="present_delivery"));assert.match(prompt,/本轮宿主交付规则/);
      assert.equal(h.store.require("runs",run.id).status,cancel?"cancelled":"completed");assert.equal(h.runtime.assistant.getState().deliveries.length,cancel?0:1);
      assert.equal(h.store.list("messages").filter(m=>m.runId===run.id&&m.role==="assistant").length,1);
    }finally{await h.close();}
  } } finally { if(previousMode===undefined)delete process.env.ORBIT_SPOKEN_DELIVERY;else process.env.ORBIT_SPOKEN_DELIVERY=previousMode; }
});
