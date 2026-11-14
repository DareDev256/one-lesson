// The state every rehearsal starts from. Run it with the server stopped.
// Six homes with generated kitchens, the two teachers, and "kitchen tidy" v1 already
// in place so a v2 can be built on it. Everything here is created at the event.
import { client, collections } from '../server/db';
import { computeTags, generateLayout, HOMES, lessonText, type Step } from '../server/domain';
import { embed, EMBED_MODE } from '../server/embed';

const { homes, teachers, lessons, runs, events, receipts } = await collections();
await Promise.all([lessons.deleteMany({}), runs.deleteMany({}), events.deleteMany({}), receipts.deleteMany({}), teachers.deleteMany({})]);

const JAMES = { id: process.env.JAMES_SUB || 'unverified:james', name: 'James', verified: !!process.env.JAMES_SUB };
const ALEX = { id: process.env.ALEX_SUB || 'unverified:alex', name: 'Alex', verified: !!process.env.ALEX_SUB };
await teachers.insertMany([
  { _id: JAMES.id as any, name: JAMES.name, verified: JAMES.verified, forgottenAt: null },
  { _id: ALEX.id as any, name: ALEX.name, verified: ALEX.verified, forgottenAt: null },
]);

const tidySteps: Step[] = [
  { action: 'pick', objectType: 'knife' }, { action: 'place', targetType: 'high_cabinet' },
  { action: 'pick', objectType: 'scissors' }, { action: 'place', targetType: 'high_cabinet' },
];
const embedText = lessonText('kitchen tidy', tidySteps);
const embedding = EMBED_MODE === 'local' ? (await embed([embedText], 'document'))[0] : undefined;
const v1 = {
  _id: 'kitchen-tidy@v1', skillKey: 'kitchen-tidy', version: 1, title: 'kitchen tidy', steps: tidySteps,
  tags: computeTags(tidySteps), teacherId: JAMES.id, teacherName: JAMES.name, teacherVerified: JAMES.verified,
  parentId: null, status: 'proven' as const, embedText, ...(embedding ? { embedding } : {}), createdAt: new Date(), expiresAt: null, provenRuns: 3,
};
await lessons.insertOne(v1);

await homes.deleteMany({});
await homes.insertMany(HOMES.map((h, i) => ({
  ...h, layout: generateLayout(i), online: false, resumeToken: null, activeLessons: { 'kitchen-tidy': v1._id },
})));

console.log(`reset: ${HOMES.length} homes, 2 teachers, "${v1.title}" v1 active everywhere (James ${JAMES.verified ? 'verified' : 'unverified'})`);
await client.close();
