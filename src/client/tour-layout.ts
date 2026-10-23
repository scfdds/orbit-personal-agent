export interface TourRect { x: number; y: number; width: number; height: number }
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(n, Math.max(min, max)));
/** Fit a coachmark next to its target; narrow screens reserve a separate bottom area. */
export function placeCoachmark(target: TourRect, viewport: { width: number; height: number }, size: { width: number; height: number }, prefer: "left" | "right") {
  const margin = 16, gap = 20;
  const width = Math.min(size.width, viewport.width - margin * 2);
  const height = Math.min(size.height, viewport.height - margin * 2);
  if (viewport.width < 760) return { x: margin, y: viewport.height - height - margin, width, side: "bottom" as const };
  const right = viewport.width - target.x - target.width >= width + gap + margin;
  const left = target.x >= width + gap + margin;
  const side = prefer === "right" && right ? "right" : left ? "left" : right ? "right" : "bottom";
  const x = side === "right" ? target.x + target.width + gap : side === "left" ? target.x - width - gap : viewport.width - width - margin * 2;
  const y = side === "bottom" ? viewport.height - height - margin * 2 : target.y + Math.min(56, target.height / 4);
  return { x: clamp(x, margin, viewport.width - width - margin), y: clamp(y, margin, viewport.height - height - margin), width, side };
}
