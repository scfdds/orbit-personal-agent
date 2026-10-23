import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ChevronDown, ChevronRight, LoaderCircle, MessageCircle, Settings2 } from 'lucide-react';
import { useWorkspaceRequest } from '../api.ts';
import OrbitAvatar from './OrbitAvatar.tsx';
import WechatAvatar from './WechatAvatar.tsx';
import WechatMessageSources from './WechatMessageSources.tsx';
import WechatSettings from './WechatSettings.tsx';
import { useWorkspaceMode } from './WorkspaceModeRoot.tsx';
import Dialog from './Dialog.tsx';
import type { ContactView, WechatPersonalState } from '../../shared/wechat-personal.ts';
import type { WechatReadResult } from '../../shared/wechat.ts';
import './wechat-personal.css';

const date = (value: string) => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function WechatPage({ onDiscuss }: { onDiscuss(draft?: string): void }) {
  const request = useWorkspaceRequest();
  const { mode } = useWorkspaceMode();
  const [data, setData] = useState<WechatPersonalState | null>(null);
  const [selected, setSelected] = useState('');
  const [settings, setSettings] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true), generation = useRef(0);
  const load = useCallback(async () => {
    const version = ++generation.current;
    try {
      const next = await request<WechatPersonalState>('/wechat/personal');
      if (!alive.current || version !== generation.current) return;
      setData(next); setSelected(id => next.contacts.some(c => c.id === id) ? id : next.contacts[0]?.id || '');
    } catch (cause) { if (alive.current && version === generation.current) setError((cause as Error).message); }
  }, []);
  useEffect(() => { alive.current = true; void load(); const timer = window.setInterval(() => void load(), 5000); return () => { alive.current = false; clearInterval(timer); }; }, [load]);
  const contact = data?.contacts.find(c => c.id === selected);
  const [detailOpen, setDetailOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const topics = data?.contacts.filter(c => c.enabled && c.topic?.title && c.topic.status !== "dismissed").sort((a,b) => b.topic!.createdAt.localeCompare(a.topic!.createdAt)) || [];
  function inspect(id: string) { setSelected(id); setDetailOpen(true); }
  return <section className="wx-page" aria-label="微信消息">
    <header className="wx-page-header"><div className="wx-page-title"><MessageCircle size={21}/><h1>微信消息</h1><span className="wx-badge">Beta</span></div><div className="wx-header-actions"><button aria-label="微信设置" onClick={() => setSettings(true)}><Settings2 size={15}/>设置</button></div></header>
    {error && <div className="wx-error" role="alert">{error}<button onClick={() => { setError(''); void load(); }}>重试</button></div>}
    {!data ? <div className="wx-loading"><LoaderCircle size={18} className="dt-spin"/>正在读取消息概览…</div> : <div className="wx-dashboard-scroll"><div className="wx-dashboard">
      {!mode.demo && <div className="wx-dashboard-meta"><button className="wx-source-status" onClick={() => setSettings(true)}><i className={data.capture.enabled && data.capture.collector.status === 'listening' ? 'online' : ''}/>{data.capture.enabled ? data.capture.collector.status === 'listening' ? '后台更新中' : '查看采集状态' : '通知读取未开启'}<ChevronRight size={12}/></button></div>}
      <section className="wx-overview-section"><header><h3>值得留意</h3>{topics.length > 0 && <small>{topics.length}</small>}</header>
        {topics.length ? <div className="wx-topic-grid">{topics.slice(0, 3).map(c => <article className="wx-scan-card" key={c.id}><span className="wx-card-source"><WechatAvatar name={c.title} demo={mode.demo} size={28}/><span>{c.title}</span></span><h4>{c.topic!.title}</h4><p>{c.topic!.opener}</p><WechatMessageSources sources={c.topic!.sources} fallbackSender={c.title} demo={mode.demo}/><footer><span>{c.projectName || '近期消息'}</span><button className="wx-text" onClick={() => inspect(c.id)}>查看详情<ArrowUpRight size={13}/></button></footer></article>)}</div> : <div className="wx-overview-empty"><OrbitAvatar size={38}/><div><strong>{data.contacts.some(c => c.context.watching && c.enabled) ? '暂无重要变化' : '尚未开启消息关注'}</strong></div><button className="wx-text" onClick={() => setSettings(true)}>设置关注<Settings2 size={13}/></button></div>}
      </section>
      <section className="wx-overview-section"><header><h3>联系人</h3></header><div className="wx-brief-list">{(showAll ? data.contacts : data.contacts.slice(0, 6)).map(c => <button className="wx-brief-row" key={c.id} onClick={() => inspect(c.id)}><span className="wx-brief-person"><WechatAvatar name={c.title} demo={mode.demo} size={28}/><span>{c.title}</span></span><span className="wx-brief-summary">{c.topic?.summary || c.context.background || '暂无概述'}</span><span className="wx-brief-project">{c.projectName || (c.context.watching && c.enabled ? '关注中' : '未关注')}</span><ChevronRight size={13}/></button>)}</div>{data.contacts.length > 6 && <button className="wx-text wx-more" onClick={() => setShowAll(v => !v)}>{showAll ? '收起' : `展开其余 ${data.contacts.length - 6} 个联系人`}</button>}{!data.contacts.length && <p className="wx-quiet">还没有读取到微信通知。<button className="wx-text" onClick={() => setSettings(true)}>设置读取</button></p>}</section>
    </div></div>}
    {detailOpen && contact && data && <Dialog title={contact.title} onClose={() => setDetailOpen(false)}><ContactDetail key={contact.id} contact={contact} data={data} refresh={load} onDiscuss={onDiscuss}/></Dialog>}
    {settings && <Dialog title="微信设置" onClose={() => { setSettings(false); void load(); }}><WechatSettings captureOnly/></Dialog>}
  </section>;
}

