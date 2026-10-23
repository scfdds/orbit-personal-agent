import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, ArrowUpRight, ChevronDown, MessageSquare, Plus, Square, X } from 'lucide-react';
import type { Snapshot, SurfaceContext, Conversation } from '../shared/types.ts';
import { request } from './api.ts';
import { RichText } from './ChatView.tsx';
import { IconButton } from './ui.tsx';

interface Props {
  state: Snapshot;
  streams: Record<string, {runId: string; text: string}>;
  context: SurfaceContext;
  contextLabel: string;
  onOpen: (id: string) => void;
  onRefresh: () => Promise<void>;
  onError: (error: string) => void;
}
/** A separate conversation per global surface; no dependency on the hidden chat selection. */
export default function FloatingComposer(p: Props) {
  const [conversationId, setConversationId] = useState<string>();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [attached, setAttached] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const locked = useRef(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  function closeComposer() {
    setComposerOpen(false);
    requestAnimationFrame(() => launcher.current?.focus({ preventScroll: true }));
  }
  useLayoutEffect(() => {
    if (!composerOpen || !textarea.current) return;
    textarea.current.style.height = 'auto';
    textarea.current.style.height = `${Math.min(120, textarea.current.scrollHeight)}px`;
  }, [composerOpen, draft]);
  useEffect(()=>setAttached(true),[p.contextLabel,p.context.messageId,p.context.conversationId,p.context.sectionId,p.context.workId,p.context.appId]);
  const hasReference = attached && Boolean(p.context.sectionId || p.context.conversationId || p.context.workId || p.context.appId);
  const active = p.state.runs.find(r=>r.conversationId===conversationId&&!r.parentId&&['running','queued'].includes(r.status));
  const stream = conversationId ? p.streams[conversationId]?.text : '';
  const lastReply = p.state.messages.filter(m=>m.conversationId===conversationId&&m.role==='assistant').at(-1);
  const response = stream || (active && lastReply?.runId !== active.id ? undefined : lastReply?.content);
  const lastRequest = p.state.messages.filter(m=>m.conversationId===conversationId&&m.role==='user').at(-1)?.content;
  useEffect(()=>{
    const read=()=>{
      if(composerOpen && replyOpen && lastReply && !document.hidden && p.state.conversations.find(c=>c.id===conversationId)?.unread)
        void request(`/conversations/${conversationId}`, 'PATCH', {unread:false}).then(p.onRefresh).catch(()=>{});
    };
    read();document.addEventListener('visibilitychange',read);
    return ()=>document.removeEventListener('visibilitychange',read);
  },[composerOpen,replyOpen,lastReply?.id,p.state.conversations.find(c=>c.id===conversationId)?.unread]);
  async function submit() {
    if (!draft.trim() || locked.current) return;
    locked.current=true;setBusy(true);
    const content=draft.trim();setDraft('');setReplyOpen(true);
    try {
      let id=conversationId;
      if(!id || !p.state.conversations.some(c=>c.id===id)) {
        const created=await request<Conversation>('/conversations','POST',{title:content.slice(0,32)});
        id=created.id;setConversationId(id);
      }
      await request(`/conversations/${id}/messages`,'POST',{content,surface:attached?p.context:{view:p.context.view}});
      await p.onRefresh();
    }catch(e){setDraft(content);p.onError((e as Error).message);}
    finally{locked.current=false;setBusy(false);}
  }
  return <div className={`floating-assistant ${composerOpen?'':'assistant-collapsed'}`} aria-label="页面助手">
    {!composerOpen?<button ref={launcher} className="floating-assistant-launcher" aria-expanded="false" onClick={()=>{setComposerOpen(true);if(response||active)setReplyOpen(true);requestAnimationFrame(()=>textarea.current?.focus());}}><MessageSquare size={15}/><span>{active||busy?'Orbit 正在处理…':response?'查看 Orbit 回复':'向 Orbit 提问'}</span>{p.state.conversations.find(c=>c.id===conversationId)?.unread&&<i className="unread-dot"/>}</button>:<>
    {conversationId && (response||active||busy) && <div className={`floating-reply ${replyOpen?'open':''}`}>
      <div className="floating-reply-header"><button onClick={()=>setReplyOpen(!replyOpen)}><MessageSquare size={14}/><span>{active?'Orbit 正在处理':'最近一条回复'}</span><ChevronDown size={13} className={replyOpen?'':'flipped'}/></button><IconButton label="开始新的提问" onClick={()=>{setConversationId(undefined);setReplyOpen(false);textarea.current?.focus();}}><Plus size={15}/></IconButton><IconButton label="打开完整对话" onClick={()=>p.onOpen(conversationId)}><ArrowUpRight size={15}/></IconButton></div>
      {replyOpen && <div className="floating-reply-body"><p className="floating-request">{lastRequest}</p>{response?<RichText>{response}</RichText>:<p className="muted">正在思考…</p>}</div>}
    </div>}
    <form className="floating-composer" onSubmit={e=>{e.preventDefault();void submit();}} onKeyDown={e=>{if(e.key==='Escape'&&!e.nativeEvent.isComposing){e.preventDefault();closeComposer();}}}>
      <div className="floating-context"><span className="floating-surface-label">{p.context.view==='memory'?'对话纪要':p.context.view==='overview'?'长期目标':'应用中心'}</span>{hasReference&&<button title="移除引用" onClick={()=>setAttached(false)} type="button"><span>{p.contextLabel}</span><X size={11}/></button>}<IconButton label="收起提问框" className="floating-collapse" onClick={closeComposer}><ChevronDown size={14}/></IconButton></div>
      <div className="floating-input-row"><textarea ref={textarea} aria-label="向 Orbit 提问" placeholder="向 Orbit 提问…" rows={1} value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void submit();}}}/>{active&&!draft.trim()?<IconButton label="停止本次提问" className="send-button" onClick={()=>void request(`/conversations/${conversationId}/stop`,'POST',{}).then(p.onRefresh).catch(e=>p.onError(e.message))}><Square size={13}/></IconButton>:<button aria-label="发送页面提问" type="submit" className="send-button" disabled={busy||!draft.trim()}><ArrowUp size={18}/></button>}</div>
    </form>
    </>}
  </div>;
}
