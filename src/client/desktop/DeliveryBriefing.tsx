import { Square, Volume2 } from "lucide-react";
import type { AssistantDelivery } from "../../shared/delivery.ts";
import type { VoiceController } from "./useVoice.ts";
import VoicePresence from "./VoicePresence.tsx";

export default function DeliveryBriefing({ delivery, ready, focusMatched, voice, onStop, onReplay }: {
  delivery: AssistantDelivery; ready: boolean; focusMatched: boolean; voice: VoiceController; onStop(): void; onReplay(): void;
}) {
  if (delivery.kind === "preview") return <section className="dt-briefing" aria-label="资料已接入" data-delivery-id={delivery.id}>
    <div className="dt-briefing-top"><span className="dt-briefing-label"><VoicePresence small phase="working"/>{ready ? "正在看这份资料" : "正在打开内容"}</span></div>
    <p>{delivery.target?.title}</p>
  </section>;
  const playing = voice.speakingId === delivery.id && voice.playback !== "idle";
  return <section className={`dt-briefing ${playing ? "dt-briefing-speaking" : ""}`} aria-label="本次讲解" data-delivery-id={delivery.id}>
    <div className="dt-briefing-top"><span className="dt-briefing-label">
      <VoicePresence small phase={!ready || playing && voice.playback === "loading" ? "preparing" : playing ? "speaking" : "listening"} level={playing ? voice.outputLevel : 0}/>
      {!ready ? "正在打开内容" : playing ? voice.playback === "loading" ? "正在准备讲解" : "Orbit 正在讲解" : "Orbit"}
    </span><button type="button" className="dt-briefing-play" disabled={!ready} onClick={playing ? onStop : onReplay} aria-label={playing ? "停止本次讲解" : "重听本次讲解"}>{playing ? <Square size={11}/> : <Volume2 size={14}/>}</button></div>
    <p>{delivery.spokenText}</p>
    {delivery.target && <div className="dt-briefing-source"><span>{!ready ? "正在准备" : focusMatched ? "已定位相关内容" : "已打开"}</span><span>{delivery.target.title}</span></div>}
  </section>;
}
