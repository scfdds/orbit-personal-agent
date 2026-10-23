import { useCallback, useEffect, useRef, useState } from "react";
import type { ServerEvent, Snapshot } from "../shared/types.ts";
import { subscribeVisibleEvents } from "./event-connection.ts";
import { announceWorkspaceMode, currentWorkspaceMode, workspaceRequestHeaders } from "./workspace-mode.ts";

export async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const modeRequest = path === "/workspace-mode";
  const revision = modeRequest ? undefined : currentWorkspaceMode()?.revision;
  const response = await fetch(`/api${path}`, {
    method,
    headers: { ...(modeRequest ? {} : workspaceRequestHeaders()), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!modeRequest && revision && currentWorkspaceMode()?.revision !== revision) throw new Error("工作空间已切换，请重试。");
  if (!modeRequest && revision && response.headers.get("x-orbit-workspace") && response.headers.get("x-orbit-workspace") !== revision) {
    announceWorkspaceMode();
    throw new Error("工作空间已切换，请重试。");
  }
  if (!modeRequest && response.status === 409 && data.code === "WORKSPACE_CHANGED") announceWorkspaceMode();
  if (!response.ok) throw new Error(data.error || "操作未完成，请重试");
  return data as T;
}

/** Bind delayed UI callbacks to the workspace that created them. */
export function useWorkspaceRequest() {
  const revision = useRef(currentWorkspaceMode()?.revision).current;
  return useCallback(<T,>(path: string, method = "GET", body?: unknown): Promise<T> => {
    if (revision !== currentWorkspaceMode()?.revision) return Promise.reject(new Error("工作空间已切换，请重试。"));
    return request<T>(path, method, body);
  }, [revision]);
}

export function useOrbit() {
  const [state, setState] = useState<Snapshot | null>(null);
  const [online, setOnline] = useState(false);
  const [error, setError] = useState("");
  const [streams, setStreams] = useState<
    Record<string, { runId: string; text: string }>
  >({});
  const mounted = useRef(true);
  const refreshing = useRef<Promise<void> | null>(null);
  const refreshAgain = useRef(false);
  const refresh = useCallback((): Promise<void> => {
    if (refreshing.current) {
      refreshAgain.current = true;
      return refreshing.current;
    }
    refreshing.current = (async () => {
      try {
        do {
          refreshAgain.current = false;
          try {
            const snapshot = await request<Snapshot>("/state");
            if (mounted.current) {
              setState(snapshot);
              setError("");
              const active = new Set(
                snapshot.runs
                  .filter(
                    (run) =>
                      run.status === "running" || run.status === "queued",
                  )
                  .map((run) => run.id),
              );
              setStreams((prev) =>
                Object.fromEntries(
                  Object.entries(prev).filter(([, stream]) =>
                    active.has(stream.runId),
                  ),
                ),
              );
            }
          } catch (e) {
            if (mounted.current) setError((e as Error).message);
          }
        } while (refreshAgain.current && mounted.current);
      } finally {
        refreshing.current = null;
      }
    })();
    return refreshing.current;
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let disconnectTimer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeVisibleEvents({
      onOpen: () => {
        clearTimeout(disconnectTimer);
        disconnectTimer = undefined;
        setOnline(true);
        void refresh();
      },
      onError: () => {
        // Allow the server's brief, planned stream rotation without status flicker.
        if (!disconnectTimer) disconnectTimer = setTimeout(() => {
          disconnectTimer = undefined;
          setOnline(false);
        }, 2500);
      },
      onMessage: (message) => {
        const parsed = JSON.parse(message.data);
        if (parsed.type === "workspace_mode") { announceWorkspaceMode(); return; }
        const event: ServerEvent = parsed;
        if (event.type === "state") {
          if (!debounce)
            debounce = setTimeout(() => {
              debounce = undefined;
              void refresh();
            }, 100);
        } else if (event.type === "stream_sync") {
          setStreams((prev) => ({
            ...prev,
            [event.conversationId]: { runId: event.runId, text: event.text },
          }));
        } else if (event.type === "delta") {
          setStreams((prev) => ({
            ...prev,
            [event.conversationId]: {
              runId: event.runId,
              text:
                (prev[event.conversationId]?.runId === event.runId
                  ? prev[event.conversationId].text
                  : "") + event.text,
            },
          }));
        } else if (event.type === "run_end") {
          void refresh().then(() =>
            setStreams((prev) => {
              const next = { ...prev };
              if (next[event.conversationId]?.runId === event.runId)
                delete next[event.conversationId];
              return next;
            }),
          );
        }
      },
    });
    return () => {
      mounted.current = false;
      unsubscribe();
      clearTimeout(debounce);
      clearTimeout(disconnectTimer);
    };
  }, [refresh]);
  return { state, online, error, streams, refresh };
}
