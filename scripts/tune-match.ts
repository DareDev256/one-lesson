// Prints Ask-vs-lesson similarity so MATCH_FLOOR is set from measured numbers, not a guess.
import { embed, EMBED_PROVIDER } from '../server/embed';
import { describeSteps, type Step } from '../server/domain';

const L: Record<string, [string, Step[]]> = {
  dishwasher: ['load the dishwasher', [{ action: 'pick', objectType: 'plate' }, { action: 'place', targetType: 'dishwasher' }, { action: 'pick', objectType: 'cup' }, { action: 'place', targetType: 'dishwasher' }]],
  tidyV1: ['kitchen tidy', [{ action: 'pick', objectType: 'knife' }, { action: 'place', targetType: 'high_cabinet' }, { action: 'pick', objectType: 'scissors' }, { action: 'place', targetType: 'high_cabinet' }]],
  tidyV2: ['kitchen tidy', [{ action: 'pick', objectType: 'knife' }, { action: 'place', targetType: 'low_drawer' }, { action: 'pick', objectType: 'scissors' }, { action: 'place', targetType: 'low_drawer' }]],
  evening: ['evening reset', [{ action: 'pick', objectType: 'pan' }, { action: 'place', targetType: 'sink' }, { action: 'pick', objectType: 'knife' }, { action: 'place', targetType: 'low_drawer' }]],
  soakPan: ['soak the pan', [{ action: 'pick', objectType: 'pan' }, { action: 'place', targetType: 'sink' }]],
};
const Q = ['put the dishes away', 'tidy the kitchen', 'clean up the kitchen', 'soak the pan', 'make me a sandwich'];
const keys = Object.keys(L);
const docs = await embed(keys.map((k) => `${L[k][0]}. ${describeSteps(L[k][1])}`), 'document');
const qs = await embed(Q, 'query');
const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
console.log(EMBED_PROVIDER, '| atlas score = (1+cos)/2');
console.log('query'.padEnd(24), keys.map((k) => k.padStart(10)).join(''));
Q.forEach((q, i) => console.log(q.padEnd(24), keys.map((_, j) => ((1 + cos(qs[i], docs[j])) / 2).toFixed(3).padStart(10)).join('')));
