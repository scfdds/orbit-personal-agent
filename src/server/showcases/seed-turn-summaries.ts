import { conversationRounds } from '../../shared/discussion.ts';
import { OrbitStore } from '../store.ts';
import { showcaseTurnSummaries } from './turn-summaries.ts';

/** Only authored fixtures without a prior round memory receive cached LLM output. */
export function seedTurnSummaries(store:OrbitStore){
  let inserted=0;
  for(const c of store.list('conversations')){
    if(!c.showcase)continue;
    const memory=store.get('memories',c.id);if(!memory||memory.discussion)continue;
    const rounds=conversationRounds(c.id,store.list('messages'));
    const turns=rounds.flatMap(r=>{const found=showcaseTurnSummaries.find(t=>t.id===r.id&&t.sourceKey===r.sourceKey);return found?[found]:[];});
    if(!turns.length)continue;
    store.put('memories',{...memory,discussion:{version:1,status:turns.length===rounds.filter(r=>r.answers.length).length?'ready':'empty',turns}});inserted+=turns.length;
  }
  return inserted;
}
