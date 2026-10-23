import test from "node:test";
import assert from "node:assert/strict";
import { OrbitStore } from "./store.ts";
import { selectContextSources } from "./context-sources.ts";
import { seedContextDemo } from "./showcases/context-demo.ts";

test("context selection needs a read of the exact original message and commits atomically",()=>{
 const store=new OrbitStore(":memory:");try{
  const a=store.createConversation("GPU 带宽"),b=store.createConversation("XR 项目");
  const m=store.addMessage(a.id,"assistant","峰值算力不能单独决定实际应用速度。"),other=store.addMessage(b.id,"assistant","没有测量结果。");
  store.put("runs",{id:"run",conversationId:b.id,parentId:null,title:"结合之前的知识",status:"running",startedAt:"2026-10-12",summary:""});
  const select={conversationId:a.id,messageId:m.id,kind:"knowledge" as const,reason:"用来区分算力与数据供给。"};
  assert.throws(()=>selectContextSources(store,"run",[select]),/先读取/);
  store.setMetadata("delivery-evidence:run",{conversations:[a.id],messages:[other.id]});
  assert.throws(()=>selectContextSources(store,"run",[select]),/先读取/);
  store.setMetadata("delivery-evidence:run",{conversations:[a.id],messages:[m.id]});
  const result=selectContextSources(store,"run",[select]);assert.equal(result.contextSources?.[0].excerpt,m.content);
  selectContextSources(store,"run",[{...select,reason:"更新说明"}]);assert.equal(store.require("runs","run").contextSources?.length,1);
  assert.throws(()=>selectContextSources(store,"run",[select,{...select,messageId:other.id}]),/不属于/);
  assert.equal(store.require("runs","run").contextSources?.[0].reason,"更新说明");
  store.put("runs",{...store.require("runs","run"),status:"completed"});
  assert.throws(()=>selectContextSources(store,"run",[select]),/已结束/);
 }finally{store.close();}
});

test("demo seed is isolated, idempotent and preserves existing conversations",()=>{
 const store=new OrbitStore(":memory:");try{
  const original=store.createConversation("真实工作");store.addMessage(original.id,"user","保留我的历史");
  assert.equal(seedContextDemo(store).created.length,15);assert.equal(seedContextDemo(store).created.length,0);
  assert.equal(store.list("conversations").length,16);assert.equal(store.require("conversations",original.id).title,"真实工作");
  assert.ok(store.list("conversations").filter(c=>c.id!==original.id).every(c=>c.showcase));
  assert.equal(store.list("runs").length,0);assert.equal(store.list("triggers").length,0);
 }finally{store.close();}
});
