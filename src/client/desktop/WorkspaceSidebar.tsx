import { useEffect, useState } from "react";
import { ChevronRight, Folder, LoaderCircle, MessageSquare, Plus, Presentation, Search, Settings2 } from "lucide-react";
import type { Project } from "../../shared/projects.ts";
import type { Conversation } from "../../shared/types.ts";
import OrbitAvatar from "./OrbitAvatar.tsx";
import { useWorkspaceMode } from "./WorkspaceModeRoot.tsx";
import "./workspace-home.css";
import "./sidebar-refinement.css";
import "./navigation-sidebar.css";

type Props = {
  projects: Project[]; conversations: Conversation[]; activeProjectId?: string | null; projectPageId?: string | null;
  mainId: string; selectedId: string; collapsed: boolean; wechatActive: boolean;
  onToggle(): void; onOpen(id: string): void; onProject(id: string): void; onCreateProject(): void;
  onHome(): void; onHistory(): void; onSettings(): void; onWechat(): void;
};

/** Two levels only: projects, then their conversations. The main assistant stays outside both. */
export default function WorkspaceSidebar({ projects, conversations, activeProjectId, projectPageId, mainId, selectedId, collapsed, wechatActive, onToggle, onOpen, onProject, onCreateProject, onHome, onHistory, onSettings, onWechat }: Props) {
  const { mode, changeMode } = useWorkspaceMode();
  const [expanded, setExpanded] = useState<string | null>(activeProjectId || null);
  useEffect(() => { if (activeProjectId) setExpanded(activeProjectId); }, [activeProjectId]);
  const homeActive = selectedId === mainId && !projectPageId && !wechatActive;
  const loose = conversations.filter(item => !item.projectId && item.id !== mainId && !item.archived && (!item.draft || !!item.projectId));
  return <aside id="workspace-navigation" className={`dt-sidebar dt-sidebar-refined dt-sidebar-navigation dt-project-sidebar${collapsed ? " dt-sidebar-collapsed" : ""}`} aria-label="工作导航">
    <div className="dt-sidebar-header">
      <button className={`dt-sidebar-assistant${homeActive ? " dt-sidebar-home-active" : ""}`} onClick={onHome} aria-label="Orbit 主对话" aria-current={homeActive ? "page" : undefined} title="回到主对话"><OrbitAvatar size={32} className="dt-sidebar-cloud" decorative/>{!collapsed && <span className="dt-sidebar-assistant-copy"><strong>Orbit</strong></span>}</button>
    </div>
    <button className="dt-sidebar-nav dt-sidebar-all dt-sidebar-search" onClick={onHistory} aria-label="搜索项目和对话" title="搜索项目和对话"><Search size={15}/><span>搜索</span></button>
    <button className="dt-sidebar-nav dt-sidebar-wechat" onClick={onWechat} aria-label="微信消息 Beta" aria-current={wechatActive ? "page" : undefined} title="微信消息 · Beta"><MessageSquare size={16}/><span>微信消息</span>{!collapsed && <small>Beta</small>}</button>
    <nav className="dt-sidebar-mainnav" aria-label="项目导航">
      {!collapsed && <section className="dt-sidebar-recents" aria-label="项目"><div className="dt-sidebar-recents-heading dt-project-nav-heading"><span>项目</span><button className="dt-icon" aria-label="新建项目" title="新建项目" onClick={onCreateProject}><Plus size={13}/></button></div>
        <div className="dt-sidebar-recent-list">{projects.map(project => {
          const items = conversations.filter(item => item.projectId === project.id && !item.archived && (!item.draft || !!item.projectId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          const active = activeProjectId === project.id, open = expanded === project.id;
          const running = items.some(item => item.status === "running");
          return <div key={project.id} className="dt-sidebar-matter-group"><div className={`dt-sidebar-matter-row${active ? " dt-sidebar-matter-row-active" : ""}`}><button className="dt-sidebar-recent" onClick={() => onProject(project.id)} aria-label={`打开项目：${project.name}`} aria-current={projectPageId === project.id ? "page" : undefined} title={project.name}><Folder size={14}/><span className="dt-sidebar-recent-title">{project.name}</span>{running && <LoaderCircle size={12} className="dt-spin" aria-label="正在处理"/>}</button>{items.length > 0 && <button className="dt-sidebar-discussion-toggle" aria-label={`${open ? "收起" : "展开"}项目对话：${project.name}`} aria-expanded={open} onClick={() => setExpanded(open ? null : project.id)}><ChevronRight size={12}/></button>}</div>
            {open && <div className="dt-sidebar-discussions" role="group" aria-label={`${project.name}的对话`}>{items.map(item => <button key={item.id} className={`dt-sidebar-discussion${!wechatActive && !projectPageId && selectedId === item.id ? " dt-sidebar-discussion-active" : ""}`} onClick={() => onOpen(item.id)} aria-label={`打开对话：${item.title}`} aria-current={!wechatActive && !projectPageId && selectedId === item.id ? "page" : undefined} title={item.title}><span className="dt-sidebar-discussion-title">{item.title}</span>{item.unread && item.id !== selectedId && <span className="dt-sidebar-recent-unread" aria-label="有新进展"/>}</button>)}</div>}
          </div>;
        })}
        {!projects.length && <p className="dt-sidebar-recents-empty">持续讨论的事情会整理成项目，也可以手动创建。</p>}
        {loose.length > 0 && <div className="dt-sidebar-loose"><span>其他对话</span>{loose.slice(0, 5).map(item => <button key={item.id} className={`dt-sidebar-discussion${!wechatActive && selectedId === item.id && !projectPageId ? " dt-sidebar-discussion-active" : ""}`} onClick={() => onOpen(item.id)} title={item.title}><span className="dt-sidebar-discussion-title">{item.title}</span></button>)}</div>}
        </div>
      </section>}
      {collapsed && <button className="dt-sidebar-nav" aria-label="展开项目列表" title="项目" onClick={onToggle}><Folder size={16}/></button>}
    </nav>
    <footer className="dt-sidebar-footer dt-sidebar-utilities">
      <button className="dt-sidebar-nav" onClick={onSettings} aria-label="设置" title="设置"><Settings2 size={16}/><span>设置</span></button>
      {collapsed ? <button className="dt-sidebar-demo-compact" type="button" role="switch" aria-label="演示模式" aria-checked={mode.demo} title={`演示模式：${mode.demo ? "已开启，点击退出" : "未开启，点击开启"}`} onClick={() => void changeMode(!mode.demo)}><Presentation size={17}/></button>
        : <div className="dt-sidebar-demo"><span>演示模式</span><button className="dt-sidebar-demo-switch" type="button" role="switch" aria-label="演示模式" aria-checked={mode.demo} title={mode.demo ? "退出演示模式" : "开启演示模式"} onClick={() => void changeMode(!mode.demo)}><span/></button></div>}
    </footer>
  </aside>;
}
