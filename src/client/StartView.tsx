import { useRef, useState } from "react";
import { ArrowUp, ArrowUpRight, ChevronDown, GitBranch, LoaderCircle, Plus, X } from "lucide-react";
import type { AppManifest, IntakeRequest } from "../shared/types.ts";
import { AppMark } from "./VisualIdentity.tsx";
import "./start.css";

export function WelcomeResources({ apps, onApps, onOpenApp, disabled = false }: {
  apps: AppManifest[]; onApps: () => void; onOpenApp: (appId: string) => void; disabled?: boolean;
}) {
  return <div className="welcome-resources">
    <div className="connected-apps-heading"><span>已接入的应用</span><button type="button" onClick={onApps}>查看应用<ArrowUpRight size={12}/></button></div>
    <div className="connected-apps-list">
      {apps.filter(app => app.id !== "memory").map(app => <button type="button" key={app.id} disabled={disabled}
        title={`打开${app.name}`} onClick={() => onOpenApp(app.id)}>
        <AppMark id={app.id} size={23}/><span>{app.name}</span>
      </button>)}
      {!apps.length && <span className="connected-apps-empty">连接应用后，Orbit 就能使用其中的能力。</span>}
    </div>
  </div>;
}

export default function StartView({ apps, project, busy, configured, onSubmit, onApps, onOpenApp, onClearProject }: {
  apps: AppManifest[]; project?: string; busy: boolean; configured: boolean;
  onSubmit: (input: IntakeRequest) => Promise<void>; onApps: () => void; onOpenApp: (appId: string) => void; onClearProject: () => void;
}) {
  const [input, setInput] = useState(() => sessionStorage.getItem("orbit.start.draft") || "");
  const [mode, setMode] = useState<"auto" | "new">("auto");
  const [error, setError] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const submitting = useRef(false);
  const attempt = useRef<{ signature: string; requestId: string } | null>(null);
  function change(value: string) {
    setInput(value); sessionStorage.setItem("orbit.start.draft", value); setError("");
  }
  async function submit() {
    const content = input.trim();
    if (!content || busy || submitting.current || !configured) return;
    const signature = JSON.stringify([content, mode, project]);
    if (attempt.current?.signature !== signature) attempt.current = { signature, requestId: crypto.randomUUID() };
    submitting.current = true; setError("");
    try {
      await onSubmit({ content, mode, requestId: attempt.current.requestId, ...(project ? {project} : {}) });
      sessionStorage.removeItem("orbit.start.draft");
    } catch (e) { setError((e as Error).message); }
    finally { submitting.current = false; }
  }
  return <div className="start-page">
    <div className="start-content">
      <div className="start-heading"><h1>有什么想一起做的？</h1><p>说说你的想法，Orbit 会找到合适的地方接着聊。</p></div>
      <form className="composer start-composer" onSubmit={e => { e.preventDefault(); void submit(); }}>
        {project && <div className="start-project"><span>{project}</span><button type="button" disabled={busy} aria-label="取消分区范围" onClick={onClearProject}><X size={12}/></button></div>}
        <textarea autoFocus ref={textarea} aria-label="向 Orbit 交代一件事" placeholder="提一个问题，或交代一件事…" value={input} disabled={busy} rows={3}
          onChange={e => {change(e.target.value); e.target.style.height="auto"; e.target.style.height=`${Math.min(e.target.scrollHeight,180)}px`;}}
          onKeyDown={e => { if(e.key==="Enter"&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void submit();} }}/>
        <div className="composer-toolbar">
          <div className="entry-mode">
            {mode==="auto" ? <GitBranch size={14}/> : <Plus size={14}/>}
            <select aria-label="对话选择方式" value={mode} disabled={busy} onChange={e => {setMode(e.target.value as "auto"|"new");setError("");}}>
              <option value="auto">自动选择对话</option><option value="new">始终新建对话</option>
            </select><ChevronDown size={12}/>
          </div>
          <div><span className="model-name">DeepSeek</span><button className="send-button" aria-label="发送消息" disabled={!input.trim()||busy||!configured}>
            {busy ? <LoaderCircle size={18} className="spin"/> : <ArrowUp size={19}/>}
          </button></div>
        </div>
      </form>
      <div className="entry-explanation" role="status" aria-live="polite">
        {busy ? <><LoaderCircle size={12} className="spin"/>正在衔接讨论…</> : error ? <span className="inline-error">{error}</span> : !configured ? "连接模型后，就可以开始对话。" : mode==="auto" ? "接续相关讨论，或为新的方向展开对话。" : "本次消息会开启一个独立对话。"}
      </div>
      <WelcomeResources apps={apps} onApps={onApps} onOpenApp={onOpenApp} disabled={busy}/>
    </div>
  </div>;
}
