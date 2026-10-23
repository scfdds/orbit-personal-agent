import type { CSSProperties } from "react";
import OrbitAvatar from "./OrbitAvatar.tsx";
import type { VoicePresence as Presence } from "./voice-session-state.ts";

/** A quiet visual anchor. Its level response is driven only by actual input/output samples. */
export default function VoicePresence({ phase, level = 0, small = false }: { phase: Presence; level?: number; small?: boolean }) {
  const intensity = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
  return <div className={`dt-presence dt-presence-cloud dt-presence-${phase}${small ? " dt-presence-small" : ""}`} style={{ "--voice-level": intensity } as CSSProperties} aria-hidden="true">
    <div className="dt-presence-aura"/>
    <OrbitAvatar size={small ? 34 : 160}/>
  </div>;
}
