export interface LatencyDetail { requestId?: string; runId?: string; utteranceId?: string }
export interface LatencyMark extends LatencyDetail { phase: string; at: number }
const recent: LatencyMark[] = [];

/** Local, bounded diagnostics. No message text, audio, credentials or network telemetry. */
export function markLatency(phase: string, detail: LatencyDetail = {}) {
  const mark = { phase, at: performance.now(), ...detail };
  recent.push(mark); if (recent.length > 100) recent.shift();
  window.dispatchEvent(new CustomEvent("orbit-latency", { detail: mark }));
}
export function latencySnapshot(): LatencyMark[] { return recent.map(mark => ({ ...mark })); }
