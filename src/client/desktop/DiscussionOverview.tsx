import ContextCards from "./ContextCards.tsx";
import { ArrowUpRight, FileText, X } from "lucide-react";
import { useState } from "react";
import type { Conversation, Snapshot } from "../../shared/types.ts";
import type { AssistantWorkspaceTab } from "../../shared/assistant.ts";
import { recapNodes } from "../../shared/recap.ts";
import { plainSummary } from "./workspace-state.ts";

/** A reading aid for the current discussion, never a second chat or an execution surface. */
export default function DiscussionOverview({ data, conversation, onClose, onLocate, onResource, onOpen }: {
  data: Snapshot; conversation: Conversation; onClose(): void;
  onOpen(id:string,messageId?:string):void; onLocate(messageId: string): void; onResource(tab: AssistantWorkspaceTab): void;
}) {
  const [all, setAll] = useState(false);
  const memory = data.memories?.find(item => item.conversationId === conversation.id);
  const nodes = recapNodes(conversation, data.messages, memory, data.conversations, new Set());
  const summary = plainSummary(memory?.summary || conversation.summary || "", 260);
  const files = data.artifacts.filter(item => item.conversationId === conversation.id);
  const sources = [...new Map(data.runs.filter(r => r.conversationId === conversation.id).flatMap(r => r.contextSources || []).filter(s => s.conversationId !== conversation.id).map(s => [s.conversationId, s])).values()];
  const shown = all ? nodes : nodes.slice(-5);
  return <aside className="dt-reference-pane dt-discussion-overview" aria-label="对话概览" onKeyDown={event => {
    if (event.key === "Escape") { event.stopPropagation(); onClose(); }
  }}>
    <header className="dt-pane-header"><strong>对话概览</strong><button className="dt-icon" aria-label="关闭对话概览" onClick={onClose}><X size={16}/></button></header>
    <div className="dt-overview-reader">
      <div className="dt-map-root"><span className="dt-map-root-dot"/><h2>{conversation.title}</h2>
      {summary && <p className="dt-overview-summary-text">{summary}</p>}</div>
      {!nodes.length && <p className="dt-overview-empty">还没有讨论内容，聊过的内容会在这里留下回顾。</p>}
      {!!nodes.length && <section className="dt-discussion-map" aria-label="讨论导图"><ol>{shown.map(node => <li key={node.id}><button onClick={() => onLocate(node.rounds[0].messages[0].id)} title="回到这段原文"><span><strong>{plainSummary(node.question, 64)}</strong>{node.summarized && <small>{plainSummary(node.takeaway || node.answer, 90)}</small>}</span><ArrowUpRight size={12}/></button></li>)}</ol>{nodes.length > 5 && <button className="dt-overview-earlier" onClick={() => setAll(value => !value)}>{all ? "只看最近讨论" : "查看更早的讨论"}</button>}</section>}
      <ContextCards sources={sources} data={data} onOpen={onOpen} compact/>
      {!!files.length && <section aria-label="相关资料"><h3>相关资料</h3>{files.map(file => <button className="dt-overview-file" key={file.id} onClick={() => onResource({id:`artifact:${file.id}`, kind:"artifact", conversationId:conversation.id, artifactId:file.id, title:file.title})}><FileText size={14}/><span>{file.title}</span><ArrowUpRight size={12}/></button>)}</section>}
    </div>
  </aside>;
}
