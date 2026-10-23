import { useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight, BookOpen, Check, Folder, LoaderCircle, MessageSquare, Pencil, Plus, X } from "lucide-react";
import type { Project } from "../../shared/projects.ts";
import type { Conversation, Snapshot } from "../../shared/types.ts";
import { useWorkspaceRequest } from "../api.ts";
import { dateLabel, plainSummary } from "./workspace-state.ts";
import SharedMemoryEditor from "./SharedMemoryEditor.tsx";

type Props = { project: Project; state: Snapshot; onBack(): void; onOpen(id: string, messageId?: string): void; onRefresh(): Promise<void> };

export default function ProjectWorkspace({ project, state, onBack, onOpen, onRefresh }: Props) {
  const request = useWorkspaceRequest();
  const [tab, setTab] = useState<"conversations" | "memory">("conversations");
  const [editing, setEditing] = useState(false), [creating, setCreating] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState("");
  const [name, setName] = useState(project.name), [summary, setSummary] = useState(project.summary), [instructions, setInstructions] = useState(project.instructions), [title, setTitle] = useState("");
  useEffect(() => { if (!editing) { setName(project.name); setSummary(project.summary); setInstructions(project.instructions); } }, [project, editing]);
  const conversations = state.conversations.filter(item => !item.archived && (!item.draft || !!item.projectId) && item.projectId === project.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  function conversationSummary(conversation: Conversation) {
    const summary = state.memories?.find(item => item.conversationId === conversation.id)?.summary || conversation.summary;
    if (summary) return plainSummary(summary, 130);
    const lastQuestion = state.messages.findLast(message => message.conversationId === conversation.id && message.role === "user" && !message.kind);
    return lastQuestion ? plainSummary(lastQuestion.content, 130) : "还没有讨论，打开后可以直接开始。";
  }
  async function save() {
    if (pending || !name.trim()) return;
    setPending(true); setError("");
    try { await request(`/projects/${encodeURIComponent(project.id)}`, "PATCH", { name: name.trim(), summary: summary.trim(), instructions: instructions.trim() }); await onRefresh(); setEditing(false); }
    catch (cause) { setError((cause as Error).message); } finally { setPending(false); }
  }
  async function create() {
    if (pending || !title.trim()) return;
    setPending(true); setError("");
    try { const conversation = await request<Conversation>(`/projects/${encodeURIComponent(project.id)}/conversations`, "POST", { title: title.trim() }); await onRefresh(); onOpen(conversation.id); }
    catch (cause) { setError((cause as Error).message); } finally { setPending(false); }
  }
  return <section className="dt-project-page" aria-label={`项目：${project.name}`}>
    <header className="dt-project-location"><button className="dt-heading-button" onClick={onBack}><ArrowLeft size={14}/>Orbit</button><span>项目</span></header>
    <div className="dt-project-scroll"><div className="dt-project-content">
      <header className="dt-project-title"><span className="dt-project-emblem"><Folder size={22}/></span><div><h1>{project.name}</h1><p>{conversations.length} 段对话 · 共享背景与记忆</p></div><button className="dt-icon" aria-label="编辑项目" title="编辑项目" onClick={() => setEditing(value => !value)}><Pencil size={15}/></button></header>
      {editing ? <form className="dt-project-edit" onSubmit={event => { event.preventDefault(); void save(); }}><label>项目名称<input value={name} onChange={event => setName(event.target.value)} maxLength={80} autoFocus required/></label><label>项目说明<textarea value={summary} onChange={event => setSummary(event.target.value)} rows={2} maxLength={2000} placeholder="这个项目关注什么，当前在推进什么"/></label><label>协作要求<span>可选，适用于项目内所有对话</span><textarea value={instructions} onChange={event => setInstructions(event.target.value)} rows={2} maxLength={4000} placeholder="例如：先解释核心概念，再用具体例子帮助理解"/></label><div className="dt-form-actions"><button type="button" className="dt-secondary" disabled={pending} onClick={() => setEditing(false)}>取消</button><button className="dt-primary" type="submit" disabled={pending || !name.trim()}><Check size={13}/>{pending ? "保存中…" : "保存"}</button></div></form> : project.summary && <p className="dt-project-summary">{project.summary}</p>}
      <nav className="dt-project-tabs" aria-label="项目内容"><button aria-current={tab === "conversations" ? "page" : undefined} onClick={() => setTab("conversations")}><MessageSquare size={14}/>对话</button><button aria-current={tab === "memory" ? "page" : undefined} onClick={() => setTab("memory")}><BookOpen size={14}/>记忆</button>{tab === "conversations" && <button className="dt-project-new" onClick={() => { setCreating(value => !value); setTitle(""); }}><Plus size={14}/>新对话</button>}</nav>
      {tab === "memory" ? <SharedMemoryEditor projectId={project.id} projectName={project.name} messages={state.messages} onChanged={onRefresh}/> : <>
        {creating && <form className="dt-project-new-form" onSubmit={event => { event.preventDefault(); void create(); }}><input autoFocus value={title} maxLength={120} placeholder="这次想讨论什么？" aria-label="新对话主题" onChange={event => setTitle(event.target.value)}/><button className="dt-primary" type="submit" disabled={pending || !title.trim()}>{pending ? <LoaderCircle size={14} className="dt-spin"/> : "开始"}</button><button className="dt-icon" type="button" aria-label="取消新对话" onClick={() => setCreating(false)}><X size={14}/></button></form>}
        <div className="dt-project-conversations">{conversations.map(conversation => <button key={conversation.id} className="dt-project-conversation" onClick={() => onOpen(conversation.id)}><MessageSquare size={17}/><span><strong>{conversation.title}</strong><small>{conversationSummary(conversation)}</small></span><div><small>{dateLabel(conversation.updatedAt)}</small>{conversation.status === "running" ? <LoaderCircle className="dt-spin" size={13}/> : <ArrowUpRight size={13}/>}</div></button>)}</div>
        {!conversations.length && !creating && <div className="dt-panel-empty"><p>从一段讨论开始</p><span>可以在这里开启对话，也可以回到 Orbit，直接交代这件事。</span><button className="dt-secondary" onClick={() => setCreating(true)}><Plus size={13}/>新对话</button></div>}
      </>}
      {error && <p className="dt-settings-error" role="alert">{error}</p>}
    </div></div>
  </section>;
}
