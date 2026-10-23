import type { Message, Run, Snapshot } from "../../shared/types.ts";

/** A view reference only. The answer remains owned by its canonical conversation. */
export interface HomeAssignment {
  conversationId: string;
  title: string;
  project: string;
  runId: string;
  action?: "new" | "resume";
}

export interface HomeTimelineGroup {
  /** The original main question is the stable position of this exchange. */
  id: string;
  sourceMessageId?: string;
  messages: Message[];
  runIds: string[];
}

export interface HomeTimeline {
  groups: HomeTimelineGroup[];
  messages: Message[];
  assignments: Record<string, HomeAssignment>;
  run?: Run;
  runGroupId?: string;
  stream?: string;
  streamGroupId?: string;
  streamAssignment?: HomeAssignment;
}

type TimelineSnapshot = Pick<Snapshot, "messages" | "conversations" | "runs">;
type Streams = Record<string, { runId: string; text: string }>;
const running = (run: Run) => run.status === "running" || run.status === "queued";

/**
 * Main is a timeline, not another copy of matter history. Only a main-origin run
 * can project its answers here; later direct replies in that matter stay local.
 * No content heuristics, summary synthesis, or mutations of stored messages.
 */
export function buildHomeTimeline({ snapshot, mainId, streams = {}, preferredRunId }: {
  snapshot: TimelineSnapshot;
  mainId: string;
  streams?: Streams;
  preferredRunId?: string;
}): HomeTimeline {
  const runs = new Map(snapshot.runs.map(run => [run.id, run]));
  const mainMessages = snapshot.messages.filter(message => message.conversationId === mainId);
  const groups: HomeTimelineGroup[] = [];
  const sourceGroups = new Map<string, HomeTimelineGroup>();
  const messageGroups = new Map<string, HomeTimelineGroup>();
  let current: HomeTimelineGroup | undefined;
  for (const message of mainMessages) {
    if (!current || message.role === "user") {
      current = { id: message.role === "user" ? message.id : `prefix:${mainId}`, messages: [], runIds: [],
        ...(message.role === "user" ? { sourceMessageId: message.id } : {}) };
      groups.push(current);
      if (message.role === "user") sourceGroups.set(message.id, current);
    }
    current.messages.push(message);
    messageGroups.set(message.id, current);
    if (message.runId && runs.get(message.runId)?.conversationId === mainId && !runs.get(message.runId)?.parentId)
      if (!current.runIds.includes(message.runId)) current.runIds.push(message.runId);
  }

  const origins = new Map<string, { group: HomeTimelineGroup; conversationId: string; action?: "new" | "resume" }>();
  for (const message of snapshot.messages) {
    if (message.role !== "user" || !message.runId || message.conversationId === mainId || message.handoff?.sourceConversationId !== mainId) continue;
    const group = sourceGroups.get(message.handoff.sourceMessageId);
    const run = runs.get(message.runId);
    if (group && (!run || run.conversationId === message.conversationId && !run.parentId))
      origins.set(message.runId, { group, conversationId: message.conversationId, action: message.handoff.action });
  }

  // Old installations have a durable main link but no explicit source message.
  // A read/open link instead belongs to a main run, so it is left as a reference.
  for (const link of mainMessages) {
    if (link.kind !== "conversation_link" || !link.runId || !link.linkedConversationId || link.linkedConversationId === mainId) continue;
    const run = runs.get(link.runId);
    const origin = origins.get(link.runId);
    if (origin && origin.conversationId !== link.linkedConversationId) continue;
    const targetRequest = snapshot.messages.find(message => message.conversationId === link.linkedConversationId && message.runId === link.runId && message.role === "user" && message.route?.requestId.startsWith("home-"));
    const isMatterRun = run ? run.conversationId === link.linkedConversationId && !run.parentId : Boolean(targetRequest);
    if (!origin && !isMatterRun) continue;
    const group = origin?.group || messageGroups.get(link.id)!;
    if (!origins.has(link.runId)) origins.set(link.runId, { group, conversationId: link.linkedConversationId,
      ...(targetRequest?.route?.action === "new" || targetRequest?.route?.action === "resume" ? { action: targetRequest.route.action } : {}) });
    // It is the answer's attribution, not an additional assistant announcement.
    const linkGroup = messageGroups.get(link.id)!;
    linkGroup.messages = linkGroup.messages.filter(message => message.id !== link.id);
  }

  const assignments: Record<string, HomeAssignment> = {};
  const runAssignments = new Map<string, HomeAssignment>();
  for (const [runId, origin] of origins) {
    const conversation = snapshot.conversations.find(item => item.id === origin.conversationId);
    const assignment: HomeAssignment = { conversationId: origin.conversationId,
      title: conversation?.title || "相关事项", project: conversation?.matterTitle || conversation?.project || "", runId,
      ...(origin.action ? { action: origin.action } : {}) };
    runAssignments.set(runId, assignment);
    if (!origin.group.runIds.includes(runId)) origin.group.runIds.push(runId);
    const answers = snapshot.messages.filter(message => message.conversationId === origin.conversationId && message.runId === runId && message.role === "assistant");
    for (const answer of answers) {
      if (!origin.group.messages.some(message => message.id === answer.id)) origin.group.messages.push(answer);
      assignments[answer.id] = assignment;
    }
  }

  const orderedRuns = groups.flatMap(group => group.runIds.map(id => ({ run: runs.get(id), group })))
    .filter((entry): entry is { run: Run; group: HomeTimelineGroup } => Boolean(entry.run));
  const preferred = orderedRuns.find(entry => entry.run.id === preferredRunId);
  const active = orderedRuns.filter(entry => running(entry.run));
  const selected = preferred && running(preferred.run) ? preferred : active.at(-1) || preferred || orderedRuns.at(-1);
  const messages = groups.flatMap(group => group.messages);
  const stream = selected && running(selected.run) && streams[selected.run.conversationId]?.runId === selected.run.id
    && !messages.some(message => message.role === "assistant" && message.runId === selected.run.id)
    ? streams[selected.run.conversationId]?.text : undefined;
  return { groups, messages, assignments,
    ...(selected ? { run: selected.run, runGroupId: selected.group.id } : {}),
    ...(stream ? { stream, streamGroupId: selected!.group.id, streamAssignment: runAssignments.get(selected!.run.id) } : {}) };
}

/** Crop whole exchanges, retaining the pending exchange even after later input. */
export function selectHomeTimeline(timeline: HomeTimeline, { maxGroups }: { maxGroups?: number } = {}): HomeTimeline {
  if (maxGroups === undefined || !Number.isFinite(maxGroups) || maxGroups >= timeline.groups.length) return timeline;
  const start = Math.max(0, timeline.groups.length - Math.max(1, Math.floor(maxGroups)));
  const activeGroupId = timeline.run && running(timeline.run) ? timeline.runGroupId : undefined;
  const groups = timeline.groups.filter((group, index) => index >= start || group.id === activeGroupId);
  const messages = groups.flatMap(group => group.messages);
  const ids = new Set(messages.map(message => message.id));
  const runVisible = groups.some(group => group.id === timeline.runGroupId);
  return { groups, messages, assignments: Object.fromEntries(Object.entries(timeline.assignments).filter(([id]) => ids.has(id))),
    ...(runVisible ? { run: timeline.run, runGroupId: timeline.runGroupId,
      stream: timeline.stream, streamGroupId: timeline.streamGroupId, streamAssignment: timeline.streamAssignment } : {}) };
}
