import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Scan, ChevronsDown, ChevronDown, GitBranch, MessageSquare, RefreshCw } from 'lucide-react';
import type { Conversation } from '../../shared/types.ts';
import type { DiscussionNode } from '../../shared/discussion.ts';
import { IconButton } from '../../client/ui.tsx';

import { layoutDiscussion } from './discussion-layout.ts';
import { anchoredScroll, bindMapGestures, canvasOffset, clampZoom, fitZoom, MAP_BOTTOM_SPACE, MIN_ZOOM, MAX_ZOOM, type Point } from './map-viewport.ts';
const viewCache=new Map<string,{zoom:number;left:number;top:number}>();
interface Props {viewKey:string;overview?:string;overviewPending?:boolean;overviewFailed?:boolean;onRetryOverview?:()=>void;conversations:Conversation[];nodes:Record<string,DiscussionNode[]>;selectedId:string;onSelect:(node:DiscussionNode)=>void;onExpand:(id:string)=>void;}
export default function MindMap({viewKey,overview,overviewPending,overviewFailed,onRetryOverview,conversations,nodes,selectedId,onSelect,onExpand}:Props){
  const viewport=useRef<HTMLDivElement>(null);
  const intro=useRef<HTMLElement>(null);
  const [leadingSpace,setLeadingSpace]=useState(0);
  const hasOverview=!!(overview||overviewPending||overviewFailed);
  const cached=useRef(viewCache.get(viewKey));
  const restoring=useRef(!!cached.current);
  const [zoom,setZoom]=useState(cached.current?.zoom||1);
  const [size,setSize]=useState({width:0,height:0});
  const [summaryOpen,setSummaryOpen]=useState(false),[summaryLong,setSummaryLong]=useState(false);
  const summary=useRef<HTMLParagraphElement>(null);
  const autoFit=useRef(!cached.current);
  const overviewFit=useRef(false);
  const zoomRef=useRef(cached.current?.zoom||1);
  const pendingScroll=useRef<{left:number;top:number}|null>(null);
  const drag=useRef<{x:number;y:number;left:number;top:number}|null>(null);
  const layout=useMemo(()=>layoutDiscussion(conversations,nodes),[conversations,nodes]);
  const offset=canvasOffset(layout,size,zoom,leadingSpace);
  const geometry=useRef({layout,size,leadingSpace});
  geometry.current={layout,size,leadingSpace};
  const currentView=useRef({zoom});currentView.current={zoom};
  useLayoutEffect(()=>{
    if(restoring.current&&size.width&&viewport.current){viewport.current.scrollTo({left:cached.current!.left,top:cached.current!.top});restoring.current=false;}
  },[size.width,size.height]);
  useLayoutEffect(()=>{const el=viewport.current;return()=>{if(el)viewCache.set(viewKey,{...currentView.current,left:el.scrollLeft,top:el.scrollTop});};},[viewKey]);
  useLayoutEffect(()=>{
    const el=viewport.current;if(!el)return;
    const measure=()=>setSize(previous=>previous.width===el.clientWidth&&previous.height===el.clientHeight?previous:{width:el.clientWidth,height:el.clientHeight});
    measure();const observer=new ResizeObserver(measure);observer.observe(el);return()=>observer.disconnect();
  },[]);
  useLayoutEffect(()=>{
    const measure=()=>setLeadingSpace(intro.current?.offsetHeight||0);
    measure();const observer=new ResizeObserver(measure);
    if(intro.current)observer.observe(intro.current);
    return()=>observer.disconnect();
  },[hasOverview]);
  useLayoutEffect(()=>{
    const el=summary.current;if(!el)return;
    const measure=()=>{if(!summaryOpen)setSummaryLong(el.scrollHeight>el.clientHeight+1);};
    measure();const observer=new ResizeObserver(measure);observer.observe(el);return()=>observer.disconnect();
  },[overview,summaryOpen]);
  function fit(all=overviewFit.current){
    const {layout,size,leadingSpace}=geometry.current;if(!size.width||!size.height)return;
    autoFit.current=true;overviewFit.current=all;pendingScroll.current=null;
    const value=all?fitZoom(layout,size,leadingSpace):Math.min(1,Math.max(.85,fitZoom(layout,size,leadingSpace)));zoomRef.current=value;setZoom(value);viewport.current?.scrollTo({left:0,top:0});
  }
  useLayoutEffect(()=>{if(autoFit.current)fit();},[size.width,size.height,layout.width,layout.height,leadingSpace]);
  useLayoutEffect(()=>{
    if(!selectedId)return;const box=layout.boxes.find(n=>n.id===selectedId),el=viewport.current;if(!box||!el)return;
    const x=box.x*zoom+offset.x,y=box.y*zoom+offset.y;
    if(x<el.scrollLeft||x+box.width*zoom>el.scrollLeft+el.clientWidth||y<el.scrollTop||y+box.height*zoom>el.scrollTop+el.clientHeight-MAP_BOTTOM_SPACE)el.scrollTo({left:Math.max(0,x-32),top:Math.max(0,y-16),behavior:'smooth'});
  },[selectedId,leadingSpace,size.width]);
  function scale(next:number,point?:Point){
    const value=clampZoom(next),el=viewport.current;autoFit.current=false;
    if(Math.abs(value-zoomRef.current)<.0001)return;
    if(el){
      const rect=el.getBoundingClientRect(),{layout,size,leadingSpace}=geometry.current;
      const anchor=point?{x:point.x-rect.left,y:point.y-rect.top}:{x:el.clientWidth/2,y:(el.clientHeight-MAP_BOTTOM_SPACE)/2};
      const current=pendingScroll.current?{x:pendingScroll.current.left,y:pendingScroll.current.top}:{x:el.scrollLeft,y:el.scrollTop};
      const scroll=anchoredScroll(layout,size,zoomRef.current,value,current,anchor,leadingSpace);
      pendingScroll.current={left:Math.max(0,Math.min(Math.max(0,layout.width*value-el.clientWidth),scroll.x)),top:Math.max(0,Math.min(Math.max(0,leadingSpace+layout.height*value+MAP_BOTTOM_SPACE-el.clientHeight),scroll.y))};
    }
    zoomRef.current=value;setZoom(value);
  }
  useLayoutEffect(()=>{
    if(pendingScroll.current){viewport.current?.scrollTo(pendingScroll.current);pendingScroll.current=null;}
  },[zoom]);
  useEffect(()=>{
    const el=viewport.current;if(!el)return;
    return bindMapGestures(el,{zoom:(factor,point)=>scale(zoomRef.current*factor,point),pan:()=>{autoFit.current=false;}});
  },[]);
  useEffect(()=>{
    const keydown=(event:KeyboardEvent)=>{
      const el=viewport.current,target=event.target;
      if(event.defaultPrevented||event.isComposing||event.altKey||!(event.metaKey||event.ctrlKey)||!el?.getClientRects().length)return;
      // Leave text editing, selects and open dialogs to their own keyboard interactions.
      if(target instanceof HTMLElement&&(target.isContentEditable||target.closest('input,textarea,select,[role="textbox"]')))return;
      if(document.querySelector('[role="dialog"],dialog[open]'))return;
      const plus=['+','='].includes(event.key)||['Equal','NumpadAdd'].includes(event.code);
      const minus=event.key==='-'||['Minus','NumpadSubtract'].includes(event.code);
      const zero=event.key==='0';
      if(!plus&&!minus&&!zero)return;
      event.preventDefault();event.stopPropagation();
      if(zero)fit(true);else scale(zoomRef.current+(plus ? .1 : -.1));
    };
    window.addEventListener('keydown',keydown,{capture:true});
    return ()=>window.removeEventListener('keydown',keydown,{capture:true});
  },[]);
  return <div className="turn-map-shell">
    <div ref={viewport} className={`turn-map ${zoom<.65?'turn-map-overview':''}`} tabIndex={0} role="region" aria-label="讨论脉络导图"
      onPointerDown={e=>{if(e.button!==0||(e.target as HTMLElement).closest('button,select,.turn-topic-intro'))return;const el=e.currentTarget;autoFit.current=false;drag.current={x:e.clientX,y:e.clientY,left:el.scrollLeft,top:el.scrollTop};el.setPointerCapture(e.pointerId);}}
      onPointerMove={e=>{if(drag.current){e.currentTarget.scrollLeft=drag.current.left+drag.current.x-e.clientX;e.currentTarget.scrollTop=drag.current.top+drag.current.y-e.clientY;}}} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
    {hasOverview&&<section ref={intro} className={`turn-topic-intro ${summaryOpen?'expanded':''}`} aria-label="话题总结">
      {overview?<p ref={summary} className="turn-topic-overview" id="topic-overview-text">{overview}</p>:overviewPending?<div className="turn-overview-placeholder" aria-label="正在整理话题总结"><i/><i/></div>:null}
      {(summaryLong||summaryOpen)&&<button className="turn-overview-toggle" aria-expanded={summaryOpen} aria-controls="topic-overview-text" onClick={()=>setSummaryOpen(!summaryOpen)}>{summaryOpen?'收起':'展开'}<ChevronDown size={12}/></button>}
      {overviewFailed&&<IconButton label="重试话题总结" onClick={onRetryOverview}><RefreshCw size={13}/></IconButton>}
    </section>}
      <div style={{position:'relative',width:Math.max(size.width,layout.width*zoom),height:Math.max(size.height-leadingSpace,layout.height*zoom+MAP_BOTTOM_SPACE),overflow:'hidden'}}><div className="turn-canvas" style={{width:layout.width,height:layout.height,left:offset.x,top:offset.y-leadingSpace,transform:`scale(${zoom})`}}>
        <svg width={layout.width} height={layout.height} className="turn-edges" aria-hidden="true">{layout.edges.map(edge=>{
          const from=layout.boxes.find(n=>n.id===edge.from)!,to=layout.boxes.find(n=>n.id===edge.to)!;
          const target=layout.headers.find(h=>h.id===to.conversationId)!;
          const x=from.x+from.width+14,y=from.y+from.height/2,endX=target.x,endY=target.y+31;
          const curve=(endX-x)*.55;
          const path=`M${x},${y} C${x+curve},${y} ${endX-curve},${endY} ${endX},${endY}`;
          return <g key={`${edge.from}-${edge.to}`}><path className="turn-branch-edge" style={{strokeWidth:Math.max(1.25,1/zoom)}} d={path}/><circle className="turn-branch-origin" cx={x} cy={y} r={3}/></g>;
        })}</svg>
        {layout.headers.map(h=><div className="turn-conversation-group" aria-label={h.title} role="group" style={{left:h.x,top:h.y,width:h.width,height:h.height}} key={h.id}>
          <div className="turn-thread-heading">{h.branch?<GitBranch size={14}/>:<MessageSquare size={14}/>}<span title={h.title}>{h.title}</span></div>
        </div>)}
        {layout.boxes.map(node=><article className={`turn-node ${selectedId===node.id?'selected':''}`} data-node={node.id} key={node.id} style={{left:node.x,top:node.y,width:node.width,height:node.height}}>
          <button className="turn-node-body" aria-label={`查看原始对话：${node.question}`} aria-pressed={selectedId===node.id} onClick={()=>{autoFit.current=false;onSelect(node);}}><div className="turn-question"><h3 title={node.question}>{node.question}</h3></div><p>{node.takeaway||node.answer}</p></button>
          <div className="turn-node-footer"><span className="turn-source-range">第 {node.rounds[0]?.ordinal}{node.rounds.length>1?`–${node.rounds.at(-1)!.ordinal}`:''} 轮</span>
          {(node.rounds.length>1||node.collapseId)&&<button className="turn-expand" onClick={()=>onExpand(node.collapseId||node.id)}><ChevronsDown size={11} style={node.collapseId?{transform:'rotate(180deg)'}:undefined}/>{node.collapseId?'收起追问':'展开追问'}</button>}</div>
        </article>)}
      </div></div>
      {!layout.boxes.length&&<div className="memory-map-empty">还没有对话内容</div>}
    </div>
    <div className="turn-map-tools">
      <div role="group" aria-label="画布缩放">
        <IconButton label="缩小导图" title="缩小导图 · ⌘− / Ctrl−" aria-keyshortcuts="Meta+- Control+-" disabled={zoom<=MIN_ZOOM} onClick={()=>scale(zoomRef.current-.1)}><Minus size={14}/></IconButton>
        <button className="turn-zoom-value" aria-label="恢复实际大小" title="恢复 100%" onClick={()=>scale(1)}>{Math.round(zoom*100)}%</button>
        <IconButton label="放大导图" title="放大导图 · ⌘+ / Ctrl+" aria-keyshortcuts="Meta+= Control+=" disabled={zoom>=MAX_ZOOM} onClick={()=>scale(zoomRef.current+.1)}><Plus size={14}/></IconButton>
        <IconButton label="适配全部对话" title="适配全部对话 · ⌘0 / Ctrl0" aria-keyshortcuts="Meta+0 Control+0" onClick={()=>fit(true)}><Scan size={14}/></IconButton>
      </div>
    </div>
  </div>;
}
