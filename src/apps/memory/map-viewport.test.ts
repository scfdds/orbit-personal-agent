import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchoredScroll, bindMapGestures, canvasOffset, fitZoom, MAP_BOTTOM_SPACE, type Point } from './map-viewport.ts';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < .000001, `${a} != ${b}`);
const emit = (target: EventTarget, type: string, props = {}) => {
  const event = Object.assign(new Event(type, { cancelable: true }), props);
  target.dispatchEvent(event); return event;
};

test('fit includes wide and deep branches, reserves composer space and does not enlarge small maps', () => {
  const viewport = { width: 1200, height: 720 };
  for (const content of [{ width: 3600, height: 1300 }, { width: 1300, height: 2800 }]) {
    const zoom = fitZoom(content, viewport), offset = canvasOffset(content, viewport, zoom);
    assert.ok(content.width * zoom <= viewport.width - 48);
    assert.ok(content.height * zoom <= viewport.height - MAP_BOTTOM_SPACE - 20);
    assert.ok(offset.x >= 0 && offset.y >= 0);
  }
  assert.equal(fitZoom({ width: 400, height: 250 }, viewport), 1);
});

test('cursor anchor survives zoom and the transition between centered and scrollable canvas', () => {
  const content = { width: 2000, height: 1000 }, viewport = { width: 1000, height: 700 };
  const scroll = { x: 80, y: 20 }, anchor = { x: 620, y: 330 };
  for (const [from, to] of [[1, 1.3], [.4, .8], [.8, .4]]) {
    const before = canvasOffset(content, viewport, from!), after = canvasOffset(content, viewport, to!);
    const next = anchoredScroll(content, viewport, from!, to!, scroll, anchor);
    near((scroll.x + anchor.x - before.x) / from!, (next.x + anchor.x - after.x) / to!);
    near((scroll.y + anchor.y - before.y) / from!, (next.y + anchor.y - after.y) / to!);
  }
});

test('scrolling introduction reserves unscaled space while fit and pinch keep graph coordinates stable', () => {
  const content={width:1204,height:1045},viewport={width:1440,height:900},leading=102;
  const fitted=fitZoom(content,viewport,leading),offset=canvasOffset(content,viewport,fitted,leading);
  assert.ok(offset.y>=leading);
  assert.ok(offset.y+content.height*fitted<=viewport.height-MAP_BOTTOM_SPACE);
  const scroll={x:0,y:180},anchor={x:650,y:360};
  for(const [from,to] of [[.6,1],[1,.6]]) {
    const before=canvasOffset(content,viewport,from!,leading),after=canvasOffset(content,viewport,to!,leading);
    const next=anchoredScroll(content,viewport,from!,to!,scroll,anchor,leading);
    near((scroll.y+anchor.y-before.y)/from!,(next.y+anchor.y-after.y)/to!);
  }
});

test('trackpad pinch zooms at cursor and blocks page zoom; ordinary two-finger scroll remains native', () => {
  const target = new EventTarget(); let zoom = 1, pans = 0, point: Point | undefined;
  const release = bindMapGestures(target, { zoom: (factor, p) => { zoom *= factor; point = p; }, pan: () => pans++ });
  assert.equal(emit(target, 'wheel', { ctrlKey: false, deltaY: 30 }).defaultPrevented, false);
  assert.equal(pans, 1); assert.equal(zoom, 1);
  const pinch = emit(target, 'wheel', { ctrlKey: true, deltaY: -20, deltaMode: 0, clientX: 300, clientY: 250 });
  assert.equal(pinch.defaultPrevented, true); near(zoom, Math.exp(.2)); assert.deepEqual(point, { x: 300, y: 250 });
  emit(target, 'wheel', { ctrlKey: true, deltaY: 20, deltaMode: 0 }); near(zoom, 1);
  release(); emit(target, 'wheel', { ctrlKey: true, deltaY: -100 }); near(zoom, 1);
});

test('small pinch deltas accumulate smoothly instead of being rounded away', () => {
  const target = new EventTarget(); let zoom = 1;
  bindMapGestures(target, { zoom: factor => { zoom *= factor; }, pan: () => {} });
  for (let i = 0; i < 20; i++) emit(target, 'wheel', { ctrlKey: true, deltaY: -.1, deltaMode: 0 });
  near(zoom, Math.exp(.02));
});

test('WebKit gestures use incremental scale and do not apply duplicate wheel zoom', () => {
  const target = new EventTarget(); let zoom = 1;
  bindMapGestures(target, { zoom: factor => { zoom *= factor; }, pan: () => {} });
  emit(target, 'gesturestart', { scale: 1 });
  emit(target, 'gesturechange', { scale: 1.2 });
  emit(target, 'wheel', { ctrlKey: true, deltaY: -20 });
  emit(target, 'gesturechange', { scale: 1.5 }); near(zoom, 1.5);
  emit(target, 'gestureend');
  emit(target, 'wheel', { ctrlKey: true, deltaY: 10 }); near(zoom, 1.5 * Math.exp(-.1));
});
