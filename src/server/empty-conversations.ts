import type { AppDefinition } from '../shared/plugin.ts';
import type { OrbitStore } from './store.ts';

/** Remove legacy placeholders only. An edited app, goal or inherited discussion is real work. */
export function removeEmptyPlaceholders(store: OrbitStore, apps: AppDefinition[]) {
  const removed: string[] = [];
  const seeds = apps.flatMap(app => app.seed());
  for (const c of store.list('conversations')) {
    if (!/^(新对话|新工作)$/.test(c.title.trim()) || c.parentId || c.inheritedContext || c.goal || c.summary || c.continuous || c.status !== 'idle') continue;
    if (store.list('conversations').some(child => child.parentId === c.id)) continue;
    if ((['messages', 'works', 'runs', 'activities', 'artifacts', 'triggers', 'subagents', 'memories'] as const).some(table => store.list(table).some(row => row.conversationId === c.id))) continue;
    const objects = store.list('objects').filter(o => o.conversationId === c.id);
    if (objects.some(o => o.version !== 1 || !seeds.some(s => s.appId === o.appId && s.type === o.type && JSON.stringify(s.data) === JSON.stringify(o.data)))) continue;
    store.deleteConversation(c.id); removed.push(c.id);
  }
  return removed;
}