function ContactDetail({ contact, data, refresh, onDiscuss }: { contact: ContactView; data: WechatPersonalState; refresh(): Promise<void>; onDiscuss(draft?: string): void }) {
  const request = useWorkspaceRequest();
  const { mode } = useWorkspaceMode();
  const [editing, setEditing] = useState(false), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const [background, setBackground] = useState(contact.context.background), [projectId, setProjectId] = useState(contact.context.projectId || '');
  const [allowed, setAllowed] = useState(contact.enabled), [watching, setWatching] = useState(contact.context.watching);
  const [messages, setMessages] = useState<WechatReadResult | null>(null), [showMessages, setShowMessages] = useState(false);
  const revision = useRef(contact.context.version);
  const topic = contact.topic;
  async function perform(key: string, task: () => Promise<unknown>) {
    if (busy) return;
    setBusy(key); setError('');
    try { await task(); await refresh(); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(''); }
  }
  function edit() { setBackground(contact.context.background); setProjectId(contact.context.projectId || ''); setAllowed(contact.enabled); setWatching(contact.context.watching); revision.current = contact.context.version; setEditing(true); }
  async function open(draft?: string) {
    if (!topic) return;
    await perform('open', async () => { await request(`/wechat/contacts/${contact.id}/open`, 'POST', { topicId: topic.id }); window.dispatchEvent(new Event('orbit-wechat-topics-changed')); onDiscuss(draft); });
  }
  return <div className="wx-detail"><header className="wx-contact-heading"><div className="wx-contact-identity"><WechatAvatar name={contact.title} demo={mode.demo} size={30}/><span>{contact.context.watching && contact.enabled ? '关注中' : '未关注'}{contact.projectName && <> · {contact.projectName}</>}</span></div><button className="wx-text" onClick={() => editing ? setEditing(false) : edit()}>{editing ? '收起设置' : '背景设置'}<Settings2 size={14}/></button></header>
    <div className="wx-detail-body" hidden={editing}>
      {contact.context.background && <p className="wx-background-line">{contact.context.background}</p>}
      {topic?.title && topic.status !== 'dismissed' ? <article className="wx-topic"><div className="wx-speaker"><OrbitAvatar size={33}/><span>Orbit<small>{date(topic.createdAt)}</small></span></div><h3>{topic.title}</h3><p className="wx-prose">{topic.opener}</p><div className="wx-topic-actions"><button className="wx-primary" disabled={!!busy || !contact.enabled || !data.capture.enabled} onClick={() => void open()}>到主对话继续<ArrowUpRight size={14}/></button><button className="wx-text" disabled={!!busy || !contact.enabled || !data.capture.enabled} onClick={() => void perform('dismiss', () => request(`/wechat/contacts/${contact.id}/dismiss`, 'POST', { topicId: topic.id }))}>忽略</button></div>{topic.suggestions.length > 0 && <ul className="wx-next-steps">{topic.suggestions.map(s => <li key={s}>{s}</li>)}</ul>}<details className="wx-evidence"><summary>依据 {topic.sources.length} 条通知片段<ChevronDown size={12}/></summary><WechatMessageSources sources={topic.sources} fallbackSender={contact.title} demo={mode.demo} compact={false} label=""/><small>通知可能不完整，也无法据此判断你是否已经回复。</small></details></article> : <div className="wx-no-topic"><h3>概述</h3><p>{topic?.summary || '暂无分析'}</p>{!contact.context.background && !topic && <button className="wx-text" onClick={edit}>补充背景<ArrowUpRight size={13}/></button>}</div>}
      <div className="wx-analyze-row"><button className="wx-text" disabled={!!busy || contact.processing || !data.capture.enabled || !contact.enabled} onClick={() => void perform('analyze', () => request(`/wechat/contacts/${contact.id}/analyze`, 'POST', {}))}>{busy === 'analyze' || contact.processing ? <><LoaderCircle size={14} className="dt-spin"/>正在结合背景分析…</> : '分析最近消息'}</button><small>{!contact.enabled ? '需先允许分析' : !data.capture.enabled ? '请先开启通知读取' : contact.context.watching ? '自动更新已开启' : '手动更新'}</small></div>
      {(error || contact.error) && <p className="wx-error" role="alert">{error || contact.error}</p>}
      <div className="wx-raw"><button className="wx-raw-toggle" onClick={() => { const next = !showMessages; setShowMessages(next); if (next) void perform('messages', async () => setMessages(await request<WechatReadResult>(`/wechat/chats/${contact.id}/messages`))); }}><MessageCircle size={14}/>最近的通知<span>{contact.count}</span>{showMessages ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}</button>{showMessages && <div className="wx-notifications">{busy === 'messages' ? <p>正在读取…</p> : <WechatMessageSources sources={messages?.messages || []} fallbackSender={contact.title} demo={mode.demo} compact={false} label=""/>}<small>仅显示最近 40 条已采集片段，不是完整聊天记录。</small></div>}</div>
    </div>
    {editing && <div className="wx-editor"><form className="wx-context-form" onSubmit={event => { event.preventDefault(); void perform('save', async () => {
      await request(`/wechat/contacts/${contact.id}/context`, 'PATCH', { version: revision.current, enabled: allowed, background, projectId: projectId || null, watching: allowed && watching }); setEditing(false);
    }); }}><label>联系人背景<textarea value={background} onChange={e => setBackground(e.target.value)} maxLength={1200} rows={4} placeholder="例如：一起筹备周末出游，时间还没定。"/></label><label>关联项目<select value={projectId} onChange={e => setProjectId(e.target.value)}><option value="">暂不关联</option>{data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label className="wx-check"><input type="checkbox" checked={allowed} onChange={e => setAllowed(e.target.checked)}/><span>允许 Orbit 分析此聊天<small>相关通知、你填写的背景和关联项目记忆会发送给已配置的模型。</small></span></label>{allowed && <label className="wx-check"><input type="checkbox" checked={watching} onChange={e => setWatching(e.target.checked)}/><span>关注后续变化<small>自动分析新消息。</small></span></label>}{error && <p className="wx-error" role="alert">{error}</p>}<footer><button type="button" className="wx-text" disabled={!!busy} onClick={() => setEditing(false)}>取消</button><button className="wx-primary" disabled={!!busy} type="submit">{busy ? '保存中…' : '保存'}</button></footer></form></div>}
  </div>;
}
