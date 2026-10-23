import { useEffect, useState } from 'react';
import { ArrowUpRight, MessageCircle } from 'lucide-react';
import { useWorkspaceRequest } from '../api.ts';
import type { WechatTopic } from '../../shared/wechat-personal.ts';
export default function WechatTopicNotice({ onOpen }: { onOpen(): void }) {
  const request = useWorkspaceRequest();
  const [topics, setTopics] = useState<WechatTopic[]>([]);
  useEffect(() => { let alive = true; const load = () => { void request<WechatTopic[]>('/wechat/topics').then(value => { if (alive) setTopics(value); }).catch(() => {}); }; load(); const timer = setInterval(load, 15000); window.addEventListener('orbit-wechat-topics-changed', load); return () => { alive = false; clearInterval(timer); window.removeEventListener('orbit-wechat-topics-changed', load); }; }, []);
  if (!topics.length) return null;
  return <button className="wx-home-notice" onClick={onOpen}><MessageCircle size={15}/><span><small>微信 · 新变化</small><strong>{topics[0]!.title}</strong></span>{topics.length > 1 && <small>另有 {topics.length - 1} 条</small>}<ArrowUpRight size={14}/></button>;
}
