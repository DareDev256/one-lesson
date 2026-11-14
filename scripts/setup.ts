// One command from an empty cluster: collections with validation, every index the
// demo relies on (vector, TTL, lookups), saved resume tokens cleared, and a wait
// until the vector index is queryable.
import { client, getDb } from '../server/db';
import { AUTO_EMBED_MODEL, EMBED_DIMS, EMBED_MODE, EMBED_PROVIDER } from '../server/embed';

const db = await getDb();
const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));

const validators: Record<string, object> = {
  lessons: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['skillKey', 'version', 'title', 'steps', 'tags', 'teacherId', 'status', 'embedText', 'createdAt'],
      properties: {
        version: { bsonType: 'int', minimum: 1 },
        steps: { bsonType: 'array', minItems: 1 },
        tags: { bsonType: 'array', items: { bsonType: 'string' } },
        status: { enum: ['trial', 'proven', 'rolled_back', 'forgotten'] },
        embedText: { bsonType: 'string', minLength: 3 },
        embedding: { bsonType: 'array', minItems: EMBED_DIMS, maxItems: EMBED_DIMS },
      },
    },
  },
  homes: { $jsonSchema: { bsonType: 'object', required: ['name', 'hasKids', 'blockedTags', 'layout'] } },
  events: { $jsonSchema: { bsonType: 'object', required: ['type', 'at'] } },
};

for (const name of ['homes', 'teachers', 'lessons', 'runs', 'events', 'receipts']) {
  const validator = validators[name];
  if (!existing.has(name)) await db.createCollection(name, validator ? { validator } : {});
  else if (validator) await db.command({ collMod: name, validator });
}
console.log('collections ready');

const lessons = db.collection('lessons');
await lessons.createIndex({ skillKey: 1, version: 1 }, { unique: true });
await lessons.createIndex({ parentId: 1 });
await lessons.createIndex({ teacherId: 1 });
// Trial lessons retire themselves unless they prove themselves in real runs.
await lessons.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { status: 'trial' }, name: 'trial_ttl' });
const events = db.collection('events');
await events.createIndex({ lessonId: 1, type: 1 });
await events.createIndex({ homeId: 1, at: -1 });
await events.createIndex({ at: -1 });
await db.collection('runs').createIndex({ lessonId: 1 });
console.log('indexes ready');

await db.collection('homes').updateMany({}, { $set: { resumeToken: null } });
console.log('saved resume tokens cleared');

// atlas: Atlas Automated Embedding builds the vectors from embedText with Voyage; local: 384-dim vectors we compute.
const definition = EMBED_MODE === 'atlas'
  ? { fields: [
      { type: 'autoEmbed', modality: 'text', path: 'embedText', model: AUTO_EMBED_MODEL },
      { type: 'filter', path: 'status' },
      { type: 'filter', path: 'tags' },
    ] }
  : { fields: [
      { type: 'vector', path: 'embedding', numDimensions: EMBED_DIMS, similarity: 'cosine' },
      { type: 'filter', path: 'status' },
      { type: 'filter', path: 'tags' },
    ] };
const key = (f: any) => (f ? [f.type, f.path, f.model ?? f.numDimensions].join('|') : 'none');
const want = key(definition.fields[0]);
const current = await lessons.listSearchIndexes('lesson_vectors').toArray();
const have = key((current[0] as any)?.latestDefinition?.fields?.find((f: any) => f.type === 'vector' || f.type === 'autoEmbed'));
const same = current.length && have === want;
if (current.length && !same) {
  console.log('vector index definition changed: rebuilding');
  await lessons.dropSearchIndex('lesson_vectors');
  while ((await lessons.listSearchIndexes('lesson_vectors').toArray()).length) await new Promise((r) => setTimeout(r, 2000));
}
if (!same) {
  await lessons.createSearchIndex({ name: 'lesson_vectors', type: 'vectorSearch', definition } as any);
  console.log(`vector index requested (${EMBED_PROVIDER})`);
}
const t0 = Date.now();
for (;;) {
  const [ix] = (await lessons.listSearchIndexes('lesson_vectors').toArray()) as any[];
  if (ix?.queryable && ix?.status === 'READY') break;
  if (Date.now() - t0 > 300_000) throw new Error(`vector index not ready after 5 min (status ${ix?.status})`);
  process.stdout.write(`  waiting for vector index: ${ix?.status ?? 'missing'}\r`);
  await new Promise((r) => setTimeout(r, 3000));
}
console.log(`\nvector index READY in ${Math.round((Date.now() - t0) / 1000)} s`);
await client.close();
