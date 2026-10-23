import "./context-cards.css";
import { plainSummary } from "./workspace-state.ts";
import { ArrowUpRight, FileText, LoaderCircle, Quote, ChevronDown, Volume2, Square, CornerDownRight, MessageSquare } from "lucide-react";
import type { Snapshot, Message, Run, Activity } from "../../shared/types.ts";
import type { AssistantMessageContext } from "../../shared/assistant.ts";
import RichText from "./RichText.tsx";
import OrbitAvatar from "./OrbitAvatar.tsx";
import type { VoiceController } from "./useVoice.ts";
import type { HomeAssignment } from "./home-timeline.ts";

type Props = { messages: Message[]; stream?: string; run?: Run; activities: Activity[]; data: Snapshot;
  onOpen: (id: string, messageId?: string) => void; onReference: (reference: AssistantMessageContext) => void; onArtifact: (id: string) => void; voice?: VoiceController;
  variant?: "main" | "matter"; onSource?: (conversationId: string, messageId: string) => void;
  assignments?: Record<string, HomeAssignment>; streamAssignment?: HomeAssignment;
};
export default function Transcript({ messages, stream, run, activities, data, onOpen, onReference, onArtifact, voice, variant = "main", onSource, assignments, streamAssignment }: Props) {
  const matter = variant === "matter";
  const attribution = (assignment?: HomeAssignment, messageId?: string) => {
    if (!assignment) return null;
    const conversation = data.conversations.find(c => c.id === assignment.conversationId);
    const project = data.projects?.find(item => item.id === conversation?.projectId);
    const title = conversation?.title || assignment.title;
    return <button className="dt-organization-reference" aria-label={`查看对话：${title}`} onClick={() => onOpen(assignment.conversationId, messageId)}><MessageSquare size={12}/><span>已整理至</span>{project && <strong>{project.name}</strong>}<span>{project ? " / " : ""}{title}</span><ArrowUpRight size={11}/></button>;
  };
  const isFinalAnswer = (message: Message) => message.role === "assistant" &&
    (!message.runId || messages.filter(m => m.role === "assistant" && m.runId === message.runId).at(-1)?.id === message.id) &&
    !data.runs.some(r => r.id === message.runId && ["queued", "running"].includes(r.status));

  const attachments = (message: Message) => {
    const artifacts = [...new Set(message.artifactIds || [])].flatMap(id => {
      const artifact = data.artifacts.find(item => item.id === id);
      return artifact ? [artifact] : [];
    });
    return artifacts.length > 0 && <div className="dt-answer-artifacts">{artifacts.map(artifact => <button key={artifact.id} className="dt-answer-artifact" aria-label={`打开文件：${artifact.title}`} onClick={() => onArtifact(artifact.id)}><FileText size={15}/><span>{artifact.title}</span><ArrowUpRight size={12}/></button>)}</div>;
  };
  return <div className={`dt-transcript dt-transcript-${variant}`}>
    {messages.map(message => {
      if (message.kind === "conversation_link" && message.linkedConversationId) {
        if (message.runId && data.runs.find(r => r.id === message.runId)?.contextSources?.some(source => source.conversationId === message.linkedConversationId)) return null;
        const conversation = data.conversations.find(c => c.id === message.linkedConversationId);
        // Navigation is a compact reference, not a second copy of the matter's answer.
        const introduction = message.content === conversation?.title ? "" : message.content;
        return <article key={message.id} className={`dt-message dt-message-assistant dt-conversation-handoff${introduction ? "" : " dt-conversation-reference"}`} data-message-id={message.id}>
          {!matter && introduction && <span className="dt-avatar dt-avatar-cloud" aria-label="Orbit"><OrbitAvatar size={35}/></span>}
          <div className="dt-message-content">{introduction && <p className="dt-handoff-introduction">{introduction}</p>}<button className="dt-handoff-link" onClick={() => onOpen(message.linkedConversationId!)}><MessageSquare size={14}/><span>{conversation?.title || "打开相关讨论"}</span><ArrowUpRight size={14}/></button></div>
        </article>;
      }
      if (message.role === "system") return message.artifactIds?.length ? <div key={message.id} data-message-id={message.id} className="dt-message-attachments">{attachments(message)}</div> : null;
      // Old requests also retain their original home route; do not rewrite stored history.
      const carried = message.role === "user" && (message.handoff || message.route?.requestId.startsWith("home-"));
      return <article key={message.id} className={`dt-message dt-message-${message.role}`} data-message-id={message.id}>
        {message.role === "assistant" && !matter && <span className="dt-avatar dt-avatar-cloud" aria-label="Orbit"><OrbitAvatar size={35}/></span>}
        <div className="dt-message-content"><RichText>{message.content}</RichText>
          {attachments(message)}
          {isFinalAnswer(message) && attribution(assignments?.[message.id], message.id)}
          <div className="dt-message-actions"><button className="dt-message-quote" aria-label="引用这条消息" onClick={() => onReference({ conversationId: message.conversationId, messageId: message.id, quote: message.content.slice(0, 4000) })}><Quote size={12}/>引用</button>
            {matter && carried && message.handoff && onSource && <button className="dt-message-origin" onClick={() => onSource(message.handoff!.sourceConversationId, message.handoff!.sourceMessageId)} aria-label="查看主对话原文"><CornerDownRight size={12}/>来自主对话</button>}
            {message.role === "assistant" && voice && <button type="button" className="dt-message-read" aria-label={voice.speakingId === message.id ? "停止朗读" : "朗读全文"} title={voice.speakingId === message.id ? "停止朗读" : "朗读全文"} aria-pressed={voice.speakingId === message.id} onClick={() => voice.speakingId === message.id ? voice.stopPlayback() : void voice.speak(message.content, message.id)}>{voice.speakingId === message.id ? <Square size={10}/> : <Volume2 size={14}/>}</button>}
          </div>
        </div>
      </article>;
    })}
    {stream && <article className="dt-message dt-message-assistant dt-message-stream">{!matter && <span className="dt-avatar dt-avatar-cloud"><OrbitAvatar size={35}/></span>}<div className="dt-message-content"><RichText>{stream}</RichText></div></article>}
    {run && (run.status === "running" || run.status === "queued") && <div className="dt-run-progress" role="status"><LoaderCircle size={14} className="dt-spin"/><span>{run.status === "queued" ? "等待开始…" : stream ? "正在回答…" : "正在处理…"}</span></div>}
    {run && ["failed", "interrupted"].includes(run.status) && <div className="dt-run-failure" role="alert">{run.status === "interrupted" ? "上次运行已中断，可以接着发送新的指令。" : run.error || "本次运行未完成，可以调整请求后重试。"}</div>}
    {run && activities.length > 0 && <details className="dt-run-details"><summary>查看执行过程 <ChevronDown size={12}/></summary><ol>{activities.slice(-12).map(a => <li key={a.id}><span>{a.title}</span>{a.detail && <small>{a.detail.slice(0, 280)}</small>}</li>)}</ol></details>}
    {!matter && !assignments && messages.length > 0 && <div className="dt-result-files">{data.artifacts.filter(a => a.conversationId === messages.at(-1)?.conversationId).slice(-3).map(a => <button key={a.id} onClick={() => onArtifact(a.id)}><FileText size={14}/>{a.title}<ArrowUpRight size={12}/></button>)}</div>}
  </div>;
}
