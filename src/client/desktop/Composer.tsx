import { useEffect, useRef } from "react";
import { ArrowUp, FileText, LoaderCircle, MessageSquare, Sparkles, Square, X } from "lucide-react";
import type { Draft } from "./workspace-state.ts";
import type { VoiceController } from "./useVoice.ts";
import { VoiceControls, VoiceStatus } from "./VoiceControls.tsx";

type Props = {
  draft: Draft; onChange: (draft: Draft) => void; onSend: () => void; onStop: () => void;
  title: string; referenceTitle: string; isHome: boolean; busy: boolean; routing: boolean;
  configured: boolean; onSettings: () => void; focusKey: string; compact?: boolean; voice?: VoiceController;
  inputLabel?: string;
  autoFocus?: boolean;
  placeholder?: string;
};
export default function Composer({ draft, onChange, onSend, onStop, title, referenceTitle, isHome, busy, routing, configured, onSettings, focusKey, compact, voice, inputLabel, autoFocus = true, placeholder }: Props) {
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (autoFocus) input.current?.focus({ preventScroll: true }); }, [focusKey, autoFocus]);
  useEffect(() => { const el = input.current; if (el) { el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, compact ? 120 : 180)}px`; } }, [draft.text, compact]);
  return <form className={`dt-composer ${compact ? "dt-composer-compact" : ""}`} onSubmit={e => { e.preventDefault(); onSend(); }}>
    {draft.reference && <div className="dt-reference-chip"><FileText size={13}/><span>{referenceTitle}</span><button type="button" aria-label="移除引用" onClick={() => onChange({ ...draft, reference: null })}><X size={13}/></button></div>}
    {draft.reference?.quote && <blockquote className="dt-quote-preview">{draft.reference.quote}</blockquote>}
    <textarea ref={input} aria-label={inputLabel || (isHome ? "主对话输入" : "事项对话输入")} rows={compact ? 1 : 2} value={draft.text} placeholder={configured ? placeholder || (compact ? "想问什么，或继续哪件事？" : isHome ? "说说接下来想做什么…" : "接着讨论，或者补充一个新想法…") : "先设置模型，然后开始工作…"} onChange={e => onChange({ ...draft, text: e.target.value })} onKeyDown={e => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onSend(); }
    }}/>
    <div className="dt-composer-bottom"><span className="dt-composer-context">{isHome ? <Sparkles size={13}/> : <MessageSquare size={13}/>}<span>{routing ? "正在找回相关背景…" : isHome ? "主对话 · 自动关联背景" : title}</span></span>
      <div className="dt-composer-controls">{voice && <VoiceControls voice={voice}/>}{!configured ? <button type="button" className="dt-primary dt-setup-button" onClick={onSettings}>设置模型</button>
        : <>{busy && !routing && <button type="button" className="dt-voice-send-stop" aria-label="停止生成" onClick={onStop}><Square size={11}/></button>}<button type="submit" className="dt-send" aria-label="发送消息" disabled={!draft.text.trim() || routing}>{routing ? <LoaderCircle size={16} className="dt-spin"/> : <ArrowUp size={18}/>}</button></>}</div>
    </div>
    {voice && <VoiceStatus voice={voice}/>}
  </form>;
}
