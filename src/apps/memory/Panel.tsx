import { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ChevronRight, LoaderCircle } from 'lucide-react';
import type { AppPanelProps } from '../../client/panel-types.ts';
import { rootOf } from '../../shared/conversation-tree.ts';
import { conversationRounds, validTurn, type DiscussionNode } from '../../shared/discussion.ts';
import { request } from '../../client/api.ts';
import { IconButton } from '../../client/ui.tsx';
import { SurfaceHeader, SurfaceSearch } from '../../client/SurfaceHeader.tsx';
import MindMap from './MindMap.tsx';
import SourceConversation from './SourceConversation.tsx';
import { recapNodes, recapSource } from '../../shared/recap.ts';
import './memory.css';
import './turn-memory.css';

let expandedPoints=new Set<string>();
export default function MemoryPanel({work,snapshot,memoryScope='all',onMemoryScope,onNavigate,onFork,onSelection}:AppPanelProps) {
  const conversations=useMemo(()=>snapshot?.conversations.filter(c=>!c.archived&&snapshot.messages.some(m=>m.conversationId===c.id&&!m.kind&&m.role!=='system'&&m.content.trim()))||[],[snapshot?.conversations,snapshot?.messages]);
  const messages=snapshot?.messages||[],sections=snapshot?.sections||[],memories=snapshot?.memories||[];
  const [selected,setSelected]=useState(''),[query,setQuery]=useState(''),[detailOpen,setDetailOpen]=useState(false);
  const [expanded,setExpanded]=useState<Set<string>>(()=>expandedPoints);
  const [error,setError]=useState('');
  const [recapPending,setRecapPending]=useState(0),[recapFailed,setRecapFailed]=useState(false),[recapRetry,setRecapRetry]=useState(0);
  const [openedNode,setOpenedNode]=useState<DiscussionNode>();
  const pendingSelection=useRef<string|undefined>(undefined),requested=useRef(new Set<string>());
  const topicMode=memoryScope==='all'||memoryScope.startsWith('section:');
  const topic=topicMode?(sections.find(s=>`section:${s.id}`===memoryScope)||sections[0]):undefined;
  const scoped=useMemo(()=>(topicMode?conversations.filter(c=>c.project===topic?.name):conversations.filter(c=>rootOf(c.id,conversations)===rootOf(memoryScope,conversations))).sort((a,b)=>(a.order??Date.parse(a.createdAt))-(b.order??Date.parse(b.createdAt))),[conversations,memoryScope,topic?.name]);
  const nodes=useMemo(()=>Object.fromEntries(conversations.map(c=>[c.id,recapNodes(c,messages,memories.find(m=>m.conversationId===c.id),snapshot?.conversations||conversations,expanded)])),[conversations,messages,memories,expanded]);
  const node=scoped.flatMap(c=>nodes[c.id]||[]).find(n=>n.id===selected)||(openedNode&&scoped.some(c=>c.id===openedNode.conversationId)?openedNode:undefined);
  const conversation=conversations.find(c=>c.id===node?.conversationId);
  const search=query.trim().toLowerCase();
  const matches=search?conversations.flatMap(c=>(nodes[c.id]||[]).filter(n=>`${c.title} ${c.project} ${n.question} ${n.answer}`.toLowerCase().includes(search))).filter(n=>topicMode||scoped.some(c=>c.id===n.conversationId)):[];
  const title=topic?.name||conversations.find(c=>c.id===rootOf(memoryScope,conversations))?.title||'对话';
  const [overview,setOverview]=useState<{id:string;text:string}>(),[overviewPending,setOverviewPending]=useState(false),[overviewFailed,setOverviewFailed]=useState(false),[overviewRetry,setOverviewRetry]=useState(0);
  const overviewSource=JSON.stringify(scoped.map(c=>[c.id,c.title,conversationRounds(c.id,messages).filter(r=>r.answers.length).map(r=>[r.sourceKey,validTurn(r,memories.find(m=>m.conversationId===c.id)?.discussion?.turns)])]));
  useEffect(()=>{
    setOverviewFailed(false);setOverviewPending(false);
    if(!topic||!snapshot?.configured)return;
    let cancelled=false;setOverviewPending(true);
    const timer=setTimeout(()=>{
      void request<{text:string}>(`/sections/${topic.id}/overview`,'POST',{}).then(result=>{if(!cancelled)setOverview({id:topic.id,text:result.text});}).catch(()=>{if(!cancelled)setOverviewFailed(true);}).finally(()=>{if(!cancelled)setOverviewPending(false);});
    },300);
    return ()=>{cancelled=true;clearTimeout(timer);};
  },[topic?.id,overviewSource,snapshot?.configured,overviewRetry]);
  const topicOverview=topic?(overview?.id===topic.id?overview.text:topic.overview?.text):undefined;
  useEffect(()=>{setError('');},[selected]);
  useEffect(()=>{
    if(topicMode&&topic&&memoryScope!==`section:${topic.id}`){onMemoryScope?.(`section:${topic.id}`);return;}
    const id=pendingSelection.current;pendingSelection.current=undefined;setSelected(id||'');setDetailOpen(!!id);setOpenedNode(undefined);setError('');setQuery('');
    if(!id)onSelection?.(undefined);
  },[memoryScope,work.id,topic?.id]);
  useEffect(()=>{
    if(!snapshot?.configured)return;
    for(const c of scoped){
      if(c.status==='running')continue;
      const source=recapSource(c.id,messages,snapshot?.conversations||conversations);
      if(!source.rounds.length||memories.find(m=>m.conversationId===c.id)?.recap?.sourceKey===source.key)continue;
      const key=`${c.id}:${source.key}:${recapRetry}`;
      if(requested.current.has(key))continue;
      requested.current.add(key);setRecapPending(n=>n+1);
      void request(`/conversations/${c.id}/recap`,'POST',{}).catch(()=>setRecapFailed(true)).finally(()=>setRecapPending(n=>n-1));
    }
  },[scoped,messages,memories,snapshot?.configured,recapRetry]);
  function close(){setDetailOpen(false);setSelected('');setOpenedNode(undefined);setError('');onSelection?.(undefined);}
  function openScope(scope:string){close();setQuery('');onMemoryScope?.(scope);}
  function showNode(n:DiscussionNode){setSelected(n.id);setOpenedNode(n);onSelection?.(n.conversationId,n.rounds.at(-1)?.messages.at(-1)?.id);setError('');setDetailOpen(true);}
  function searchResult(n:DiscussionNode){const c=conversations.find(c=>c.id===n.conversationId)!;const section=sections.find(s=>s.name===c.project);if(topicMode&&section&&section.id!==topic?.id){pendingSelection.current=n.id;openScope(`section:${section.id}`);}showNode(n);setQuery('');}
  function expand(id:string){setExpanded(prev=>{const next=new Set(prev);if(next.has(id))next.delete(id);else next.add(id);expandedPoints=next;return next;});setSelected('');setOpenedNode(undefined);setDetailOpen(false);onSelection?.(undefined);}
  return <div className="memory-app turn-memory-app">
    <SurfaceHeader title="对话纪要" trail={!topicMode&&<><ChevronRight size={13}/><span className="memory-family-title" title={title}>{title}</span></>}>
      {recapPending>0&&<LoaderCircle size={14} className="turn-loading" aria-label="正在整理讨论脉络"/>}{recapFailed&&recapPending===0&&<IconButton label="重试整理讨论" onClick={()=>{setRecapFailed(false);setRecapRetry(n=>n+1);}}><RefreshCw size={14}/></IconButton>}
      <SurfaceSearch label="搜索问题或回答" placeholder="搜索问题或回答…" value={query} onChange={setQuery}/>
    </SurfaceHeader>
    {topicMode&&<nav className="surface-filterbar" aria-label="话题"><div className="surface-tabs" role="tablist" aria-label="对话话题">{sections.map(section=><button key={section.id} role="tab" aria-selected={section.id===topic?.id} tabIndex={section.id===topic?.id?0:-1} className={section.id===topic?.id?'active':''} onClick={()=>openScope(`section:${section.id}`)} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const at=sections.findIndex(s=>s.id===section.id),index=e.key==='Home'?0:e.key==='End'?sections.length-1:(at+(e.key==='ArrowRight'?1:-1)+sections.length)%sections.length;openScope(`section:${sections[index]!.id}`);(e.currentTarget.parentElement?.children[index] as HTMLElement)?.focus();}}>{section.name}</button>)}</div></nav>}
    {error&&!detailOpen&&<p className="memory-error" role="alert">{error}</p>}
    <div className={`memory-body memory-review-layout ${detailOpen&&node?'has-source':''} ${topicMode?'memory-topic-layout':''}`}><div className="memory-topic-content">
      {search?<div className="conversation-search-results" aria-label="问答搜索结果">{matches.length?matches.map(n=><button key={n.id} onClick={()=>searchResult(n)}><span><small>{conversations.find(c=>c.id===n.conversationId)?.title} · 第 {n.rounds[0]?.ordinal} 轮</small><strong>{n.question}</strong><p>{n.answer}</p></span><ChevronRight size={15}/></button>):<p className="memory-empty">没有找到相关问答</p>}</div>:<MindMap key={memoryScope} viewKey={memoryScope} overview={topicOverview} overviewPending={overviewPending} overviewFailed={overviewFailed} onRetryOverview={()=>setOverviewRetry(n=>n+1)} conversations={scoped} nodes={nodes} selectedId={selected} onSelect={showNode} onExpand={expand}/>}
    </div>
    {detailOpen&&node&&conversation&&<SourceConversation node={node} conversation={conversation} messages={messages} onClose={close} onContinue={()=>onNavigate?.(conversation.id)} onFork={messageId=>onFork?.(conversation.id,messageId)}/>}
    </div>
  </div>;
}
