import { lazy, Suspense, useEffect, useRef, useState, type ComponentType, type RefObject } from "react";
import { ArrowUpRight, Download, FileText, Layers2, MessageSquare, Quote, X, LoaderCircle } from "lucide-react";
import type { AssistantMessageContext, AssistantWorkspaceTab } from "../../shared/assistant.ts";
import type { Snapshot } from "../../shared/types.ts";
import type { AssistantDelivery } from "../../shared/delivery.ts";
import type { AppPanelProps } from "../panel-types.ts";
import { useWorkspaceRequest } from "../api.ts";
import RichText from "./RichText.tsx";
import "./pane-delivery.css";

const panelImports = import.meta.glob<{ default: ComponentType<AppPanelProps> }>("../../apps/*/Panel.tsx");
const panels = Object.fromEntries(Object.entries(panelImports).map(([path, load]) => [path, lazy(async () => {
  // Existing apps retain their styles; their bundle is loaded only when opened.
  await import("../styles.css"); return load();
})]));
type Props = { data: Snapshot; tab: AssistantWorkspaceTab; selectedId: string; onClose(): void; onOpen(id: string): void;
  onResource(tab: AssistantWorkspaceTab): void; onReference(reference: AssistantMessageContext, text?: string): void; onRefresh(): Promise<void>;
  delivery?: AssistantDelivery | null; onReady?(deliveryId: string, focusMatched: boolean): void; embedded?: boolean; referenceTarget?: "main" | "matter" };

