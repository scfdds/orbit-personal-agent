import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronRight, FileText, FolderOpen, LayoutGrid, MoreHorizontal, PanelRight, Plus } from "lucide-react";
import type { Project } from "../../shared/projects.ts";
import type { Conversation } from "../../shared/types.ts";
import type { AssistantWorkspaceTab } from "../../shared/assistant.ts";
import { useWorkspaceRequest } from "../api.ts";

type Props = { project?: Project; projects: Project[]; conversation: Conversation; resources: AssistantWorkspaceTab[]; activeResource?: string; busy: boolean; overviewOpen: boolean; onHome(): void; onProject(id: string): void; onResource(tab: AssistantWorkspaceTab): void; onOverview(): void; onCreate(title: string): Promise<void>; onRefresh(): Promise<void> };
export default function MatterHeader({ project, projects, conversation, resources, activeResource, busy, overviewOpen, onHome, onProject, onResource, onOverview, onCreate, onRefresh }: Props) {
  const request = useWorkspaceRequest();
  const [menu, setMenu] = useState<"resources" | "organize" | null>(null), [creating, setCreating] = useState(false);
  const [title, setTitle] = useState(""), [pending, setPending] = useState(false), [error, setError] = useState("");
  const root = useRef<HTMLElement>(null);
  useEffect(() => { if (!menu) return; const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setMenu(null); }; document.addEventListener("pointerdown", close); return () => document.removeEventListener("pointerdown", close); }, [menu]);
  async function move(projectId: string) {
    if (pending) return; setPending(true); setError("");
    try { await request(`/conversations/${encodeURIComponent(conversation.id)}/project`, "PUT", { projectId: projectId || null }); await onRefresh(); setMenu(null); }
    catch (cause) { setError((cause as Error).message); } finally { setPending(false); }
  }
  async function create() { if (!title.trim() || pending) return; setPending(true); setError(""); try { await onCreate(title.trim()); setCreating(false); } catch (cause) { setError((cause as Error).message); } finally { setPending(false); } }
  return <header className="dt-conversation-heading" ref={root} onKeyDown={event => { if (event.key === "Escape" && menu) { event.stopPropagation(); setMenu(null); } }}>
    <div className="dt-conversation-heading-row"><div className="dt-matter-location"><button className="dt-icon" onClick={onHome} aria-label="回到主对话" title="回到主对话"><ArrowLeft size={16}/></button>{project && <><button className="dt-conversation-project-link" onClick={() => onProject(project.id)}>{project.name}</button><ChevronRight size={12}/></>}<strong title={conversation.title}>{conversation.title}</strong>{conversation.showcase && <span className="dt-example-tag">示例</span>}{busy && <i className="dt-matter-running" title="正在处理" aria-label="正在处理"/>}</div>
      <div className="dt-matter-heading-actions"><button className="dt-heading-button" onClick={() => { setMenu(null); onOverview(); }} aria-label="查看对话概览" aria-expanded={overviewOpen}><PanelRight size={14}/><span>回顾</span></button>
        <div className="dt-heading-menu-anchor"><button className="dt-heading-button" aria-label={`查看对话资料，共 ${resources.length} 项`} aria-expanded={menu === "resources"} onClick={() => setMenu(menu === "resources" ? null : "resources")}><FolderOpen size={14}/><span>资料{resources.length ? ` · ${resources.length}` : ""}</span></button>
          {menu === "resources" && <div className="dt-heading-popover dt-resource-popover" aria-label="对话资料"><div className="dt-popover-label">这段对话的资料</div>{resources.map(resource => <button key={resource.id} className="dt-resource-option" aria-pressed={activeResource === resource.id} onClick={() => { setMenu(null); onResource(resource); }}>{resource.kind === "app" ? <LayoutGrid size={15}/> : <FileText size={15}/>}<span><strong>{resource.title}</strong></span></button>)}{!resources.length && <p className="dt-popover-empty">生成的文件会保留在这里。</p>}</div>}
        </div>
        <div className="dt-heading-menu-anchor"><button className="dt-icon" aria-label="整理对话" aria-expanded={menu === "organize"} onClick={() => setMenu(menu === "organize" ? null : "organize")}><MoreHorizontal size={16}/></button>{menu === "organize" && <div className="dt-heading-popover dt-conversation-organize"><label>归属项目<select aria-label="归属项目" value={conversation.projectId || ""} disabled={pending} onChange={event => void move(event.target.value)}><option value="">未归类</option>{projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{project && <button onClick={() => { setMenu(null); setCreating(true); setTitle(""); }}><Plus size={13}/>在项目中开启新对话</button>}{error && <p className="dt-settings-error" role="alert">{error}</p>}</div>}</div>
      </div>
    </div>
    {creating && <form className="dt-project-new-form" onSubmit={event => { event.preventDefault(); void create(); }}><input autoFocus aria-label="新对话主题" value={title} maxLength={120} onChange={event => setTitle(event.target.value)} placeholder="这次想讨论什么？"/><button className="dt-primary" disabled={pending || !title.trim()} type="submit"><Check size={13}/>{pending ? "创建中…" : "开始"}</button><button className="dt-secondary" type="button" onClick={() => setCreating(false)}>取消</button>{error && <p className="dt-settings-error" role="alert">{error}</p>}</form>}
  </header>;
}
