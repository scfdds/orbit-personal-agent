import { useEffect, useRef, useState, type ComponentType } from "react";
import { ArrowUpLeft, ArrowUpRight, Check, ChevronRight, Download, FileText, GitBranch, MessageSquare, PanelRightClose, Quote, X, Layers, Pencil } from "lucide-react";
import type { AssistantWorkspace, AssistantWorkspaceTab, AssistantWorkspaceAction, AssistantMessageContext } from "../shared/assistant.ts";
import type { Snapshot, Artifact } from "../shared/types.ts";
import type { AppPanelProps } from "./panel-types.ts";
import { RichText } from "./ChatView.tsx";
import { IconButton } from "./ui.tsx";
import { request } from "./api.ts";

const appPanels = import.meta.glob<{default: ComponentType<AppPanelProps>}>("../apps/*/Panel.tsx", {eager:true});
type Props = {
  state: Snapshot; workspace: AssistantWorkspace; activeTab: AssistantWorkspaceTab;
  onAction: (action: AssistantWorkspaceAction) => Promise<void>;
  onReference: (context: AssistantMessageContext, draft?: string) => void;
  onHide: () => void; onRefresh: () => Promise<void>;
};
function download(artifact: Artifact) {
  const url = URL.createObjectURL(new Blob([artifact.content], {type:"text/markdown;charset=utf-8"}));
  const link = document.createElement("a"); link.href=url; link.download=`${artifact.title.replace(/[\/\\]/g,"-")}.md`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function NextWorkspace({state,workspace,activeTab,onAction,onReference,onHide,onRefresh}:Props) {
  const [mode,setMode] = useState<"summary"|"source"|"files">("summary");
  const [selectedQuote,setSelectedQuote] = useState("");
  const reader = useRef<HTMLDivElement>(null);
  const conversation = state.conversations.find(c=>c.id===activeTab.conversationId);
  const memory = state.memories?.find(m=>m.conversationId===activeTab.conversationId);
  const messages = state.messages.filter(m=>m.conversationId===activeTab.conversationId && m.role!=="system");
  const children = state.conversations.filter(c=>c.parentId===activeTab.conversationId && !c.archived);
  const artifacts = state.artifacts.filter(a=>a.conversationId===activeTab.conversationId);
  const objects = state.objects.filter(o=>o.conversationId===activeTab.conversationId && !o.seed);
  const artifact = state.artifacts.find(a=>a.id===activeTab.artifactId && a.conversationId===activeTab.conversationId);
  const app = state.apps.find(a=>a.id===activeTab.appId);
  const Panel = app ? appPanels[`../apps/${app.panel.entry}`]?.default : undefined;
  const appObject = state.objects.find(o=>o.conversationId===activeTab.conversationId && o.appId===activeTab.appId && (!activeTab.objectId || o.id===activeTab.objectId)) || null;
  const summary = memory?.summary || conversation?.summary;
  const recap = memory?.recap?.nodes || [];
  const recentQuestions = messages.filter(m=>m.role==="user").slice(-3);
  useEffect(()=>{setMode(activeTab.messageId?"source":"summary");setSelectedQuote("");reader.current?.scrollTo({top:0});},[activeTab.id,activeTab.messageId]);
  useEffect(()=>{
    if (mode === "source" && activeTab.messageId) reader.current?.querySelector(`[data-message-id="${CSS.escape(activeTab.messageId)}"]`)?.scrollIntoView({block:"center"});
  },[mode,activeTab.messageId]);
  function reference(quote?:string,messageId?:string) {
    onReference({conversationId:activeTab.conversationId,...(activeTab.artifactId?{artifactId:activeTab.artifactId}:{}),...(activeTab.appId?{appId:activeTab.appId}:{}),...(activeTab.objectId?{objectId:activeTab.objectId}:{}),...(messageId?{messageId}:{}),...(quote?{quote:quote.slice(0,4000)}:{})});
    setSelectedQuote("");window.getSelection()?.removeAllRanges();
  }
  const open = (kind:"conversation"|"artifact"|"app", id:string, extra: Record<string,string>={})=>onAction({action:"open",kind,conversationId:id,...extra});
  return <aside className="next-workspace" aria-label="工作区">
    <header className="next-workspace-top"><span><Layers size={15}/>工作区</span><IconButton label="关闭工作区" onClick={onHide}><PanelRightClose size={16}/></IconButton></header>
    <nav className="next-tabs" aria-label="已打开的内容">{workspace.tabs.map(tab=><div key={tab.id} className={`next-tab ${tab.id===activeTab.id?"active":""}`}><button aria-pressed={tab.id===activeTab.id} onClick={()=>void onAction({action:"activate",tabId:tab.id})}>{tab.kind==="artifact"?<FileText size={14}/>:tab.kind==="app"?<Layers size={14}/>:<MessageSquare size={14}/>}<span>{tab.title}</span></button><IconButton label={`关闭 ${tab.title}`} onClick={()=>void onAction({action:"close",tabId:tab.id})}><X size={12}/></IconButton></div>)}</nav>
    <div className="next-workspace-reader" ref={reader} onMouseUp={()=>{
      const selection=window.getSelection();
      if(selection?.anchorNode && selection.focusNode && reader.current?.contains(selection.anchorNode) && reader.current.contains(selection.focusNode))setSelectedQuote(selection.toString().trim().slice(0,4000));
    }}>
      <div className="next-content-heading"><div className="next-content-meta">{activeTab.kind==="artifact"?"保存的内容":activeTab.kind==="app"?"应用":"历史对话"}<span> / </span>{conversation?.project || "个人空间"}</div><h2>{activeTab.title}</h2>{activeTab.kind==="conversation"&&<p>{messages.filter(m=>m.role==="user").length} 轮讨论{children.length>0?` · ${children.length} 个分支`:""}{conversation?.showcase?" · 示例资料":""}</p>}</div>
      {activeTab.kind==="conversation"?<>
        <nav className="next-content-modes" aria-label="对话内容"><button aria-pressed={mode==="summary"} onClick={()=>setMode("summary")}>讨论提要</button><button aria-pressed={mode==="source"} onClick={()=>setMode("source")}>原始对话</button><button aria-pressed={mode==="files"} onClick={()=>setMode("files")}>相关内容{artifacts.length+objects.length>0&&<span>{artifacts.length+objects.length}</span>}</button></nav>
        {mode==="summary"?<div className="next-summary">
          <section className="next-summary-lead"><span className="next-section-label">上次聊到了这里</span><RichText>{summary || "这段讨论还没有生成提要，可以先查看原始对话。"}</RichText></section>
          {recap.length>0&&<section className="next-summary-nodes"><span className="next-section-label">讨论脉络</span>{recap.map((node,i)=><button key={node.id} onClick={()=>setMode("source")}><span className="next-node-index">{String(i+1).padStart(2,"0")}</span><span><strong>{node.title}</strong><p>{node.takeaway || node.summary}</p></span><ChevronRight size={14}/></button>)}</section>}
          {recentQuestions.length>0&&<section className="next-recent-questions"><span className="next-section-label">最近的问题</span>{recentQuestions.map(message=><button key={message.id} onClick={()=>{setMode("source");setTimeout(()=>reader.current?.querySelector(`[data-message-id="${CSS.escape(message.id)}"]`)?.scrollIntoView({block:"center",behavior:"smooth"}),30);}}><MessageSquare size={14}/><span>{message.content}</span><ArrowUpRight size={13}/></button>)}</section>}
          {children.length>0&&<section className="next-branches"><span className="next-section-label">从这里展开的讨论</span>{children.map(child=><button key={child.id} onClick={()=>void open("conversation",child.id)}><GitBranch size={15}/><span>{child.title}</span><ArrowUpRight size={14}/></button>)}</section>}
          {conversation?.showcase && <p className="next-source-notice">{conversation.showcase.notice}</p>}
        </div>:mode==="source"?<div className="next-source-messages">{messages.length?messages.map(message=><article key={message.id} data-message-id={message.id} className={`next-source-message ${message.role}`}><div className="next-source-speaker"><strong>{message.role==="user"?"你":"Orbit"}</strong><button onClick={()=>reference(message.content,message.id)}><Quote size={12}/>引用</button></div><RichText>{message.content}</RichText></article>):<p className="next-empty-content">这段对话还没有消息。</p>}</div>:<div className="next-related-content">{artifacts.map(a=><button key={a.id} onClick={()=>void open("artifact",a.conversationId,{artifactId:a.id})}><FileText size={19}/><span><strong>{a.title}</strong><small>文档 · {new Date(a.updatedAt).toLocaleDateString("zh-CN")}</small></span><ArrowUpRight size={15}/></button>)}{objects.map(o=><button key={o.id} onClick={()=>void open("app",o.conversationId,{appId:o.appId,objectId:o.id})}><Layers size={19}/><span><strong>{o.title}</strong><small>{state.apps.find(a=>a.id===o.appId)?.name || "应用"}</small></span><ArrowUpRight size={15}/></button>)}{!artifacts.length&&!objects.length&&<div className="next-empty-content"><FileText size={28}/><h3>把讨论变成一份内容</h3><p>让 Orbit 整理方案、结论或待办，<br/>保存后会出现在这里。</p><button onClick={()=>onReference({conversationId:activeTab.conversationId},"把这段讨论整理成一份简洁的方案，保留已确定的内容和待解决的问题，保存并打开在工作区。")}>回到主对话整理 <ArrowUpLeft size={14}/></button></div>}</div>}
      </>:activeTab.kind==="artifact"&&artifact?<div className="next-artifact"><div className="next-artifact-toolbar"><span><Check size={13}/>已保存到这段讨论</span><button onClick={()=>download(artifact)}><Download size={14}/>下载</button></div><RichText>{artifact.content.startsWith(`# ${artifact.title}\n`)?artifact.content.slice(artifact.title.length+3).trim():artifact.content}</RichText></div>:activeTab.kind==="app"&&Panel&&conversation?<div className="next-app-panel"><Panel key={activeTab.id} snapshot={state} work={conversation} object={appObject} objects={state.objects} onUpdate={async(object,data)=>{await request(`/objects/${object.id}`,"PATCH",{data,version:object.version});await onRefresh();}} onSend={text=>onReference({conversationId:conversation.id,appId:activeTab.appId,...(activeTab.objectId?{objectId:activeTab.objectId}:{})},text)} onOpenApp={(appId,objectId)=>void open("app",conversation.id,{appId,...(objectId?{objectId}:{})})} onNavigate={id=>void open("conversation",id)} onDemoEvent={async()=>{throw new Error("请在主对话中描述要更新的内容");}}/></div>:<p className="next-empty-content">这份内容暂时无法打开，可以回到历史对话查看。</p>}
    </div>
    <footer className="next-workspace-footer">{selectedQuote?<><span>已选中 {selectedQuote.length} 字</span><button className="next-continue" onMouseDown={event=>event.preventDefault()} onClick={()=>reference(selectedQuote)}><Quote size={14}/>引用到主对话</button></>:<><button className="next-reference" onClick={()=>reference(artifact?.content || (activeTab.kind==="app" ? undefined : summary))}><Quote size={14}/>引用内容</button><button className="next-continue" onClick={()=>reference()}><ArrowUpLeft size={15}/>围绕这件事继续</button></>}</footer>
  </aside>;
}
