import type { ReactNode } from "react";
import { BriefcaseBusiness, Brain, Scale, Mic, Table2, Presentation, BookOpen, ScanText, Code2, Braces, Map, Languages, GraduationCap, Utensils } from "lucide-react";

// Small, original app marks. Navigation stays quiet; content gets an identity.
const marks: Record<string, { background: string; drawing: ReactNode }> = {
  career: { background: "#476cce", drawing: <><BriefcaseBusiness x={12} y={14} width={40} height={38} color="#eef3ff" strokeWidth={1.8}/><circle cx="49" cy="48" r="9" fill="#baf1dc"/><path d="m45 48 3 3 5-6" fill="none" stroke="#287a62" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></> },
  portfolio: { background: "#15877a", drawing: <><rect x="11" y="13" width="42" height="39" rx="6" fill="#dcfff0"/><path d="M18 42h28" stroke="#99cfc1" strokeWidth="2"/><path d="m19 36 9-10 8 6 11-15" stroke="#16877a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/><circle cx="47" cy="17" r="5" fill="#ffe491"/></> },
  litigation: { background: "#7860bd", drawing: <><path d="M18 11h21l9 9v34H18z" fill="#5e459f"/><Scale x={10} y={12} width={44} height={40} color="#fff6df" strokeWidth={1.7}/></> },
  meeting: { background: "#ec8b4a", drawing: <Mic x={13} y={12} width={38} height={40} color="white" strokeWidth={1.8}/> },
  sheets: { background: "#22996b", drawing: <Table2 x={12} y={12} width={40} height={40} color="#e3fff1" strokeWidth={1.8}/> },
  slides: { background: "#e0a034", drawing: <Presentation x={12} y={12} width={40} height={40} color="white" strokeWidth={1.8}/> },
  papers: { background: "#5380cc", drawing: <BookOpen x={12} y={12} width={40} height={40} color="white" strokeWidth={1.8}/> },
  law: { background: "#7b6699", drawing: <Scale x={12} y={12} width={40} height={40} color="#fff4d8" strokeWidth={1.8}/> },
  scan: { background: "#419cb0", drawing: <ScanText x={12} y={12} width={40} height={40} color="white" strokeWidth={1.8}/> },
  code: { background: "#363d50", drawing: <Code2 x={12} y={12} width={40} height={40} color="#b5e6ed" strokeWidth={1.8}/> },
  api: { background: "#6c68d7", drawing: <Braces x={12} y={12} width={40} height={40} color="white" strokeWidth={1.8}/> },
  travel: { background: "#419daa", drawing: <Map x={12} y={12} width={40} height={40} color="#e6fff5" strokeWidth={1.8}/> },
  language: { background: "#418bce", drawing: <Languages x={12} y={12} width={40} height={40} color="white" strokeWidth={1.8}/> },
  practice: { background: "#d58363", drawing: <GraduationCap x={10} y={12} width={44} height={40} color="#fff5d9" strokeWidth={1.8}/> },
  recipe: { background: "#db6784", drawing: <Utensils x={14} y={12} width={36} height={40} color="#fff4e0" strokeWidth={1.8}/> },
  subagents: { background: "#6576cf", drawing: <><path d="M32 20v-7" stroke="#d8e0ff" strokeWidth="3"/><circle cx="32" cy="12" r="4" fill="#ffe094"/><rect x="12" y="22" width="40" height="29" rx="11" fill="white"/><rect x="20" y="29" width="24" height="14" rx="6" fill="#c5d0fc"/><path d="M26 33v5m12-5v5" stroke="#4256a4" strokeWidth="3" strokeLinecap="round"/></> },
  files: { background: "#409ce6", drawing: <><path d="M10 17a4 4 0 0 1 4-4h13l7 7h16a4 4 0 0 1 4 4v25H10z" fill="#b7e4ff"/><path d="M10 26h44v23a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4z" fill="white"/><path d="M20 36h24" stroke="#91c9f2" strokeWidth="4" strokeLinecap="round"/></> },
  browser: { background: "#1999b0", drawing: <><circle cx="32" cy="32" r="22" fill="#dcfaff"/><circle cx="32" cy="32" r="16" fill="#75d7e5"/><path d="m39 23-4 13-12 5 5-13z" fill="#e56a62"/><path d="m39 23-11 5 7 8z" fill="white"/><circle cx="32" cy="32" r="2" fill="#187087"/></> },
  goals: { background: "#ea875d", drawing: <><circle cx="30" cy="34" r="22" fill="#fff0d9"/><circle cx="30" cy="34" r="14" fill="#f1b584"/><circle cx="30" cy="34" r="6" fill="white"/><path d="m31 33 17-17m-9 0h9v9" stroke="#704536" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/></> },
  contracts: { background: "#3067eb", drawing: <><path d="M18 11h20l9 9v34H18z" fill="#1642b2" opacity=".4"/><path d="M16 9h21l9 9v34H16z" fill="white"/><path d="M37 9v10h9" fill="#aac9ff"/><path d="M23 27h15M23 33h10" stroke="#92b3f7" strokeWidth="3" strokeLinecap="round"/><circle cx="42" cy="44" r="12" fill="#a5f1ce"/><path d="m36 44 4 4 8-9" fill="none" stroke="#176b51" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></> },
  feedback: { background: "#ffb735", drawing: <><path d="M28 23h23v24H38l-8 7v-7h-2z" fill="#b9670d" opacity=".35"/><path d="M10 13h35v28H26l-11 8v-8h-5z" fill="white"/><circle cx="20" cy="27" r="2.5" fill="#e59612"/><circle cx="28" cy="27" r="2.5" fill="#e59612"/><circle cx="36" cy="27" r="2.5" fill="#e59612"/></> },
  memory: { background: "#8556df", drawing: <Brain x={12} y={12} width={40} height={40} style={{ width: 40, height: 40 }} color="white" strokeWidth={1.6} /> },
  opportunities: { background: "#189876", drawing: <><rect x="11" y="14" width="12" height="35" rx="4" fill="#b5efd1"/><rect x="26" y="14" width="12" height="25" rx="4" fill="white"/><rect x="41" y="14" width="12" height="31" rx="4" fill="#fae18b"/></> },
  design: { background: "#242429", drawing: <><circle cx="21" cy="21" r="10" fill="#ff7168"/><rect x="34" y="11" width="19" height="19" rx="6" fill="#62dcff"/><rect x="11" y="34" width="19" height="19" rx="6" fill="#df90ff"/><path d="m44 33 4 7 8 3-8 4-4 8-4-8-7-4 7-3z" fill="#cbef5c"/></> },
  teaching: { background: "#5673e6", drawing: <><ellipse cx="33" cy="36" rx="19" ry="21" fill="#25365f"/><ellipse cx="33" cy="40" rx="13" ry="16" fill="white"/><ellipse cx="27" cy="30" rx="3" ry="5" fill="white"/><ellipse cx="39" cy="30" rx="3" ry="5" fill="white"/><circle cx="28" cy="31" r="1.5" fill="#25365f"/><circle cx="38" cy="31" r="1.5" fill="#25365f"/><path d="m28 36 5 5 5-5" fill="#ffbf44"/><path d="m10 18 22-9 22 9-22 9z" fill="#ffce69"/><path d="M50 19v12" stroke="#ffce69" strokeWidth="3"/></> },
  market: { background: "#ed4649", drawing: <><path d="M13 44h7V31h-7zm13 0h7V23h-7zm13 0h7V15h-7z" fill="white" opacity=".4"/><path d="m12 46 13-12 8 4 18-24M40 14h11v11" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/></> },
  watchlist: { background: "#fff1ee", drawing: <><path d="m32 10 6 13 14 2-10 10 2 15-12-7-13 7 3-15-11-10 15-2z" fill="#f25448"/><path d="m21 34 8-7 7 4 9-9" stroke="white" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round"/></> },
  signature: { background: "#08a79c", drawing: <><path d="M16 11h26v42H16z" fill="white"/><path d="M23 22h12M23 28h9" stroke="#9ad8d1" strokeWidth="3" strokeLinecap="round"/><path d="m29 46 2-9 17-17 7 7-18 17z" fill="#ffdc85"/><path d="m29 46 2-9 6 7z" fill="#925e36"/><path d="m45 23 7 7" stroke="#0b756e" strokeWidth="2"/></> },
  research: { background: "#3566ef", drawing: <><path d="M12 44 29 14h9L23 44z" fill="white"/><path d="m38 14 15 30H41L30 25z" fill="#9cb8ff"/><path d="m14 46 17-9 22 11" fill="none" stroke="#c0eaff" strokeWidth="3" strokeLinecap="round"/></> },
};

export function AppMark({ id, size = 52 }: { id: string; size?: number }) {
  const mark = marks[id] || marks.opportunities;
  return <span className="app-mark" style={{ width: size, height: size, background: mark.background }} aria-hidden="true">
    <svg viewBox="0 0 64 64" fill="none">{mark.drawing}</svg>
  </span>;
}

const palettes = [
  ["#e7dcff", "#9a74e8", "#3c2764"],
  ["#dcf1e4", "#60b58a", "#244b3d"],
  ["#ffebc8", "#eba84e", "#5f4022"],
  ["#dceaff", "#719dea", "#284569"],
  ["#ffe1df", "#e88e86", "#6b3538"],
  ["#d7f1ef", "#52b2b0", "#275658"],
];

export function AgentAvatar({ identity, size = 44, variant }: { identity: string; size?: number; variant?: number }) {
  const hash = Array.from(identity).reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 7);
  const index = variant ?? hash % palettes.length;
  const [background, body, ink] = palettes[index % palettes.length];
  const shape = index % 3;
  return <span className="agent-avatar" style={{ width: size, height: size, background }} aria-hidden="true">
    <svg viewBox="0 0 64 64" fill="none">
      {shape === 0 ? <><path d="M17 50V30a15 15 0 0 1 30 0v20" fill={body}/><path d="m26 18-4-7m14 7 6-8" stroke={ink} strokeWidth="3" strokeLinecap="round"/></> : shape === 1 ? <><rect x="12" y="21" width="40" height="30" rx="13" fill={body}/><path d="M32 22v-8" stroke={ink} strokeWidth="3"/><circle cx="32" cy="12" r="4" fill={body}/></> : <path d="M14 38c0-13 6-24 13-24 5 0 5 8 10 8 8 0 14 9 14 18 0 10-9 15-19 15S14 48 14 38" fill={body}/>}
      <rect x="20" y="31" width="24" height="13" rx="6.5" fill="white" fillOpacity=".92"/>
      <path d="M26 35v4M38 35v4" stroke={ink} strokeWidth="3" strokeLinecap="round"/>
      <path d="M29 47q3 3 6 0" stroke={ink} strokeWidth="2" strokeLinecap="round"/>
    </svg>
  </span>;
}
