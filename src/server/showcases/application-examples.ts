import { OrbitStore } from "../store.ts";
import { applicationRecords } from "./application-records.ts";

/** Install reviewed examples once. Viewing the guide never writes or dispatches them. */
export function seedApplicationExamples(store: OrbitStore) {
  const key = "showcase:application-examples:v1";
  if (store.metadata<boolean>(key)) return false;
  store.transaction(() => {
    // Never overwrite an unrelated record when importing into an existing workspace.
    const missing = new Set(applicationRecords.conversations.filter(c => !store.get("conversations", c.id)).map(c => c.id));
    for (const table of ["messages", "runs", "activities", "objects", "artifacts", "subagents", "subagentEvents", "memories"] as const) {
      for (const record of applicationRecords[table]) {
        if (missing.has(record.conversationId) && store.get(table, record.id))
          throw new Error(`应用示例记录冲突：${table}/${record.id}；未覆盖现有数据`);
      }
    }
    const existingSection = store.list("sections").find(s => s.name === "应用示例");
    if (!existingSection) store.put("sections", {
      id: "section-application-examples", name: "应用示例", pinned: false,
      order: Math.max(0, ...store.list("sections").map(s => s.order)) + 1,
    });
    for (const conversation of applicationRecords.conversations) {
      const existing = store.get("conversations", conversation.id);
      if (existing) {
        // Existing local examples retain all edits, messages and application state.
        if (["日常随问", "之前的对话"].includes(existing.project))
          store.put("conversations", { ...existing, project: "应用示例" });
        continue;
      }
      store.put("conversations", conversation);
      for (const table of ["messages", "runs", "activities", "objects", "artifacts", "subagents", "subagentEvents", "memories"] as const) {
        for (const record of applicationRecords[table]) {
          if (record.conversationId === conversation.id) {
            // The tuple's table/value correlation comes from the typed fixture.
            store.put(table, structuredClone(record));
          }
        }
      }
    }
    store.setMetadata(key, true);
  });
  return true;
}
