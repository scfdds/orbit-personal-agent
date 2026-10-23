export const MIN_ZOOM = .12;
export const MAX_ZOOM = 2;
export const MAP_BOTTOM_SPACE = 76;
export type Size = { width: number; height: number };
export type Point = { x: number; y: number };
export const clampZoom = (zoom: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));

export function fitZoom(content: Size, viewport: Size, leadingSpace = 0) {
  return clampZoom(Math.min(1, Math.max(1, viewport.width - 48) / content.width, Math.max(1, viewport.height - leadingSpace - MAP_BOTTOM_SPACE - 20) / content.height));
}
export function canvasOffset(content: Size, viewport: Size, zoom: number, leadingSpace = 0): Point {
  return { x: Math.max(0, (viewport.width - content.width * zoom) / 2), y: leadingSpace + Math.max(0, (viewport.height - leadingSpace - MAP_BOTTOM_SPACE - content.height * zoom) / 2) };
}
/** Preserve the point under the cursor when the canvas size or centered offset changes. */
export function anchoredScroll(content: Size, viewport: Size, from: number, to: number, scroll: Point, anchor: Point, leadingSpace = 0): Point {
  const before = canvasOffset(content, viewport, from, leadingSpace), after = canvasOffset(content, viewport, to, leadingSpace);
  return { x: (scroll.x + anchor.x - before.x) * to / from + after.x - anchor.x, y: (scroll.y + anchor.y - before.y) * to / from + after.y - anchor.y };
}

type Gesture = Event & { scale: number; clientX?: number; clientY?: number };
/** Chromium trackpads emit ctrl+wheel; WebKit exposes gesture events instead. */
export function bindMapGestures(target: EventTarget, handlers: {
  zoom: (factor: number, point?: Point) => void;
  pan: () => void;
}) {
  let gestureScale = 1, gesturing = false;
  const wheel = (event: Event) => {
    const e = event as WheelEvent;
    if (!e.ctrlKey) { handlers.pan(); return; }
    e.preventDefault();
    if (gesturing) return;
    const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 800 : 1);
    handlers.zoom(Math.exp(-Math.max(-100, Math.min(100, delta)) * .01), { x: e.clientX, y: e.clientY });
  };
  const start = (event: Event) => { event.preventDefault(); gesturing = true; gestureScale = (event as Gesture).scale || 1; };
  const change = (event: Event) => {
    event.preventDefault();
    const e = event as Gesture;
    if (!gesturing || !Number.isFinite(e.scale) || e.scale <= 0) return;
    const point = e.clientX !== undefined && e.clientY !== undefined ? { x: e.clientX, y: e.clientY } : undefined;
    handlers.zoom(e.scale / gestureScale, point); gestureScale = e.scale;
  };
  const end = (event: Event) => { event.preventDefault(); gesturing = false; gestureScale = 1; };
  target.addEventListener('wheel', wheel, { passive: false });
  target.addEventListener('gesturestart', start, { passive: false });
  target.addEventListener('gesturechange', change, { passive: false });
  target.addEventListener('gestureend', end);
  return () => {
    target.removeEventListener('wheel', wheel);
    target.removeEventListener('gesturestart', start);
    target.removeEventListener('gesturechange', change);
    target.removeEventListener('gestureend', end);
  };
}
