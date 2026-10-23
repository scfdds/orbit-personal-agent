import { ArrowUpRight, ChevronDown, ChevronUp, Folder, Plus } from "lucide-react";
import type { Project } from "../../shared/projects.ts";
import type { Snapshot } from "../../shared/types.ts";
import { plainSummary } from "./workspace-state.ts";

export default function ProjectOverview({ projects, state, expanded, onToggle, onOpen, onCreate }: { projects: Project[]; state: Snapshot; expanded: boolean; onToggle(): void; onOpen(id: string): void; onCreate(): void }) {
  const recent = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3);
  if (!recent.length) return <section className="dt-project-home-empty"><p>直接开始聊，背景会逐步留下来。</p><span>临时问题留在主对话，持续推进的事情整理成项目。</span><button className="dt-secondary" onClick={onCreate}><Plus size={13}/>新建项目</button></section>;
  return <section className="dt-project-home-overview" aria-label="最近项目"><header><span>最近在做</span>{!expanded && <div>{recent.slice(0, 2).map(project => <button key={project.id} onClick={() => onOpen(project.id)}>{project.name}<ArrowUpRight size={10}/></button>)}</div>}<button className="dt-icon" aria-label={expanded ? "收起最近项目" : "展开最近项目"} aria-expanded={expanded} onClick={onToggle}>{expanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}</button></header>
    {expanded && <div className="dt-project-home-cards">{recent.map(project => {
      const conversations = state.conversations.filter(item => item.projectId === project.id && !item.archived && (!item.draft || !!item.projectId));
      const running = conversations.some(item => item.status === "running");
      const memory = conversations.map(item => state.memories?.find(value => value.conversationId === item.id)).filter(Boolean).sort((a, b) => (b?.updatedAt || "").localeCompare(a?.updatedAt || ""))[0];
      return <button key={project.id} className="dt-project-home-card" onClick={() => onOpen(project.id)}><span><Folder size={14}/><strong>{project.name}</strong><ArrowUpRight size={12}/></span><p>{plainSummary(project.summary || memory?.summary || "在这里保留相关讨论与共同背景。", 100)}</p><small>{running ? "正在处理" : `${conversations.length} 段对话`}</small></button>;
    })}</div>}
  </section>;
}
