// Compares lesson description styles under Atlas Automated Embedding (voyage-4).
import { client, getDb } from '../server/db';
const db = await getDb();
const c = db.collection('probe_texts');
await c.deleteMany({});
const docs = [
  { k: 'dishwasher', text: 'load the dishwasher. Moves dishes (plate, cup) into the dishwasher.' },
  { k: 'tidy', text: 'kitchen tidy. Moves sharp tools (knife, scissors) into the high cabinet.' },
  { k: 'tidyV2', text: 'kitchen tidy. Moves sharp tools (knife, scissors) into the low drawer.' },
  { k: 'evening', text: 'evening reset. Moves cookware (pan) into the sink. Moves sharp tools (knife) into the low drawer.' },
];
await c.insertMany(docs.map((d) => ({ ...d, status: 'trial' })));
const name = 'probe_texts_ae';
if (!(await c.listSearchIndexes(name).toArray()).length) {
  await c.createSearchIndex({ name, type: 'vectorSearch', definition: { fields: [
    { type: 'autoEmbed', modality: 'text', path: 'text', model: 'voyage-4' }, { type: 'filter', path: 'status' },
  ] } } as any);
}
for (;;) {
  const [ix] = (await c.listSearchIndexes(name).toArray()) as any[];
  if (ix?.queryable && ix.status === 'READY') break;
  await new Promise((r) => setTimeout(r, 2000));
}
await new Promise((r) => setTimeout(r, 4000));
for (const s of ['put the dishes away', 'tidy the kitchen', 'clean up the kitchen', 'do the evening reset', 'make me a sandwich']) {
  const r = await c.aggregate([
    { $vectorSearch: { index: name, path: 'text', query: s, limit: 4, numCandidates: 20, filter: { status: 'trial' } } },
    { $project: { _id: 0, k: 1, score: { $meta: 'vectorSearchScore' } } },
  ]).toArray();
  console.log(s.padEnd(24), r.map((x: any) => `${x.k}=${x.score.toFixed(3)}`).join('  '));
}
await client.close();
