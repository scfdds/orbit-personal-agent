import { GoalIcon } from "./GoalIcon.tsx";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, ArrowUpRight, X, LayoutGrid, FolderOpen, MessageSquare, PanelsTopLeft, FileCheck2, Scale, ChartNoAxesCombined, BriefcaseBusiness, Bot } from "lucide-react";
import type { Snapshot } from "../shared/types.ts";
import { demoCases, subagentExampleId } from "../shared/demo-guide.ts";
import DemoPreview from "./DemoPreview.tsx";
import { placeCoachmark, type TourRect } from "./tour-layout.ts";
import "./demo-guide.css";

const steps = [
  { label: "全局导航", title: "管理整个工作空间", icon: LayoutGrid, selector: '[data-tour="global-nav"]', side: "right",
    text: "长期目标、应用中心和对话纪要，都是全局能力，不绑定某一段对话。" },
  { label: "项目与对话", title: "Agent 也能管理对话", icon: FolderOpen, selector: '[data-tour="conversations"]', side: "right",
    text: "一个项目，多段对话。Agent 能整理、检索和接续上下文，不必每次重新交代背景。" },
  { label: "对话流", title: "一个主 Agent，组织执行", icon: MessageSquare, selector: '[data-tour="conversation"]', side: "left",
    text: "在这里交代目标、查看进展。主 Agent 调用工具、分派子 Agent，再把结果带回对话。" },
  { label: "右侧工作台", title: "标准化的应用扩展", icon: PanelsTopLeft, selector: '#orbit-workspace', side: "left",
    text: "这里展示内置或从平台安装的应用，以 Skill + MCP + GUI Panel 的标准形态接入。" },
] as const;
const caseIcons = [FileCheck2, Scale, ChartNoAxesCombined, BriefcaseBusiness];
interface Props { state: Snapshot; onClose: () => void; onExample: (id: string, appId?: string) => void; onGoal: () => void }

export default function DemoGuide(p: Props) {
  const [step, setStep] = useState<number | null>(0);
  const [snapshot] = useState(p.state);
  const layer = useRef<HTMLDivElement>(null);
  const closeRef = useRef(p.onClose); closeRef.current = p.onClose;
  useEffect(() => {
    const root = document.getElementById("root");
    const previous = document.activeElement as HTMLElement | null;
    const wasInert = root?.inert;
    if (root) root.inert = true;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const items = [...(layer.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])].filter(e => e.getClientRects().length && !e.closest('[inert]'));
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", key);
    return () => { if (root) root.inert = wasInert || false; window.removeEventListener("keydown", key); if (previous?.isConnected) previous.focus(); else document.querySelector<HTMLButtonElement>(".sidebar-footer")?.focus(); };
  }, []);
  useEffect(() => { layer.current?.querySelector<HTMLElement>('[data-guide-focus]')?.focus(); }, [step]);
  const available = (id: string) => p.state.conversations.some(c => c.id===id && !c.draft);
  return createPortal(<div className="demo-layer" ref={layer}>
    {step === null ? <div className="demo-hub-shade" onMouseDown={e=>{if(e.target===e.currentTarget)p.onClose();}}>
      <section className="demo-hub" role="dialog" aria-modal="true" aria-labelledby="guide-title">
        <header className="demo-hub-header"><span>ORBIT · 演示导览</span><button className="demo-close" aria-label="关闭演示导览" onClick={p.onClose}><X size={18}/></button></header>
        <div className="demo-hub-body">
          <div className="demo-intro"><h1 id="guide-title" tabIndex={-1} data-guide-focus>看看实际协作</h1></div>
          <div className="demo-cases">{demoCases.map((item,i)=>{const Icon=caseIcons[i]!; return <button key={item.id} className={`demo-case demo-case-${item.id}`} aria-label={item.action} disabled={!available(item.conversationId)} onClick={()=>p.onExample(item.conversationId,item.id)}>
            <span className="demo-case-icon"><Icon size={20}/></span><strong>{item.title}</strong><ArrowUpRight size={15}/>
          </button>;})}</div>
          <div className="demo-more"><button disabled={!available(subagentExampleId)} onClick={()=>p.onExample(subagentExampleId)}><Bot size={17}/><span>子 Agent 分工</span><ArrowUpRight size={14}/></button><button disabled={!p.state.works.length} onClick={p.onGoal}><GoalIcon size={17}/><span>长期目标</span><ArrowUpRight size={14}/></button></div>
          <p className="demo-footnote">预置案例 · 查看无需模型配置</p>
          <div className="demo-hub-footer"><button onClick={()=>setStep(0)}>重新导览</button><button className="demo-next" onClick={p.onClose}>完成</button></div>
        </div>
      </section>
    </div> : <>
      <DemoPreview state={snapshot} step={step}/>
      <Coachmark step={step} onStep={setStep} onClose={p.onClose} onFinish={()=>setStep(null)}/>
    </>}
  </div>, document.body);
}

