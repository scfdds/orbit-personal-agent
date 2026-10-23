import test from 'node:test';
import assert from 'node:assert/strict';
import { placeCoachmark } from './tour-layout.ts';
test('coachmarks stay on screen at sidebar, workspace and narrow breakpoints',()=>{
 for(const viewport of [{width:1440,height:900},{width:907,height:705},{width:390,height:844},{width:320,height:568}]) {
  for(const target of [{x:10,y:85,width:220,height:240},{x:viewport.width-430,y:5,width:420,height:viewport.height-10}]) {
   for(const side of ['left','right'] as const) {
    const p=placeCoachmark(target,viewport,{width:354,height:440},side);
    assert.ok(p.x>=16);assert.ok(p.y>=16);assert.ok(p.x+p.width<=viewport.width-16);
    assert.ok(p.y+440<=viewport.height-16);
   }
  }
 }
 const p=placeCoachmark({x:10,y:80,width:220,height:220},{width:1440,height:900},{width:354,height:440},'right');
 assert.equal(p.side,'right');assert.ok(p.x>230);
});
