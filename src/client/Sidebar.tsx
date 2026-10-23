import { GoalIcon } from "./GoalIcon.tsx";
import { useEffect, useState } from 'react';
import { Plus, Search, LayoutGrid, PanelLeftClose, Ellipsis, MessagesSquare, ChevronRight, Pin, UserRound, Pencil, Trash2, GripVertical, Compass, Info, X, Laptop, Play } from 'lucide-react';
import { IconButton, Modal } from './ui.tsx';
import type { Snapshot, Conversation, ConversationSection } from '../shared/types.ts';
export type View = 'task' | 'overview' | 'apps' | 'memory' | 'start' | 'devices';
interface Props {
  preview?: boolean; onGuide: () => void;
  state: Snapshot; selectedId: string; view: View;
  onView: (view: View) => void; onSelect: (id: string) => void;
  onOpenTopic: (id: string) => void; activeTopicId?: string;
  onNew: (section?: string) => void; onSearch: () => void; onCollapse: () => void; onAbout: () => void;
  onMutation: (path: string, method: string, body?: unknown) => Promise<unknown>;
}
type Menu = { kind: 'section' | 'conversation'; id: string; x: number; y: number };
export default function Sidebar(p: Props) {
  const conversations = p.state.conversations.filter(c => !c.archived && !c.draft);
  const sections = p.preview ? [...(p.state.sections || [])].sort((a,b) => Number(b.name === "应用示例") - Number(a.name === "应用示例")) : p.state.sections || [];
  const [accountOpen, setAccountOpen] = useState(false);
  const [guideHint, setGuideHint] = useState(() => { try { return !p.preview && !localStorage.getItem('orbit.guide.seen'); } catch { return false; } });
  const dismissGuideHint = () => { setGuideHint(false); try { localStorage.setItem('orbit.guide.seen', 'true'); } catch {} };
  useEffect(() => {
    if (!accountOpen) return;
    const close = () => setAccountOpen(false);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); document.querySelector<HTMLButtonElement>('.sidebar-footer')?.focus(); } };
    document.addEventListener('click', close); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', key); };
  }, [accountOpen]);
  const [folded, setFolded] = useState<string[]>(() => { if (p.preview) return sections.filter(s=>s.name!=='应用示例').map(s=>s.id); try { return JSON.parse(localStorage.getItem('orbit.sections.folded') || 'null') || []; } catch { return []; } });
  const [menu, setMenu] = useState<Menu | null>(null);
  const [edit, setEdit] = useState<{ kind: 'section' | 'conversation' | 'create'; id: string; value: string } | null>(null);
  const [removing, setRemoving] = useState<Menu | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState<{ kind: string; id: string } | null>(null);
  const [over, setOver] = useState('');
  useEffect(() => { if (!p.preview) localStorage.setItem('orbit.sections.folded', JSON.stringify(folded)); }, [folded, p.preview]);
  useEffect(() => {
    if(p.preview || !sections.length || localStorage.getItem('orbit.sections.initialized')) return;
    setFolded(sections.filter(s=>s.name==='之前的对话').map(s=>s.id));
    localStorage.setItem('orbit.sections.initialized','true');
  },[sections.length]);
  useEffect(() => {
    if (!menu) return;
    const dismiss = () => setMenu(null);
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    document.addEventListener('click', dismiss); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('click', dismiss); document.removeEventListener('keydown', escape); };
  }, [menu]);
  useEffect(() => {
    if (p.view === 'task') {
      const section = sections.find(s => s.name === conversations.find(c => c.id === p.selectedId)?.project);
      if (section) setFolded(prev => prev.filter(id => id !== section.id));
    }
  }, [p.selectedId, p.view]);
  function openMenu(e: React.MouseEvent, kind: Menu['kind'], id: string) {
    e.preventDefault(); e.stopPropagation();
    setMenu({ kind, id, x: Math.min(e.clientX, window.innerWidth - 182), y: Math.min(e.clientY, window.innerHeight - 145) });
  }
  async function apply(path: string, method: string, body?: unknown) {
    setBusy(true);
    try { await p.onMutation(path, method, body); setEdit(null); setRemoving(null); }
    catch {} finally { setBusy(false); }
  }
  function drop(e: React.DragEvent, section: ConversationSection, beforeId?: string) {
    e.preventDefault(); e.stopPropagation(); setOver('');
    if (!dragging) return;
    if (dragging.kind === 'section') {
      const rect=e.currentTarget.getBoundingClientRect();
      const remaining=sections.filter(s=>s.id!==dragging.id);
      const beforeId=e.clientY>rect.top+rect.height/2 ? remaining[remaining.findIndex(s=>s.id===section.id)+1]?.id : section.id;
      if(dragging.id!==section.id) void apply(`/sections/${dragging.id}/reorder`, 'POST', {beforeId});
    }
    else void apply(`/conversations/${dragging.id}/move`, 'POST', { sectionId: section.id, beforeId });
    setDragging(null);
  }
  function begin(e: React.DragEvent, kind: string, id: string) {
    setMenu(null); setDragging({ kind, id }); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id);
  }
  const item = menu?.kind === 'section' ? sections.find(s => s.id === menu.id) : conversations.find(c => c.id === menu?.id);
  return <aside className="sidebar">
    <div className="sidebar-brand"><button className="brand" onClick={() => p.onView('task')}><span>Orbit</span></button><IconButton label="收起侧边栏" onClick={p.onCollapse}><PanelLeftClose size={17}/></IconButton></div>
    <nav className="main-nav" aria-label="主导航" data-tour="global-nav">
      <button className={`new-work ${p.view==='start'?'active':''}`} onClick={() => p.onNew()}><Plus size={18}/><span>新对话</span></button>
      {([{view:'overview',label:'长期目标',icon:GoalIcon},{view:'apps',label:'应用中心',icon:LayoutGrid},{view:'memory',label:'对话纪要',icon:MessagesSquare}] as const).map(n => <button key={n.view} className={p.view===n.view?'active':''} onClick={() => p.onView(n.view)}><n.icon size={18}/><span>{n.label}</span></button>)}
    </nav>
    <div className="work-list" data-tour="conversations">
      <div className="list-label"><span>对话</span><div><IconButton label="新建话题" onClick={() => setEdit({kind:'create',id:'',value:''})}><Plus size={14}/></IconButton><IconButton label="搜索对话" onClick={p.onSearch}><Search size={15}/></IconButton></div></div>
      {sections.map(section => {
        const chats = conversations.filter(c => c.project === section.name).sort((a,b) => (a.order ?? Date.parse(a.createdAt))-(b.order ?? Date.parse(b.createdAt)));
        const closed = folded.includes(section.id);
        return <section key={section.id} className={`conversation-section ${over===section.id?'drop-section':''}`} onDragOver={e => { e.preventDefault(); if(e.target===e.currentTarget) setOver(section.id); }} onDrop={e => drop(e,section)}>
          <div className="section-heading" draggable onDragStart={e => begin(e,'section',section.id)} onDragEnd={() => {setDragging(null);setOver('');}} onContextMenu={e => openMenu(e,'section',section.id)} onDragOver={e => {e.preventDefault();setOver(section.id);}}>
            <button className="section-fold" aria-label={`${closed?'展开':'收起'} ${section.name} 下的对话`} aria-expanded={!closed} onClick={() => setFolded(prev => closed?prev.filter(id=>id!==section.id):[...prev,section.id])}><ChevronRight size={12} className={closed?'':'unfolded'}/></button>
            <button className={`section-toggle ${p.activeTopicId===section.id?'active-topic':''}`} aria-label={`打开话题导图：${section.name}`} aria-current={p.activeTopicId===section.id?'page':undefined} title="查看话题导图" onClick={()=>p.onOpenTopic(section.id)}><span>{section.name}</span>{section.pinned && <Pin size={11} aria-label="已置顶话题"/>}{closed && chats.some(c=>c.unread) && <i className="unread-dot"/>}</button>
            <div className="section-actions"><IconButton label={`在${section.name}中新建对话`} onClick={() => p.onNew(section.name)}><Plus size={13}/></IconButton><IconButton label={`管理话题 ${section.name}`} onClick={e=>openMenu(e,'section',section.id)}><Ellipsis size={14}/></IconButton></div>
          </div>
          {!closed && <div className="section-conversations">{chats.map(c => <div key={c.id} data-conversation-id={c.id} className={`work-row flat-conversation ${p.selectedId===c.id&&p.view==='task'?'selected':''} ${over===c.id?'drop-before':''}`} draggable onDragStart={e => {e.stopPropagation();begin(e,'conversation',c.id);}} onDragEnd={() => {setDragging(null);setOver('');}} onDragOver={e => {if(dragging?.kind==='conversation'){e.preventDefault();e.stopPropagation();setOver(c.id);}}} onDrop={e => drop(e,section,c.id)} onContextMenu={e => openMenu(e,'conversation',c.id)}>
            <button className="work-select" title={c.title} onClick={() => p.onSelect(c.id)}><span className="work-name">{c.title}</span>{c.status==='running'?<span className="conversation-running" aria-label="正在运行"/>:c.unread?<span className="unread-dot" aria-label="未读"/>:null}</button>
            <IconButton label={`对话菜单 ${c.title}`} className="work-menu" onClick={e=>openMenu(e,'conversation',c.id)}><Ellipsis size={14}/></IconButton>
          </div>)}{!chats.length && <div className="section-empty">拖动对话到这里</div>}</div>}
        </section>;
      })}
      {!sections.length && <p className="sidebar-empty">从一段新对话开始</p>}
    </div>
    <div className="sidebar-account" onClick={e=>e.stopPropagation()}>
      {guideHint && !accountOpen && <div className="guide-invitation" role="region" aria-label="演示导览提示"><button className="guide-invitation-close" aria-label="不再提示演示导览" onClick={dismissGuideHint}><X size={13}/></button><Compass size={18}/><strong>认识 Orbit</strong><p>四步了解产品结构</p><button onClick={()=>{dismissGuideHint();p.onGuide();}}>开始导览 <ChevronRight size={13}/></button></div>}
      {accountOpen && <div className="workspace-account-menu" role="menu" aria-label="个人工作空间"><button role="menuitem" aria-current={p.view==='devices'?'page':undefined} onClick={()=>{setAccountOpen(false);p.onView('devices');}}><Laptop size={16}/><span>执行设备</span><ChevronRight size={13}/></button><button role="menuitem" onClick={()=>{setAccountOpen(false);p.onAbout();}}><Info size={16}/><span>关于 Orbit</span></button></div>}
      <div className="sidebar-account-row">
        <button className="sidebar-footer" aria-label="个人工作空间" aria-haspopup="menu" aria-expanded={accountOpen} onClick={()=>{dismissGuideHint();setAccountOpen(!accountOpen);}}><span className="avatar"><UserRound size={18}/></span><span><strong>个人工作空间</strong><small>Orbit Preview</small></span></button>
        <button type="button" className="sidebar-guide-entry" title="演示导览" aria-label="演示导览" onClick={()=>{setAccountOpen(false);dismissGuideHint();p.onGuide();}}><Play size={12} fill="currentColor" aria-hidden="true"/><span>演示</span></button>
      </div>
    </div>
    {menu && item && <div className="sidebar-context-menu" role="menu" style={{left:menu.x,top:menu.y}} onClick={e=>e.stopPropagation()}>
      {menu.kind==='section' && <button role="menuitem" onClick={() => {void apply(`/sections/${menu.id}`,'PATCH',{pinned:!(item as ConversationSection).pinned});setMenu(null);}}><Pin size={14}/>{(item as ConversationSection).pinned?'取消置顶':'置顶话题'}</button>}
      <button role="menuitem" onClick={() => {setEdit({kind:menu.kind,id:menu.id,value:menu.kind==='section'?(item as ConversationSection).name:(item as Conversation).title});setMenu(null);}}><Pencil size={14}/>重命名</button>
      <button role="menuitem" className="danger" onClick={() => {setRemoving(menu);setMenu(null);}}><Trash2 size={14}/>删除{menu.kind==='section'?'话题':'对话'}</button>
    </div>}
    {edit && <Modal title={edit.kind==='create'?'新建话题':'重命名'} onClose={() => !busy&&setEdit(null)}><form className="modal-body form-stack" onSubmit={e=>{e.preventDefault();void apply(edit.kind==='create'?'/sections':`/${edit.kind==='section'?'sections':'conversations'}/${edit.id}`,edit.kind==='create'?'POST':'PATCH',edit.kind==='conversation'?{title:edit.value.trim()}:{name:edit.value.trim()});}}><input autoFocus aria-label="名称" placeholder="话题名称" maxLength={160} value={edit.value} onChange={e=>setEdit({...edit,value:e.target.value})}/><div className="simple-dialog-actions"><button type="button" className="button secondary" onClick={()=>setEdit(null)}>取消</button><button className="button primary" disabled={busy||!edit.value.trim()}>保存</button></div></form></Modal>}
    {removing && <Modal title={removing.kind==='section'?'删除这个话题？':'删除这段对话？'} onClose={()=>!busy&&setRemoving(null)}><div className="modal-body form-stack"><p>{removing.kind==='section'?'其中的对话会移到「未分区」，内容会保留。':'将删除这段对话、摘要和关联目标。由它展开的其他对话会保留。'}</p><div className="simple-dialog-actions"><button className="button secondary" onClick={()=>setRemoving(null)}>取消</button><button className="button primary" disabled={busy} onClick={()=>void apply(`/${removing.kind==='section'?'sections':'conversations'}/${removing.id}`,'DELETE')}>删除</button></div></div></Modal>}
  </aside>;
}
