// "Another server teaches while ours is down": writes a lesson straight to Atlas, bypassing this
// server. When the fleet restarts, each home's change stream resumes from its saved token and
// catches up on it. Usage: npm run publish:direct
import { client, collections } from '../server/db';
import { computeTags, lessonText, type Step } from '../server/domain';

const steps: Step[] = [{ action: 'pick', objectType: 'pan' }, { action: 'place', targetType: 'sink' }];
const title = process.argv[2] ?? 'soak the pan';
const { lessons, events } = await collections();
const skillKey = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const last = await lessons.findOne({ skillKey }, { sort: { version: -1 } });
const version = (last?.version ?? 0) + 1;
await lessons.insertOne({
  _id: `${skillKey}@v${version}`, skillKey, version, title, steps, tags: computeTags(steps),
  teacherId: 'unverified:alex', teacherName: 'Alex', teacherVerified: false, parentId: last?._id ?? null,
  status: 'trial', embedText: lessonText(title, steps), createdAt: new Date(),
  expiresAt: new Date(Date.now() + 24 * 3600 * 1000), provenRuns: 0,
});
// The other server logs its own publish, so the board can time the catch-up from it.
await events.insertOne({ type: 'published', lessonId: `${skillKey}@v${version}`, teacherId: 'unverified:alex', at: new Date(),
  detail: { title, version, tags: computeTags(steps), teacherName: 'Alex', verified: false, parentId: last?._id ?? null, originHomeId: 'home-3', via: 'direct' } });
console.log(`wrote ${skillKey}@v${version} straight to Atlas while the fleet server is down`);
await client.close();