function Coachmark({ step, onStep, onClose, onFinish }: {step:number;onStep:(step:number)=>void;onClose:()=>void;onFinish:()=>void}) {
  const current=steps[step]!;
  const card=useRef<HTMLElement>(null);
  const [geometry,setGeometry]=useState<{target:TourRect;width:number;height:number;cardHeight:number} | null>(null);
  useLayoutEffect(()=>{
    const preview=document.querySelector<HTMLElement>('.demo-preview');
    const target=preview?.querySelector<HTMLElement>(current.selector);
    if(!preview || !target || !card.current) return;
    const measure=()=>{
      const w=window.innerWidth,h=window.innerHeight;
      const r=target.getBoundingClientRect();
      const x=Math.max(8,r.x-5),y=Math.max(8,r.y-5);
      const value={target:{x,y,width:Math.max(0,Math.min(w-8,r.right+5)-x),height:Math.max(0,Math.min(h-8,r.bottom+5)-y)},width:w,height:h,cardHeight:card.current!.offsetHeight};
      preview.style.height=w<760?`${Math.max(120,h-value.cardHeight-44)}px`:'';
      setGeometry(prev=>JSON.stringify(prev)===JSON.stringify(value)?prev:value);
    };
    const observer=new ResizeObserver(measure);observer.observe(target);observer.observe(card.current);observer.observe(preview);
    window.addEventListener('resize',measure);window.addEventListener('scroll',measure,true);measure();
    return()=>{observer.disconnect();window.removeEventListener('resize',measure);window.removeEventListener('scroll',measure,true);preview.style.height='';};
  },[step,current.selector]);
  const position=geometry ? placeCoachmark(geometry.target,{width:geometry.width,height:geometry.height},{width:354,height:geometry.cardHeight},current.side) : {x:16,y:16,width:354,side:"bottom"};
  const r=geometry?.target;
  const Icon=current.icon;
  return <div className="demo-tour-overlay">
    <svg className="demo-spotlight" width="100%" height="100%" aria-hidden="true"><defs><mask id="demo-spotlight-mask"><rect width="100%" height="100%" fill="white"/>{r&&<rect x={r.x} y={r.y} width={r.width} height={r.height} rx="12" fill="black"/>}</mask></defs><rect width="100%" height="100%" fill="#18202d" fillOpacity=".48" mask="url(#demo-spotlight-mask)"/>{r&&<rect className="demo-highlight" x={r.x} y={r.y} width={r.width} height={r.height} rx="12" fill="none" stroke="#ffffff" strokeWidth="2"/>}</svg>
    {geometry && position.side !== "bottom" && <span className={`demo-coachmark-pointer ${position.side}`} aria-hidden="true" style={{left:position.side==="right"?position.x-5:position.x+position.width-5,top:position.y+33}}/>}
    <section ref={card} className="demo-coachmark" style={{left:position.x,top:position.y,width:position.width,visibility:geometry?'visible':'hidden'}} role="dialog" aria-modal="true" aria-labelledby="demo-step-title" aria-describedby="demo-step-text">
      <div className="demo-coachmark-top"><span><Icon size={16}/>{current.label} <b>{step+1} / {steps.length}</b></span><button className="demo-close" aria-label="退出演示导览" onClick={onClose}><X size={16}/></button></div>
      <nav className="demo-step-progress" aria-label="导览步骤">{steps.map((s,i)=><button key={s.label} aria-label={`第 ${i+1} 步：${s.label}`} aria-current={i===step?'step':undefined} onClick={()=>onStep(i)}><span className={i<=step?'filled':''}/></button>)}</nav>
      <div className="demo-coachmark-copy" key={step}><h2 id="demo-step-title" tabIndex={-1} data-guide-focus>{current.title}</h2><p id="demo-step-text">{current.text}</p></div>
      <footer className="demo-coachmark-footer"><button className="demo-skip" onClick={onClose}>跳过</button><div>{step>0&&<button className="demo-previous" aria-label="上一步" onClick={()=>onStep(step-1)}><ArrowLeft size={16}/></button>}<button className="demo-next" onClick={()=>step===steps.length-1?onFinish():onStep(step+1)}>{step===steps.length-1?"看案例":"下一步"}<ArrowRight size={15}/></button></div></footer>
    </section>
  </div>;
}