/** Mounts inside the same Suspense boundary as the app: a fallback is never ready. */
function DeliveryReady({ delivery, reader, onReady }: { delivery: AssistantDelivery | null; reader: RefObject<HTMLDivElement | null>; onReady?: Props["onReady"] }) {
  const callback = useRef(onReady); callback.current = onReady;
  useEffect(() => {
    if (!delivery) return;
    let cancelled = false, secondFrame = 0, clearFocus = 0;
    let reveal: Animation | undefined;
    let focused: HTMLElement | undefined;
    const firstFrame = requestAnimationFrame(() => { secondFrame = requestAnimationFrame(() => {
      const area = reader.current;
      if (cancelled || !area || !area.isConnected) return;
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) reveal = area.animate([{ opacity: .55, transform: 'translateY(5px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 180, easing: 'ease-out' });
      const focus = delivery.target?.focus;
      // Use real rendered content only. Never imply an invented or approximate match.
      if (focus?.messageId) focused = [...area.querySelectorAll<HTMLElement>('[data-message-id]')].find(node => node.dataset.messageId === focus.messageId);
      if (!focused && focus?.heading) {
        const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
        focused = [...area.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')].find(node => normalize(node.textContent || '') === normalize(focus.heading!));
      }
      if (focused) {
        const top = area.scrollTop + focused.getBoundingClientRect().top - area.getBoundingClientRect().top - 28;
        area.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
        focused.classList.add('dt-delivery-focus');
        clearFocus = window.setTimeout(() => focused?.classList.remove('dt-delivery-focus'), 4200);
      }
      callback.current?.(delivery.id, !!focused);
    }); });
    return () => { cancelled = true; cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame); clearTimeout(clearFocus); reveal?.cancel(); focused?.classList.remove('dt-delivery-focus'); };
  }, [delivery?.id, reader]);
  return null;
}

export default function ReferencePane({ data, tab, selectedId, onClose, onOpen, onResource, onReference, onRefresh, delivery, onReady, embedded = false, referenceTarget = "matter" }: Props) {
  const request = useWorkspaceRequest();
  const [mode, setMode] = useState<"summary" | "source" | "files">("summary");
  const [quote, setQuote] = useState("");
  const reader = useRef<HTMLDivElement>(null);
  const conversation = data.conversations.find(c => c.id === tab.conversationId);
  const artifact = data.artifacts.find(a => a.id === tab.artifactId && a.conversationId === tab.conversationId);
  const app = data.apps.find(a => a.id === tab.appId);
  const Panel = app ? panels[`../../apps/${app.panel.entry}`] : undefined;
  const object = data.objects.find(o => o.conversationId === tab.conversationId && o.appId === tab.appId && (!tab.objectId || tab.objectId === o.id)) || null;
  const summary = data.memories?.find(m => m.conversationId === tab.conversationId)?.summary || conversation?.summary;
  const messages = data.messages.filter(m => m.conversationId === tab.conversationId && m.role !== "system");
  const artifacts = data.artifacts.filter(a => a.conversationId === tab.conversationId);
  const objects = data.objects.filter(o => o.conversationId === tab.conversationId && !o.seed);
  const activeDelivery = delivery?.target && delivery.target.kind === tab.kind && delivery.target.conversationId === tab.conversationId
    && (tab.kind !== 'artifact' || delivery.target.artifactId === tab.artifactId)
    && (tab.kind !== 'app' || (delivery.target.appId === tab.appId && delivery.target.objectId === tab.objectId)) ? delivery : null;
  const messageFocus = activeDelivery?.target?.focus?.messageId || tab.messageId;
  useEffect(() => { setMode(messageFocus ? "source" : "summary"); setQuote(""); reader.current?.scrollTo({ top: 0 }); }, [tab.id, messageFocus, activeDelivery?.id]);
  // SSE can arrive ahead of the refreshed Snapshot. Do not narrate an older version.
  const expected = activeDelivery?.target;
  const sourceMatches = (!expected?.updatedAt || (tab.kind === 'artifact' ? artifact?.updatedAt : object?.updatedAt) === expected.updatedAt)
    && (expected?.objectVersion === undefined || object?.version === expected.objectVersion);
  const notifyReady = <DeliveryReady delivery={sourceMatches ? activeDelivery : null} reader={reader} onReady={onReady}/>;
  function capture(text?: string, messageId?: string) {
    onReference({ conversationId: tab.conversationId, ...(tab.artifactId ? { artifactId: tab.artifactId } : {}), ...(tab.appId ? { appId: tab.appId } : {}), ...(object ? { objectId: object.id } : {}), ...(messageId ? { messageId } : {}), ...(text ? { quote: text.slice(0, 4000) } : {}) });
    setQuote(""); window.getSelection()?.removeAllRanges();
  }
  return <aside className={`dt-reference-pane${embedded ? " dt-reference-embedded" : ""}`} aria-label={embedded ? "事项资料" : "资料工作台"}>
    {!embedded && <header className="dt-pane-header"><span><Layers2 size={15}/>资料工作台</span><button className="dt-icon" aria-label="关闭资料工作台" onClick={onClose}><X size={16}/></button></header>}
    <div className="dt-pane-reader" ref={reader} onMouseUp={() => {
      const selected = window.getSelection();
      if (selected?.anchorNode && selected.focusNode && reader.current?.contains(selected.anchorNode) && reader.current.contains(selected.focusNode)) setQuote(selected.toString().trim().slice(0, 4000));
    }}>
      <div className="dt-pane-heading"><span className="dt-eyebrow">{tab.kind === "app" ? "应用" : tab.kind === "artifact" ? "文档" : "讨论背景"} · {conversation?.project || "个人空间"}</span><h2>{artifact?.title || object?.title || tab.title}</h2>{conversation?.showcase && <span className="dt-example-tag">示例</span>}</div>
      {tab.kind === "conversation" && conversation ? <>
        <nav className="dt-segmented" aria-label="资料视图">{([['summary', '摘要'], ['source', '原始对话'], ['files', '相关内容']] as const).map(([key, label]) => <button key={key} aria-pressed={mode === key} onClick={() => setMode(key)}>{label}</button>)}</nav>
        {mode === "summary" ? <><RichText>{summary || "这件事还没有摘要，可以查看原始对话。"}</RichText><div className="dt-recent-questions"><span className="dt-eyebrow">最近讨论</span>{messages.filter(m => m.role === "user").slice(-3).map(m => <button key={m.id} onClick={() => setMode("source")}><MessageSquare size={13}/><span>{m.content}</span><ArrowUpRight size={13}/></button>)}</div></>
          : mode === "source" ? <div className="dt-source">{messages.map(m => <article key={m.id} data-message-id={m.id}><header><strong>{m.role === "user" ? "你" : "Orbit"}</strong><button onClick={() => capture(m.content, m.id)}><Quote size={12}/>引用</button></header><RichText>{m.content}</RichText></article>)}</div>
            : <div className="dt-resource-list">{artifacts.map(a => <button key={a.id} onClick={() => onResource({ id: `artifact:${a.id}`, kind: "artifact", conversationId: a.conversationId, artifactId: a.id, title: a.title })}><FileText size={17}/><span>{a.title}</span><ArrowUpRight size={13}/></button>)}{objects.map(o => <button key={o.id} onClick={() => onResource({ id: `app:${o.id}`, kind: "app", conversationId: o.conversationId, appId: o.appId, objectId: o.id, title: o.title })}><Layers2 size={17}/><span>{o.title}</span><ArrowUpRight size={13}/></button>)}{!artifacts.length && !objects.length && <p className="dt-muted">文档和应用会保留在这件事里。可以让 Orbit 把讨论整理成一份文档。</p>}</div>}
        {(!messageFocus || mode === 'source') && notifyReady}
      </> : tab.kind === "artifact" && artifact ? <><button className="dt-download" onClick={() => {
        const url = URL.createObjectURL(new Blob([artifact.content], { type: "text/markdown;charset=utf-8" }));
        const link = document.createElement("a"); link.href = url; link.download = `${artifact.title.replace(/[\\/]/g, "-")}.md`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}><Download size={13}/>下载 Markdown</button><RichText>{artifact.content.startsWith(`# ${artifact.title}\n`) ? artifact.content.slice(artifact.title.length + 3).trim() : artifact.content}</RichText>{notifyReady}</>
        : tab.kind === "app" && Panel && conversation && (!tab.objectId || object) ? <div className="dt-app-panel"><Suspense fallback={<div className="dt-loading"><LoaderCircle size={18} className="dt-spin"/>正在打开应用</div>}><Panel snapshot={data} work={conversation} object={object} objects={data.objects}
          onUpdate={async (target, changes) => { await request(`/objects/${target.id}`, "PATCH", { data: changes, version: target.version }); await onRefresh(); }}
          onSend={text => onReference({ conversationId: conversation.id, appId: tab.appId, ...(object ? { objectId: object.id } : {}) }, text)}
          onOpenApp={(appId, objectId) => onResource({ id: `app:${conversation.id}:${appId}`, kind: "app", conversationId: conversation.id, appId, objectId, title: data.apps.find(a => a.id === appId)?.name || "应用" })}
          onNavigate={onOpen} onDemoEvent={async () => { throw new Error("请在对话中描述要更新的内容"); }}/>{notifyReady}</Suspense></div>
          : <p className="dt-muted">内容已移除或暂时不可用。</p>}
    </div>
    <footer className="dt-pane-footer"><button onMouseDown={e => e.preventDefault()} onClick={() => capture(quote || undefined)}><Quote size={14}/>{embedded && referenceTarget === "main" ? `引用到主对话${quote ? ` · ${quote.length} 字` : ""}` : quote ? `引用选中内容 · ${quote.length} 字` : embedded ? "引用到事项对话" : "引用到当前对话"}</button>{!embedded && selectedId !== tab.conversationId && <button className="dt-primary" onClick={() => onOpen(tab.conversationId)}>进入这件事<ArrowUpRight size={14}/></button>}</footer>
  </aside>;
}
