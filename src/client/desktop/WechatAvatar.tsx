import type { CSSProperties } from "react";
import "./wechat-avatar.css";

type PortraitName = "summer" | "zhuo" | "lin" | "he" | "deer";
type AvatarKind = "person" | "group";

const palettes: Record<PortraitName, { background: string; skin: string; hair: string; shirt: string }> = {
  summer: { background: "#eee6db", skin: "#e9bd9e", hair: "#51443e", shirt: "#ab8675" },
  zhuo: { background: "#e0e7ed", skin: "#dcb195", hair: "#3f444b", shirt: "#718393" },
  lin: { background: "#e8e4dc", skin: "#e4b89b", hair: "#4c4640", shirt: "#92917e" },
  he: { background: "#e5e5ee", skin: "#e7bca5", hair: "#4a4147", shirt: "#9990a6" },
  deer: { background: "#e8e9e2", skin: "#eac4a9", hair: "#6a5143", shirt: "#929e8e" },
};

/** Small, self-contained fictional portraits; real contacts never use this mapping. */
function Portrait({ person }: { person: PortraitName }) {
  const color = palettes[person];
  const longHair = person === "summer" || person === "he";
  return <>
    <rect width="48" height="48" fill={color.background}/>
    {longHair && <path d="M12 24C10 9 17 6 24 6c9 0 14 7 12 19l2 13H10z" fill={color.hair}/>}
    <path d="M7 48v-4c0-8 7-12 17-12s17 4 17 12v4" fill={color.shirt}/>
    <path d="M20 29h8v6c-2 3-6 3-8 0z" fill={color.skin}/>
    <ellipse cx="14" cy="22" rx="2.2" ry="3" fill={color.skin}/>
    <ellipse cx="34" cy="22" rx="2.2" ry="3" fill={color.skin}/>
    <path d="M14 17c0-6 4-10 10-10s10 4 10 10v7c0 6-4 10-10 10s-10-4-10-10z" fill={color.skin}/>
    {person === "summer" && <path d="M12 22V17C12 8 18 5 25 6c8 0 12 6 11 15l-4-2-2-7c-4 5-10 7-15 7l-1 4z" fill={color.hair}/>}
    {person === "zhuo" && <path d="M13 22l-1-9 3-4 1-4 8 1 6-2 6 8-1 10-3-7c-5 2-9 0-14 1l-3 7z" fill={color.hair}/>}
    {person === "lin" && <path d="M12 22V14C13 7 20 5 27 6c8 1 10 8 8 16l-3-7c-6 2-11 0-15-1l-2 8z" fill={color.hair}/>}
    {person === "he" && <path d="M12 24V16C12 7 18 5 25 6c8 0 12 7 11 18l-3-4-2-6c-4 1-7-1-9-3-1 5-4 8-8 9z" fill={color.hair}/>}
    {person === "deer" && <path d="M13 23l-2-7C10 8 17 5 24 6c7-2 14 4 13 11l-3 7-2-8-4-2-4 2-5-3-3 4-1 6z" fill={color.hair}/>}
    <g fill="#4c413c">
      <circle cx="20" cy="23" r="1"/><circle cx="28" cy="23" r="1"/>
    </g>
    {person === "lin" && <g fill="none" stroke="#605a53" strokeWidth="1.2"><rect x="16" y="20" width="7" height="6" rx="2"/><rect x="25" y="20" width="7" height="6" rx="2"/><path d="M23 22h2"/></g>}
    <path d="M22 28q2 1.5 4 0" fill="none" stroke="#b67e6d" strokeWidth="1.1" strokeLinecap="round"/>
    <path d="M19 35l5 4 5-4" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="1.5"/>
  </>;
}

function DefaultAvatar({ kind }: { kind: AvatarKind }) {
  return <>
    <rect width="48" height="48" fill="#eeeff1"/>
    {kind === "group" ? <g fill="#9da2a9">
      <circle cx="18" cy="18" r="6"/><circle cx="32" cy="20" r="5"/>
      <path d="M7 36c0-7 4-11 11-11s11 4 11 11v2H7z"/>
      <path d="M30 27c7-1 11 3 11 10v1h-9v-2c0-3-.7-6-2-9"/>
    </g> : <g fill="#9da2a9">
      <circle cx="24" cy="18" r="7"/>
      <path d="M11 39v-2c0-8 5-12 13-12s13 4 13 12v2z"/>
    </g>}
  </>;
}

function demoPerson(name: string): PortraitName | undefined {
  if (name === "林同学" || name === "林同学 · 小店网站") return "lin";
  return ({ 小夏: "summer", 阿卓: "zhuo", 阿禾: "he", 小鹿: "deer" } as const)[name as "小夏" | "阿卓" | "阿禾" | "小鹿"];
}

function demoGroup(name: string): PortraitName[] | undefined {
  if (name === "周末出游群") return ["summer", "zhuo", "lin", "deer"];
  if (name === "摄影交流小群") return ["he", "deer", "zhuo", "summer"];
  return undefined;
}

export default function WechatAvatar({ name, demo, size = 28, kind }: { name: string; demo: boolean; size?: number; kind?: AvatarKind }) {
  const label = typeof name === "string" ? name.trim() : "";
  const resolvedKind = kind ?? (label.endsWith("群") ? "group" : "person");
  const person = demo && resolvedKind === "person" ? demoPerson(label) : undefined;
  const people = demo && resolvedKind === "group" ? demoGroup(label) : undefined;
  const avatarSize = Number.isFinite(size) && size > 0 ? size : 28;
  return <span className="dt-wechat-avatar" aria-hidden="true" style={{ "--wechat-avatar-size": `${avatarSize}px` } as CSSProperties}>
    <svg viewBox="0 0 48 48" width={avatarSize} height={avatarSize} focusable="false">
      {people ? <>
        <rect width="48" height="48" fill="#f7f7f6"/>
        {people.map((identity, index) => <svg key={index} x={index % 2 === 0 ? 2 : 25} y={index < 2 ? 2 : 25} width="21" height="21" viewBox="0 0 48 48" overflow="hidden"><Portrait person={identity}/></svg>)}
      </> : person ? <Portrait person={person}/> : <DefaultAvatar kind={resolvedKind}/>}
    </svg>
  </span>;
}
