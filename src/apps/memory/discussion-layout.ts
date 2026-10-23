import type { Conversation } from '../../shared/types.ts';
import type { DiscussionNode } from '../../shared/discussion.ts';
type Box = DiscussionNode & { x:number; y:number; width:number; height:number };
type Group = { id:string; title:string; x:number; y:number; width:number; height:number; branch:boolean };

// Reading runs down a conversation. Only inherited conversations add horizontal depth.
export function layoutDiscussion(conversations:Conversation[], byConversation:Record<string,DiscussionNode[]>) {
  const boxes:Box[] = [], headers:Group[] = [];
  const edges:{from:string;to:string;branch:boolean}[] = [];
  const placed = new Set<string>(), columnBottom = new Map<number,number>();
  const width = 332, gap = 72, inset = 14, headingHeight = 62;
  function nodeHeight(node:DiscussionNode) {
    const titleLines = Math.min(2, Math.max(1, Math.ceil(node.question.length / 20)));
    const answerLines = Math.min(3, Math.max(1, Math.ceil((node.takeaway || node.answer).length / 25)));
    return 50 + titleLines * 22 + answerLines * 20;
  }
  function place(c:Conversation, depth:number, requestedTop:number):Group | undefined {
    if (placed.has(c.id)) return;
    placed.add(c.id);
    const top = Math.max(requestedTop, columnBottom.get(depth) || 24), left = 32 + depth * (width + gap);
    const group:Group = {id:c.id,title:c.title,x:left,y:top,width,height:headingHeight,branch:!!c.parentId};
    headers.push(group);
    let y = top + headingHeight;
    const own:Box[] = [];
    for (const node of byConversation[c.id] || []) {
      // Keep a stable reading rhythm; long original questions still have room for two title lines.
      const height = nodeHeight(node);
      const box = {...node,x:left+inset,y,width:width-inset*2,height};
      boxes.push(box); own.push(box); y += height + 2;
    }
    group.height = Math.max(headingHeight + 48, y - top + 10);
    columnBottom.set(depth, top + group.height + 32);
    const children = conversations.filter(child => child.parentId === c.id).map(child => ({
      child, anchor:own.find(b => b.rounds.some(r => r.messages.some(m => m.id === child.forkMessageId)))
    })).sort((a,b) => (a.anchor?.y ?? y) - (b.anchor?.y ?? y));
    for (const {child,anchor} of children) {
      const childHeight = headingHeight + 10 + (byConversation[child.id] || []).reduce((sum,n)=>sum+nodeHeight(n)+2,0);
      place(child, depth+1, anchor ? anchor.y+anchor.height/2-childHeight/2 : top);
      const first = boxes.find(b => b.conversationId === child.id);
      // Never invent a branch source when its original message is unavailable.
      if (anchor && first) edges.push({from:anchor.id,to:first.id,branch:true});
    }
    return group;
  }
  for (const c of conversations.filter(c => !conversations.some(p => p.id === c.parentId))) place(c,0,24);
  for (const c of conversations) if (!placed.has(c.id)) place(c,0,24);
  return {boxes,headers,edges,
    width:Math.max(396,...headers.map(h=>h.x+h.width+32)),
    height:Math.max(240,...headers.map(h=>h.y+h.height+32))};
}
