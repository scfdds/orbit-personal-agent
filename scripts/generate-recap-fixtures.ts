import { writeFileSync } from 'node:fs';
import { OrbitStore } from '../src/server/store.ts';
import { seedEverydayShowcase } from '../src/server/showcases/everyday.ts';
import { seedLearningShowcase } from '../src/server/showcases/learning.ts';
import { seedTurnSummaries } from '../src/server/showcases/seed-turn-summaries.ts';
import { seedRecaps } from '../src/server/showcases/seed-recaps.ts';
import { RecapService } from '../src/server/recap.ts';
import { TopicOverviewService } from '../src/server/topic-overview.ts';
import { safeErrorMessage } from '../src/server/model-config.ts';
const store = new OrbitStore(':memory:');
seedEverydayShowcase(store); seedLearningShowcase(store); seedTurnSummaries(store); seedRecaps(store);
const recap = new RecapService(store, () => {}), overview = new TopicOverviewService(store, () => {});
const ids = store.list('conversations').map(c => c.id);
const queue = [...ids];
await Promise.all(Array.from({length:3}, async () => {
  while (queue.length) {
    const id = queue.shift()!;
    try { const result = await recap.refresh(id); console.log(id, result?.nodes.length, 'points'); }
    catch (e) { console.error(id, safeErrorMessage(e)); }
  }
}));
for (const section of store.list('sections')) {
  try { await overview.refresh(section.id); } catch(e) { console.error(section.name, safeErrorMessage(e)); }
}
const recaps = Object.fromEntries(ids.flatMap(id => { const r = store.get('memories',id)?.recap; return r?[[id,r]]:[]; }));
const topics = Object.fromEntries(store.list('sections').flatMap(s => s.overview?[[s.name,s.overview]]:[]));
writeFileSync('src/server/showcases/recap-fixtures.ts', '// Generated from authored sample conversations with DeepSeek; source fingerprints guard reuse.\nimport type { ConversationRecap } from "../../shared/types.ts";\nexport const recapFixtures: Record<string, ConversationRecap> = '+JSON.stringify(recaps,null,2)+';\nexport const recapTopicFixtures = '+JSON.stringify(topics,null,2)+';\n');
console.log('Saved', Object.keys(recaps).length, 'conversation recaps');
await recap.close(); await overview.close(); store.close();
