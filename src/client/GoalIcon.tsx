import type { SVGProps } from "react";

/** An arrow landing in a target, drawn on the shared 24px icon grid. */
export function GoalIcon({ size = 24, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M20.5 11A9 9 0 1 1 13 3.5" />
    <path d="M16.5 12A5 5 0 1 1 12 7.5" />
    <path d="m12 12 7-7M12 8v4h4M19 2v3h3" />
  </svg>;
}
