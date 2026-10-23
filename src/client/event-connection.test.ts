import test from "node:test";
import assert from "node:assert/strict";
import { subscribeVisibleEvents } from "./event-connection.ts";

class Visibility extends EventTarget {
  hidden = true;
  show(visible: boolean) {
    this.hidden = !visible;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}
class Source {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((message: MessageEvent<string>) => void) | null = null;
  closed = false;
  close() { this.closed = true; }
}

test("background tabs release streams and switching back uses a fresh snapshot subscription", () => {
  const visibility = new Visibility();
  const lifecycle = new EventTarget();
  const sources: Source[] = [];
  const messages: string[] = [];
  let opens = 0;
  const dispose = subscribeVisibleEvents({
    onOpen: () => { opens++; },
    onError: () => {},
    onMessage: (event) => messages.push(event.data),
  }, { visibility, lifecycle, createSource: () => {
    const source = new Source();
    sources.push(source);
    return source as unknown as EventSource;
  } });
  assert.equal(sources.length, 0, "a background tab must not reserve a socket");
  visibility.show(true);
  sources[0].onopen!();
  visibility.show(true);
  assert.equal(sources.length, 1, "duplicate visibility events do not duplicate streams");
  visibility.show(false);
  assert(sources[0].closed);
  assert.equal(sources[0].onmessage, null, "queued callbacks from the closed stream are detached");
  visibility.show(true);
  assert.equal(sources.length, 2);
  sources[1].onopen!();
  sources[1].onmessage!(new MessageEvent("message", { data: "stream_sync" }));
  assert.equal(opens, 2);
  assert.deepEqual(messages, ["stream_sync"]);
  lifecycle.dispatchEvent(new Event("pagehide"));
  assert(sources[1].closed);
  lifecycle.dispatchEvent(new Event("pageshow"));
  assert.equal(sources.length, 3, "back-forward cache restores the stream");
  dispose();
  assert(sources[2].closed);
  visibility.show(true);
  lifecycle.dispatchEvent(new Event("pageshow"));
  assert.equal(sources.length, 3, "unmounted pages do not reconnect");
});
