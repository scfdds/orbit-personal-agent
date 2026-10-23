import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, FileText, LoaderCircle, Pencil, RefreshCw } from "lucide-react";
import type { Message } from "../../shared/types.ts";
import type { MemoryDocument, MemoryFile } from "../../shared/projects.ts";
import { useWorkspaceRequest } from "../api.ts";
import RichText from "./RichText.tsx";

type Props = { projectId?: string; projectName?: string; messages?: Message[]; onChanged?: () => Promise<void> };
const emptyMessages: Message[] = [];

/** A memory file, not a second database-management interface. */
export default function SharedMemoryEditor({ projectId, projectName, messages = emptyMessages, onChanged }: Props) {
  const request = useWorkspaceRequest();
  const basePath = projectId ? `/projects/${encodeURIComponent(projectId)}/memory` : "/memory/global";
  const [file, setFile] = useState("MEMORY.md"), [files, setFiles] = useState<MemoryFile[]>([]);
  const readonly = file !== "MEMORY.md";
  const path = readonly ? `${basePath}/files/${file.split("/").map(encodeURIComponent).join("/")}` : `${basePath}/document`;
  const [document, setDocument] = useState<MemoryDocument | null>(null);
  const [loading, setLoading] = useState(true), [pending, setPending] = useState(false), [error, setError] = useState("");
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState("");
  const [conflict, setConflict] = useState(false);
  const alive = useRef(true), scope = useRef({ path }), sequence = useRef(0);
  if (scope.current.path !== path) scope.current = { path };
  const interaction = useRef({ editing, pending });
  interaction.current = { editing, pending };
  useEffect(() => { setFile("MEMORY.md"); setFiles([]); }, [basePath]);
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void request<MemoryFile[]>(`${basePath}/files`).then(value => {
        if (cancelled) return;
        setFiles(value);
        if (!value.some(item => item.name === file) && !interaction.current.editing) setFile("MEMORY.md");
      }).catch(() => { /* The core document remains usable if the index is unavailable. */ });
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [basePath, messages, file]);

  const load = useCallback(async (allowPending = false) => {
    if (interaction.current.editing || interaction.current.pending && !allowPending) return;
    const startedScope = scope.current, ticket = ++sequence.current;
    const current = () => alive.current && scope.current === startedScope && ticket === sequence.current;
    try {
      const value = await request<MemoryDocument>(path);
      if (current() && !interaction.current.editing && (allowPending || !interaction.current.pending)) { setDocument(value); setError(""); }
    } catch (cause) { if (current() && !interaction.current.editing) setError((cause as Error).message); }
    finally { if (current()) setLoading(false); }
  }, [path]);
  useEffect(() => {
    alive.current = true; setLoading(true); setDocument(null); setEditing(false); setPending(false); setDraft(""); setError(""); setConflict(false);
    return () => { alive.current = false; sequence.current++; };
  }, [path]);
  useEffect(() => {
    if (editing || pending) return;
    // SSE snapshots replace messages even when only memory changed. Never replace a draft.
    const timer = window.setTimeout(() => void load(), 100);
    return () => clearTimeout(timer);
  }, [messages, editing, pending, load]);
  useEffect(() => {
    if (editing || pending || !document || !["queued", "updating"].includes(document.status)) return;
    const timer = window.setInterval(() => void load(), 1800);
    return () => clearInterval(timer);
  }, [document?.status, editing, pending, load]);

  async function save() {
    if (!document || pending || readonly) return;
    const startedScope = scope.current;
    const current = () => alive.current && scope.current === startedScope;
    sequence.current++; interaction.current.pending = true; setPending(true); setError("");
    try {
      const value = await request<MemoryDocument>(`${basePath}/document`, "PATCH", { version: document.version, content: draft });
      if (current()) { setDocument(value); setEditing(false); setDraft(""); setConflict(false); }
      await onChanged?.();
    } catch (cause) {
      const detail = (cause as Error).message;
      // Keep the draft, but refresh its base version so a deliberate retry can succeed.
      if (/记忆.*已更新|版本/.test(detail)) {
        try { const latest = await request<MemoryDocument>(path); if (current()) setDocument(latest); } catch {}
        if (current()) { setConflict(true); setError("文件已有更新，你的草稿仍保留。再次保存将使用你的版本；取消编辑可查看最新内容。"); }
      } else if (current()) setError(detail);
    } finally { if (current()) { interaction.current.pending = false; setPending(false); } }
  }
  async function refresh() {
    if (pending || editing) return;
    const startedScope = scope.current;
    const current = () => alive.current && scope.current === startedScope;
    sequence.current++; interaction.current.pending = true; setPending(true); setError("");
    try { await request(`${basePath}/refresh`, "POST", {}); if (current()) await load(true); }
    catch (cause) { if (current()) setError((cause as Error).message); }
    finally { if (current()) { interaction.current.pending = false; setPending(false); } }
  }
  const updating = !!document && ["queued", "updating"].includes(document.status);
  // The project name and Memory tab already identify this page. Hide only the
  // generated heading in reading mode; editing/saving always uses the full file.
  const lines = (document?.content || "").split(/\r?\n/);
  const generatedTitle = projectId ? projectName && `# ${projectName}记忆` : "# 通用记忆";
  const content = !readonly && lines[0]?.trim() === generatedTitle ? lines.slice(1).join("\n").trim() : document?.content.trim() || "";
  const selectedFile = files.find(item => item.name === file);
  function openFile(name: string) { setFile(name); setLoading(true); setError(""); }
  return <section className="dt-memory-file" aria-label={projectId ? "项目记忆" : "Orbit 通用记忆"}>
    <header className="dt-memory-file-toolbar">
      {readonly && <button type="button" className="dt-text-button dt-memory-file-back" onClick={() => openFile("MEMORY.md")}><ArrowLeft size={13}/>返回记忆</button>}
      {readonly ? <span className="dt-memory-file-label">{selectedFile?.label || file}</span> : <div className="dt-memory-file-actions">
        {editing ? <>
          <button type="button" className="dt-text-button" disabled={pending} onClick={() => { setEditing(false); setDraft(""); setError(""); setConflict(false); }}>取消</button>
          <button type="button" className="dt-primary" disabled={pending} onClick={() => void save()}>{pending ? "保存中…" : conflict ? "保存我的版本" : "保存"}</button>
        </> : <>
          <button type="button" className="dt-text-button" disabled={!document || loading || pending || updating} onClick={() => void refresh()}>{updating || pending ? <LoaderCircle size={13} className="dt-spin"/> : <RefreshCw size={13}/>}从对话{content ? "更新" : "整理"}</button>
          <button type="button" className="dt-text-button" disabled={!document || loading || pending} onClick={() => { sequence.current++; setDraft(document?.content || ""); setEditing(true); setError(""); setConflict(false); }}><Pencil size={12}/>编辑</button>
        </>}
      </div>}
    </header>
    {loading ? <p className="dt-memory-file-status"><LoaderCircle size={13} className="dt-spin"/>正在读取…</p> : editing ? <textarea className="dt-memory-file-editor" aria-label="MEMORY.md 内容" maxLength={100000} autoFocus spellCheck={false} rows={16} value={draft} onChange={event => setDraft(event.target.value)} disabled={pending} placeholder={projectId ? "记录这个项目的背景、决定与进展。" : "记录希望 Orbit 长期记住的偏好与协作习惯。"}/> : content ? <div className="dt-memory-file-body" onClick={event => { const link = (event.target as Element).closest("a"); const href = link?.getAttribute("href")?.replace(/^\.\//, ""); if (href && files.some(item => item.name === href)) { event.preventDefault(); openFile(href); } }}><RichText>{content}</RichText></div> : document && <div className="dt-memory-file-empty"><p>{readonly ? "暂无内容" : projectId ? "还没有项目记忆" : "还没有通用记忆"}</p>{!readonly && <span>可以从已有对话整理，也可以直接编辑。</span>}</div>}
    {!editing && updating && <p className="dt-memory-file-status" role="status">正在更新…</p>}
    {error && <p className="dt-settings-error" role="alert">{error}{!editing && <button type="button" disabled={pending} onClick={() => void load()}>重新读取</button>}</p>}
    {document?.status === "failed" && !error && <p className="dt-settings-error">{document.error || "本次更新未完成，已有内容仍保留。"}</p>}
    {!editing && files.length > 0 && <details className="dt-memory-files" key={basePath}>
      <summary><ChevronRight size={12}/>记忆文件</summary>
      <div className="dt-memory-files-list">{files.map(item => <button key={item.name} type="button" aria-current={item.name === file ? "page" : undefined} disabled={pending || item.name === file} onClick={() => openFile(item.name)}><FileText size={13}/><span>{item.label}</span><small>{item.kind === "recap" ? "对话记录" : item.name}</small></button>)}</div>
    </details>}
  </section>;
}
