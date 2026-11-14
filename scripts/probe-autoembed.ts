// Measures Atlas Automated Embedding (Voyage) on this cluster: does the index build,
// what do the scores look like, and how long from insert until a new doc is searchable.
import { client, getDb } from '../server/db';

const db = await getDb();
const c = db.collection('probe_autoembed');
await c.deleteMany({});
await c.insertMany([
  { text: 'load the dishwasher. pick the plate, place it in the dishwasher, pick the cup, place it in the dishwasher', status: 'trial' },
  { text: 'kitchen tidy. pick the knife, place it in the high cabinet, pick the scissors, place it in the high cabinet', status: 'proven' },
  { text: 'evening reset. pick the pan, place it in the sink, pick the knife, place it in the low drawer', status: 'trial' },
]);
const name = 'probe_ae';
if (!(await c.listSearchIndexes(name).toArray()).length) {
  await c.createSearchIndex({ name, type: 'vectorSearch', definition: { fields: [
    { type: 'autoEmbed', modality: 'text', path: 'text', model: process.env.AE_MODEL ?? 'voyage-4' },
    { type: 'filter', path: 'status' },
  ] } } as any);
}
const t0 = Date.now();
for (;;) {
  const [ix] = (await c.listSearchIndexes(name).toArray()) as any[];
  if (ix?.queryable && ix.status === 'READY') break;
  if (ix?.status === 'FAILED') { console.log('FAILED', JSON.stringify(ix)); process.exit(1); }
  if (Date.now() - t0 > 300_000) { console.log('timeout', ix?.status); process.exit(1); }
  await new Promise((r) => setTimeout(r, 3000));
}
console.log(`index READY after ${Math.round((Date.now() - t0) / 1000)} s`);
const q = async (query: string) => c.aggregate([
  { $vectorSearch: { index: name, path: 'text', query, limit: 3, numCandidates: 20, filter: { status: { $in: ['trial', 'proven'] } } } },
  { $project: { _id: 0, text: 1, score: { $meta: 'vectorSearchScore' } } },
]).toArray();
for (const s of ['put the dishes away', 'tidy the kitchen', 'make me a sandwich']) {
  const r0 = Date.now(); const r = await q(s);
  console.log(`"${s}" (${Date.now() - r0} ms):`, r.map((x: any) => `${x.text.split('.')[0]}=${x.score.toFixed(3)}`).join('  '));
}
const ins = Date.now();
await c.insertOne({ text: 'water the plants. pick the cup, place it in the sink', status: 'trial' });
for (;;) {
  const r = await q('water the plants');
  if (r[0]?.text?.startsWith('water')) { console.log(`new doc searchable after ${Date.now() - ins} ms`); break; }
  if (Date.now() - ins > 120_000) { console.log('new doc not searchable after 120 s'); break; }
  await new Promise((r) => setTimeout(r, 250));
}
await client.close();
