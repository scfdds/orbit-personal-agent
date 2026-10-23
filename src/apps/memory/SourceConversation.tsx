import { useLayoutEffect, useRef } from 'react';
import { ArrowUpRight, GitBranch, X } from 'lucide-react';
import type { Conversation, Message } from '../../shared/types.ts';
import type { DiscussionNode } from '../../shared/discussion.ts';
import { conversationRounds } from '../../shared/discussion.ts';
import { RichText } from '../../client/ChatView.tsx';
import { IconButton } from '../../client/ui.tsx';

export default function SourceConversation({ node, conversation, messages, onClose, onContinue, onFork }: {
  node: DiscussionNode; conversation: Conversation; messages: Message[];
  onClose: () => void; onContinue: () => void; onFork: (messageId: string) => void;
}) {
  const reader = useRef<HTMLDivElement>(null);
  const rounds = conversationRounds(conversation.id, messages);
  const sources = new Set(node.rounds.map(r => r.id));
  const first = node.rounds[0]!, last = node.rounds.at(-1)!;
  useLayoutEffect(() => {
    const el = reader.current, target = el?.querySelector<HTMLElement>('[data-source="true"]');
    if (el && target) el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top - 20;
  }, [node.id, conversation.id]);
  return <aside className="source-conversation" aria-label="原始对话" onKeyDown={e => { if(e.key === 'Escape') onClose(); }}>
    <header className="source-conversation-header">
      <div><h2>{conversation.title}</h2><span>原始对话 · 第 {first.ordinal}{last.ordinal !== first.ordinal ? `–${last.ordinal}` : ''} 轮</span></div>
      <IconButton label="关闭原始对话" onClick={onClose}><X size={16}/></IconButton>
    </header>
    <div ref={reader} className="source-conversation-scroll" tabIndex={0}>
      {rounds.map(round => <section className={`source-round ${sources.has(round.id) ? 'source-round-selected' : ''}`} data-source={sources.has(round.id)} key={round.id} aria-label={`第 ${round.ordinal} 轮${sources.has(round.id) ? ' · 当前节点来源' : ''}`}>
        {round.messages.map(message => <div className={`source-message source-message-${message.role}`} key={message.id}>
          <span className="source-speaker">{message.role === 'user' ? '你' : 'Orbit'}</span>
          <RichText>{message.content}</RichText>
        </div>)}
      </section>)}
    </div>
    <footer className="source-conversation-actions">
      <button className="button primary" onClick={onContinue}>继续对话 <ArrowUpRight size={14}/></button>
      <button className="button secondary" onClick={() => onFork(last.messages.at(-1)!.id)}><GitBranch size={14}/>从这里分支</button>
    </footer>
  </aside>;
}
