import type { CSSProperties } from "react";
import "./orbit-avatar.css";

/** Shared identity asset; callers retain their own labels and interaction semantics. */
export default function OrbitAvatar({ size = 36, className = "", decorative = true }: { size?: number; className?: string; decorative?: boolean }) {
  return <span className={`dt-orbit-avatar ${className}`} style={{ "--avatar-size": `${size}px` } as CSSProperties}>
    <img src="/images/orbit-cloud.png" alt={decorative ? "" : "Orbit 云朵助手"} aria-hidden={decorative || undefined} width={size} height={size} draggable={false}/>
  </span>;
}
