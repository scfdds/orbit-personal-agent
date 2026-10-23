import { ArrowUpRight, MessageSquare } from "lucide-react";
import type { ContextSource, Snapshot } from "../../shared/types.ts";
import "./context-cards.css";

/** Provenance is available on request; it never interrupts the main answer. */
export default function ContextCards({ sources, data, onOpen }: {
  sources: ContextSource[]; data: Snapshot; onOpen(id:string, messageId?:string):void; compact?:boolean;
}) {
  if (!sources.length) return null;
  return <details className="dt-context-details">
    <summary>参考过的讨论 <span>{sources.length}</span></summary>
    <div className="dt-context-list">{sources.map(source => {
      const available = data.conversations.some(c => c.id === source.conversationId && !c.archived) && data.messages.some(m => m.id === source.messageId && m.conversationId === source.conversationId);
      return <button className="dt-context-reference" key={`${source.conversationId}:${source.messageId}`} disabled={!available} aria-label={`查看原文：${source.title}`} onClick={() => onOpen(source.conversationId, source.messageId)}>
        <MessageSquare size={13}/><span>{source.title}</span><ArrowUpRight size={12}/>
      </button>;
    })}</div>
  </details>;
}
