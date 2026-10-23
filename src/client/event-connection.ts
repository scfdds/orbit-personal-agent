import { currentWorkspaceMode } from "./workspace-mode.ts";

interface Handlers {
  onOpen: () => void;
  onError: () => void;
  onMessage: (message: MessageEvent<string>) => void;
}

// An HTTP/1.1 EventSource occupies one of the browser's per-origin connections.
// Hidden tabs do not need a stream: reconnecting sends the server's current
// state and in-flight text snapshot, while agent execution remains on the server.
export function subscribeVisibleEvents(
  handlers: Handlers,
  environment = {
    visibility: document as Pick<Document, "hidden" | "addEventListener" | "removeEventListener">,
    lifecycle: window as Pick<Window, "addEventListener" | "removeEventListener">,
    createSource: () => {
      const revision = currentWorkspaceMode()?.revision;
      return new EventSource(`/api/events${revision ? `?workspace=${encodeURIComponent(revision)}` : ""}`);
    },
  },
) {
  let source: EventSource | null = null;
  let disposed = false;
  const disconnect = () => {
    if (!source) return;
    source.onopen = source.onerror = source.onmessage = null;
    source.close();
    source = null;
  };
  const sync = () => {
    if (disposed) return;
    if (environment.visibility.hidden) return disconnect();
    if (source) return;
    source = environment.createSource();
    source.onopen = handlers.onOpen;
    source.onerror = handlers.onError;
    source.onmessage = handlers.onMessage;
  };
  environment.visibility.addEventListener("visibilitychange", sync);
  environment.lifecycle.addEventListener("pagehide", disconnect);
  environment.lifecycle.addEventListener("pageshow", sync);
  sync();
  return () => {
    disposed = true;
    environment.visibility.removeEventListener("visibilitychange", sync);
    environment.lifecycle.removeEventListener("pagehide", disconnect);
    environment.lifecycle.removeEventListener("pageshow", sync);
    disconnect();
  };
}
