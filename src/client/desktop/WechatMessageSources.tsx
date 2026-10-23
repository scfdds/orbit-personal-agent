import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import WechatAvatar from './WechatAvatar.tsx';

type MessageSource = { id: string; sender: string; text: string; timestamp: string; chatId?: string; direction?: string };
type Group = { sender: string; messages: MessageSource[] };
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const clock = (value: string) => new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

function groupMessages(sources: MessageSource[], fallback: string): Group[] {
  const groups: Group[] = [];
  for (const message of sources) {
    const sender = message.sender.trim() || fallback;
    const last = groups.at(-1), previous = last?.messages.at(-1);
    const gap = previous ? new Date(message.timestamp).getTime() - new Date(previous.timestamp).getTime() : Infinity;
    // Merge adjacent messages only; preserve the source order and every original text.
    if (message.sender.trim() && last?.sender === sender && previous?.chatId === message.chatId && previous?.direction === message.direction && gap >= 0 && gap <= 10 * 60_000) last.messages.push(message);
    else groups.push({ sender, messages: [message] });
  }
  return groups;
}

export default function WechatMessageSources({ sources, fallbackSender = '微信', demo, compact = true, label = '相关消息' }: {
  sources: MessageSource[]; fallbackSender?: string; demo: boolean; compact?: boolean; label?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  if (!sources.length) return null;
  const visible = compact && !expanded ? sources.slice(0, 2) : sources;
  return <div className="wx-message-sources">
    {label && <span className="wx-source-label">{label}</span>}
    <div className="wx-source-messages" id={listId}>{groupMessages(visible, fallbackSender).map(group => {
      const first = group.messages[0]!, last = group.messages.at(-1)!;
      const start = date(first.timestamp), end = date(last.timestamp);
      const range = start === end ? start : `${start}–${new Date(first.timestamp).toDateString() === new Date(last.timestamp).toDateString() ? clock(last.timestamp) : end}`;
      return <div className="wx-source-message" key={first.id}>
        <WechatAvatar name={group.sender} demo={demo} size={26}/>
        <div className="wx-source-message-body"><header><strong>{group.sender}</strong><time dateTime={first.timestamp}>{range}</time></header>
          {group.messages.map(message => <blockquote key={message.id}><p>{message.text}</p></blockquote>)}
        </div>
      </div>;
    })}</div>
    {compact && sources.length > 2 && <button className="wx-sources-more" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(value => !value)}>{expanded ? '收起' : `另外 ${sources.length - 2} 条消息`}<ChevronDown size={12}/></button>}
  </div>;
}
