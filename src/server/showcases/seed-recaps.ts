import { recapSource } from '../../shared/recap.ts';
import { OrbitStore } from '../store.ts';
import { TopicOverviewService } from '../topic-overview.ts';
import { recapFixtures, recapTopicFixtures } from './recap-fixtures.ts';

export function seedRecaps(store: OrbitStore) {
  const conversations = store.list('conversations'), messages = store.list('messages');
  let inserted = 0;
  for (const c of conversations) {
    const fixture = recapFixtures[c.id], memory = store.get('memories', c.id);
    if (!c.showcase || !fixture || !memory || fixture.sourceKey !== recapSource(c.id, messages, conversations).key) continue;
    if (memory.recap) {
      if (memory.recap.sourceKey !== fixture.sourceKey) continue;
      // Enrich unchanged authored recaps only; never replace user-edited content.
      let changed = false;
      const nodes = memory.recap.nodes.map(n => {
        const original = fixture.nodes.find(f => f.id === n.id && f.title === n.title && f.summary === n.summary && f.roundIds.join() === n.roundIds.join());
        if (n.takeaway || !original?.takeaway) return n;
        changed = true; return {...n,takeaway:original.takeaway};
      });
      if (changed) store.put('memories', {...memory,recap:{...memory.recap,nodes}});
      continue;
    }
    store.put('memories', { ...memory, recap: fixture }); inserted++;
  }
  const overview = new TopicOverviewService(store, () => {});
  for (const section of store.list('sections')) {
    const fixture = (recapTopicFixtures as Record<string, {text:string;sourceKey:string;updatedAt:string}>)[section.name];
    if (fixture && fixture.sourceKey === overview.source(section.id).sourceKey) store.put('sections', {...section, overview:fixture});
  }
  return inserted;
}
