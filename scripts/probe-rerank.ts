// Auto-embed recall, then $rerank precision: does the reranker separate "put the dishes away"?
import { client, getDb } from '../server/db';
const db = await getDb();
const c = db.collection('probe_texts');
for (const model of ['rerank-3', 'rerank-2.5']) {
  console.log('model', model);
  for (const s of ['put the dishes away', 'tidy the kitchen', 'clean up the kitchen', 'make me a sandwich']) {
    const t0 = Date.now();
    try {
      const r = await c.aggregate([
        { $vectorSearch: { index: 'probe_texts_ae', path: 'text', query: s, limit: 4, numCandidates: 20, filter: { status: 'trial' } } },
        { $addFields: { vs: { $meta: 'vectorSearchScore' } } },
        { $rerank: { query: { text: s }, path: 'text', numDocsToRerank: 4, model } },
        { $project: { _id: 0, k: 1, vs: 1, rr: { $meta: 'score' } } },
      ]).toArray();
      console.log('  ' + s.padEnd(24), `${Date.now() - t0}ms`, r.map((x: any) => `${x.k}=${x.rr.toFixed(3)}`).join('  '));
    } catch (e: any) { console.log('  ERR', e.message.slice(0, 200)); break; }
  }
}
await client.close();
