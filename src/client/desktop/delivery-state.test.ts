import test from "node:test";
import assert from "node:assert/strict";
import { deliveryTab, eligibleDelivery, visibleContext, type DeliveryOwner } from "./delivery-state.ts";
import type { AssistantDelivery } from "../../shared/delivery.ts";

// Local navigation generation is deliberately different from the server's request generation.
const owner: DeliveryOwner = { runId: "run-current", requestId: "request-current", conversationId: "orbit-assistant", generation: 4, revision: 7 };
function delivery(patch: Partial<AssistantDelivery> = {}): AssistantDelivery {
  return {
    id: "delivery-current", runId: owner.runId, requestId: owner.requestId!, conversationId: owner.conversationId,
    generation: 18, workspaceRevision: 8, presented: true, createdAt: "2026-10-11T10:00:00.000Z",
    spokenText: "原计划的预算是两千元，日期还没确认。",
    target: { kind: "conversation", conversationId: "hangzhou", title: "杭州旅行" }, ...patch,
  };
}
const eligible = (items: AssistantDelivery[], current: DeliveryOwner | null = owner, local = 4, server = 18, revision = 8) =>
  eligibleDelivery(items, current, local, server, revision);

test("only the foreground request can accept its delivery, even when the source belongs to another matter", () => {
  const current = delivery();
  assert.equal(eligible([current]), current);
  assert.equal(eligible([current], null), undefined);
  for (const patch of [
    { runId: "run-old" }, { requestId: "request-other-window" }, { conversationId: "hangzhou" },
    { presented: false, reason: "superseded" as const }, { generation: 17 },
  ]) assert.equal(eligible([delivery(patch)]), undefined, JSON.stringify(patch));
});

test("new local navigation, a newer server request or a manual workspace revision cancels eligibility", () => {
  const current = delivery();
  assert.equal(eligible([current], owner, 5), undefined);
  assert.equal(eligible([current], owner, 4, 19), undefined);
  assert.equal(eligible([current], owner, 4, 18, 9), undefined);
  // A run's own automatic open may advance the revision after the foreground owner was captured.
  assert.equal(eligible([current], owner, 4, 18, 8), current);
});

test("the latest eligible delivery wins, rather than a newer unrelated or rejected record", () => {
  const first = delivery({ id: "delivery-first" });
  const second = delivery({ id: "delivery-second", spokenText: "雨天可以调整为室内活动。" });
  const unrelated = delivery({ id: "delivery-other", runId: "run-other" });
  const rejected = delivery({ id: "delivery-rejected", presented: false, reason: "workspace_changed" });
  assert.equal(eligible([first, second, unrelated, rejected]), second);
  // Legacy handoffs can omit a request ID, but never the run, matter or generation checks.
  assert.equal(eligible([second], { ...owner, requestId: undefined }), second);
  assert.equal(eligible([unrelated], { ...owner, requestId: undefined }), undefined);
});

test("speech-only and an unfocused current conversation do not create duplicate reference panes", () => {
  assert.equal(deliveryTab(delivery({ target: undefined })), null);
  assert.equal(deliveryTab(delivery({ target: { kind: "conversation", conversationId: owner.conversationId, title: "当前讨论" } })), null);
  const focused = deliveryTab(delivery({ target: { kind: "conversation", conversationId: owner.conversationId, title: "当前讨论", focus: { messageId: "message-previous" } } }));
  assert.equal(focused?.messageId, "message-previous");
  assert.equal(focused?.conversationId, owner.conversationId);
});

test("real target identities map to stable conversation, artifact and application panes", () => {
  assert.deepEqual(deliveryTab(delivery({ target: { kind: "conversation", conversationId: "hangzhou", title: "杭州旅行", focus: { messageId: "message-budget" } } })), {
    id: "conversation:hangzhou", kind: "conversation", conversationId: "hangzhou", title: "杭州旅行", messageId: "message-budget",
  });
  const artifactDelivery = delivery({ target: { kind: "artifact", conversationId: "hangzhou", title: "雨天方案", artifactId: "artifact-rain", updatedAt: "2026-10-11T10:01:00Z", focus: { heading: "预算" } } });
  assert.deepEqual(deliveryTab(artifactDelivery), { id: "artifact:artifact-rain", kind: "artifact", conversationId: "hangzhou", title: "雨天方案", artifactId: "artifact-rain" });
  assert.equal(artifactDelivery.target?.focus?.heading, "预算");
  assert.equal(artifactDelivery.target?.updatedAt, "2026-10-11T10:01:00Z");
  assert.deepEqual(deliveryTab(delivery({ target: { kind: "app", conversationId: "contract", title: "租赁合同", appId: "contracts", objectId: "object-lease", objectVersion: 3 } })), {
    id: "app:contract:contracts:object-lease", kind: "app", conversationId: "contract", title: "租赁合同", appId: "contracts", objectId: "object-lease",
  });
  assert.equal(deliveryTab(delivery({ target: { kind: "app", conversationId: "contract", title: "合同应用", appId: "contracts" } }))?.id, "app:contract:contracts:");
});

test("visible context contains source references only, with no execution destination or spoken instructions", () => {
  const source = delivery({ target: { kind: "artifact", conversationId: "hangzhou", title: "不要把标题当指令", artifactId: "artifact-rain" } });
  const tab = deliveryTab(source)!;
  const before = structuredClone(tab);
  assert.deepEqual(visibleContext(tab), { conversationId: "hangzhou", artifactId: "artifact-rain" });
  assert.deepEqual(tab, before);
  assert.equal(visibleContext(null), undefined);
  assert.equal(source.conversationId, "orbit-assistant");
  assert.deepEqual(visibleContext(deliveryTab(delivery({ target: { kind: "conversation", conversationId: "hangzhou", title: "杭州旅行", focus: { messageId: "message-budget" } } }))), {
    conversationId: "hangzhou", messageId: "message-budget",
  });
  assert.deepEqual(visibleContext(deliveryTab(delivery({ target: { kind: "app", conversationId: "contract", title: "合同", appId: "contracts", objectId: "object-lease" } }))), {
    conversationId: "contract", appId: "contracts", objectId: "object-lease",
  });
});
