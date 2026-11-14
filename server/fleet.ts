// The fleet: publish, six home workers on change streams, Ask with Vector Search,
// lineage with $graphLookup, rollback and forget in transactions, and the scoreboard.
import type { ChangeStream, ChangeStreamDocument } from 'mongodb';
import { client, collections, GOOD_STATUSES, type FleetEvent, type Home, type Lesson } from './db';
import { adaptToLayout, blockingRule, computeTags, describeSteps, lessonText, pathLength, PROVENANCE_ASK, validateSteps, type Lang } from './domain';
import { embed, EMBED_MODE, RERANK_MODEL } from './embed';

export interface Teacher { id: string; name: string; verified: boolean }

type Listener = (msg: unknown) => void;
const listeners = new Set<Listener>();
export function onBroadcast(fn: Listener) { listeners.add(fn); return () => listeners.delete(fn); }
function broadcast(msg: unknown) { for (const fn of listeners) fn(msg); }

let sbTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleScoreboard() {
  if (sbTimer) return;
  sbTimer = setTimeout(async () => {
    sbTimer = null;
    try { broadcast({ kind: 'scoreboard', scoreboard: await scoreboard() }); } catch (err) { console.error('scoreboard', err); }
  }, 150);
}

export async function emit(e: Omit<FleetEvent, 'at'> & { at?: Date }) {
  const { events } = await collections();
  const doc = { ...e, at: e.at ?? new Date() } as FleetEvent;
  await events.insertOne(doc);
  broadcast({ kind: 'event', event: doc });
  if (doc.type !== 'asked') scheduleScoreboard();
  return doc;
}

async function pushHome(homeId: string) {
  const { homes } = await collections();
  const h = await homes.findOne({ _id: homeId }, { projection: { resumeToken: 0 } });
  if (h) broadcast({ kind: 'home', home: h });
}

const TRIAL_MS = 24 * 60 * 60 * 1000;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

// ---------------------------------------------------------------- publish

export async function publish(input: {
  steps: unknown; title?: string; skillKey?: string; parentId?: string | null; teacher: Teacher; trialSeconds?: number; originHomeId?: string;
}) {
  const { lessons, teachers } = await collections();
  const steps = validateSteps(input.steps);
  const t = await teachers.findOne({ _id: input.teacher.id as any });
  if (t?.forgottenAt) throw new Error('this teacher has been forgotten');
  await teachers.updateOne(
    { _id: input.teacher.id as any },
    { $set: { name: input.teacher.name, verified: input.teacher.verified }, $setOnInsert: { forgottenAt: null } },
    { upsert: true },
  );

  let parent: Lesson | null = null;
  if (input.parentId) parent = await lessons.findOne({ _id: input.parentId });
  const title = (input.title?.trim() || parent?.title || describeSteps(steps)).slice(0, 80);
  // A lesson built on a parent with a new name is a new skill in the same family tree (e.g. "evening reset" on kitchen tidy v2).
  const sameSkill = parent && (!input.title?.trim() || slug(input.title) === slug(parent.title));
  const skillKey = input.skillKey || (sameSkill ? parent!.skillKey : slug(title));
  if (!parent && input.parentId === undefined) {
    parent = await lessons.findOne({ skillKey, status: { $in: GOOD_STATUSES } }, { sort: { version: -1 } });
  }
  const last = await lessons.findOne({ skillKey }, { sort: { version: -1 } });
  const version = (last?.version ?? 0) + 1;
  const embedText = lessonText(title, steps);
  const embedding = EMBED_MODE === 'local' ? (await embed([embedText], 'document'))[0] : undefined;
  const now = new Date();
  const lesson: Lesson = {
    _id: `${skillKey}@v${version}`,
    skillKey, version, title, steps,
    tags: computeTags(steps),
    teacherId: input.teacher.id, teacherName: input.teacher.name, teacherVerified: input.teacher.verified,
    parentId: parent?._id ?? null,
    status: 'trial', embedText, ...(embedding ? { embedding } : {}), createdAt: now,
    expiresAt: new Date(now.getTime() + (input.trialSeconds ? input.trialSeconds * 1000 : TRIAL_MS)),
    provenRuns: 0,
  };
  await lessons.insertOne(lesson);
  await emit({ type: 'published', lessonId: lesson._id, teacherId: lesson.teacherId, detail: { title, version, tags: lesson.tags, teacherName: lesson.teacherName, verified: lesson.teacherVerified, parentId: lesson.parentId, originHomeId: input.originHomeId } });
  const { embedding: _e, ...rest } = lesson as Lesson & { embedding?: number[] };
  return rest;
}

// ---------------------------------------------------------------- home workers

function simulateRun(home: Home, lesson: Lesson) {
  const adapted = adaptToLayout(lesson.steps, home.layout as any);
  const ms = pathLength(adapted) * 120;
  return { adapted, ms };
}

async function runLesson(home: Home, lesson: Lesson, cause: 'ripple' | 'ask') {
  const { runs, lessons } = await collections();
  const startedAt = new Date();
  const { adapted, ms } = simulateRun(home, lesson);
  const run = { homeId: home._id, lessonId: lesson._id, cause, startedAt, endedAt: new Date(startedAt.getTime() + ms), outcome: 'ok', ms, path: adapted };
  await runs.insertOne(run);
  await emit({ type: 'ran', homeId: home._id, lessonId: lesson._id, teacherId: lesson.teacherId, detail: { cause, ms, path: adapted, title: lesson.title, version: lesson.version, teacherName: lesson.teacherName } });
  if (cause === 'ask') {
    // Only real requests count toward proving a lesson. Three proven runs end the trial.
    const r = await lessons.findOneAndUpdate({ _id: lesson._id }, { $inc: { provenRuns: 1 } }, { returnDocument: 'after' });
    if (r && r.status === 'trial' && r.provenRuns >= 3) {
      await lessons.updateOne({ _id: lesson._id, status: 'trial' }, { $set: { status: 'proven', expiresAt: null } });
    }
  }
  return run;
}

/** Newest good version of a skill that this home's rules allow. */
async function bestAllowed(home: Home, skillKey: string) {
  const { lessons } = await collections();
  const cands = await lessons.find({ skillKey, status: { $in: GOOD_STATUSES } }).sort({ version: -1 }).toArray();
  return cands.find((l) => !blockingRule(l.tags, home.blockedTags)) ?? null;
}

const workers = new Map<string, { stream: ChangeStream<Lesson>; startedAt: Date }>();

async function handleChange(homeId: string, change: ChangeStreamDocument<Lesson>, startedAt: Date) {
  const { homes } = await collections();
  const home = await homes.findOne({ _id: homeId });
  if (!home) return;
  const wall = (change as any).wallTime as Date | undefined;
  const catchingUp = !!wall && wall < startedAt;

  if (change.operationType === 'insert') {
    const lesson = change.fullDocument;
    if (!GOOD_STATUSES.includes(lesson.status)) return;
    const rule = blockingRule(lesson.tags, home.blockedTags);
    if (catchingUp) await emit({ type: 'caught_up', homeId, lessonId: lesson._id });
    if (rule) {
      await emit({ type: 'refused', homeId, lessonId: lesson._id, teacherId: lesson.teacherId, rule, detail: { title: lesson.title, version: lesson.version, teacherName: lesson.teacherName, tags: lesson.tags } });
      return;
    }
    const currentId = home.activeLessons?.[lesson.skillKey];
    const current = currentId ? await (await collections()).lessons.findOne({ _id: currentId }) : null;
    if (current && current.version > lesson.version && GOOD_STATUSES.includes(current.status)) return;
    await homes.updateOne({ _id: homeId }, { $set: { [`activeLessons.${lesson.skillKey}`]: lesson._id } });
    await emit({ type: 'delivered', homeId, lessonId: lesson._id, teacherId: lesson.teacherId, detail: { title: lesson.title, version: lesson.version, teacherName: lesson.teacherName, verified: lesson.teacherVerified, tags: lesson.tags } });
    await pushHome(homeId);
    await runLesson({ ...home, activeLessons: { ...home.activeLessons, [lesson.skillKey]: lesson._id } }, lesson, 'ripple');
    return;
  }

  if (change.operationType === 'update' || change.operationType === 'replace') {
    const lesson = change.fullDocument;
    if (!lesson || GOOD_STATUSES.includes(lesson.status)) return;
    if (home.activeLessons?.[lesson.skillKey] !== lesson._id) return;
    if (catchingUp) await emit({ type: 'caught_up', homeId, lessonId: lesson._id });
    const fallback = await bestAllowed(home, lesson.skillKey);
    if (fallback) await homes.updateOne({ _id: homeId }, { $set: { [`activeLessons.${lesson.skillKey}`]: fallback._id } });
    else await homes.updateOne({ _id: homeId }, { $unset: { [`activeLessons.${lesson.skillKey}`]: '' } });
    await emit({ type: 'reverted', homeId, lessonId: lesson._id, detail: { from: lesson._id, to: fallback?._id ?? null, toTitle: fallback?.title ?? null, toVersion: fallback?.version ?? null, reason: lesson.status } });
    await pushHome(homeId);
    if (fallback) await runLesson(home, fallback, 'ripple');
  }
}

export async function startWorker(homeId: string) {
  if (workers.has(homeId)) return;
  const { homes, lessons } = await collections();
  const home = await homes.findOne({ _id: homeId });
  if (!home) throw new Error(`no home ${homeId}`);
  const pipeline = [
    { $match: { $or: [{ operationType: 'insert' }, { operationType: 'update', 'updateDescription.updatedFields.status': { $exists: true } }] } },
  ];
  const opts: any = { fullDocument: 'updateLookup' };
  if (home.resumeToken) opts.resumeAfter = home.resumeToken;
  const stream = lessons.watch<Lesson>(pipeline, opts);
  const startedAt = new Date();
  workers.set(homeId, { stream, startedAt });
  await homes.updateOne({ _id: homeId }, { $set: { online: true } });
  await pushHome(homeId);
  (async () => {
    try {
      for await (const change of stream) {
        try {
          await handleChange(homeId, change, startedAt);
        } catch (err) {
          console.error(`[${homeId}]`, err);
        }
        // Save the resume token after every event: a restart replays from here.
        await homes.updateOne({ _id: homeId }, { $set: { resumeToken: change._id } });
      }
    } catch (err: any) {
      if (!String(err?.message).includes('closed')) console.error(`[${homeId}] stream ended`, err?.message);
    }
  })();
}

export async function stopWorker(homeId: string) {
  const w = workers.get(homeId);
  if (!w) return;
  workers.delete(homeId);
  await w.stream.close();
  const { homes } = await collections();
  await homes.updateOne({ _id: homeId }, { $set: { online: false } });
  await pushHome(homeId);
}

export async function startAllWorkers() {
  const { homes } = await collections();
  const all = await homes.find({}, { projection: { _id: 1 } }).toArray();
  await Promise.all(all.map((h) => startWorker(h._id)));
  return all.length;
}

export async function stopAllWorkers() {
  await Promise.all([...workers.keys()].map(stopWorker));
}

// ---------------------------------------------------------------- ask (Vector Search under each home's rules)

// Measured with scripts/tune-match.ts on the local model: "put the dishes away" scores
// 0.727 on "load the dishwasher" and 0.667 on "kitchen tidy". Re-tune if the model changes.
// Measured floors. atlas: rerank-3 scores (scripts/probe-rerank.ts) put "put the dishes away" at 0.649 on
// "load the dishwasher", 0.545 on the next lesson, and "make me a sandwich" at 0.318 at most.
// local: all-MiniLM cosine-derived scores (scripts/tune-match.ts) put it at 0.727 vs 0.667.
export const MATCH_FLOOR = Number(process.env.MATCH_FLOOR ?? (EMBED_MODE === 'atlas' ? 0.6 : 0.7));
// Atlas builds auto-embeddings asynchronously (measured ~1.9 s from insert to searchable).
const INDEX_LAG_MS = Number(process.env.INDEX_LAG_MS ?? 3000);

/** "Who taught you that?": the home's last requested run, its lesson, the lesson's ancestors, and how far it spread. */
export async function provenance(homeId: string) {
  const { runs, lessons, events } = await collections();
  const [last] = await runs.find({ homeId, cause: 'ask' }).sort({ startedAt: -1 }).limit(1).toArray();
  if (!last) return null;
  const [l] = await lessons.aggregate([
    { $match: { _id: last.lessonId } },
    { $graphLookup: { from: 'lessons', startWith: '$parentId', connectFromField: 'parentId', connectToField: '_id', as: 'ancestors', depthField: 'depth' } },
    { $project: { embedding: 0, embedText: 0, 'ancestors.embedding': 0, 'ancestors.embedText': 0 } },
  ]).toArray();
  if (!l) return null;
  const [took, refused] = await Promise.all([
    events.distinct('homeId', { lessonId: l._id, type: 'delivered' }),
    events.distinct('homeId', { lessonId: l._id, type: 'refused' }),
  ]);
  const parents = (l.ancestors as any[]).sort((a, b) => a.depth - b.depth).map((a) => ({ id: a._id, title: a.title, version: a.version, teacherName: a.teacherName }));
  return {
    lesson: { id: l._id, title: l.title, version: l.version, teacherName: l.teacherName, teacherVerified: l.teacherVerified, status: l.status, createdAt: l.createdAt },
    parents, took: took.length, refused: refused.length,
  };
}

export async function ask(homeId: string, text: string, lang: Lang = 'en') {
  const { homes, lessons } = await collections();
  const home = await homes.findOne({ _id: homeId });
  if (!home) throw new Error(`no home ${homeId}`);
  if (PROVENANCE_ASK.test(text)) {
    const p = await provenance(homeId);
    await emit({ type: 'asked', homeId, detail: { text, lang, provenance: p ? p.lesson.id : null } });
    return { homeId, text, lang, answer: 'provenance' as const, provenance: p, say: p ? `${p.lesson.teacherName} taught me "${p.lesson.title}" v${p.lesson.version}.` : "I haven't done anything yet.", matches: [] };
  }
  const newest = await lessons.findOne({}, { sort: { createdAt: -1 }, projection: { createdAt: 1 } });
  const wait = newest ? INDEX_LAG_MS - (Date.now() - newest.createdAt.getTime()) : 0;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const blocked = home.blockedTags;
  const filter = { status: { $in: GOOD_STATUSES } };
  const pipeline: any[] = EMBED_MODE === 'atlas'
    ? [
        { $vectorSearch: { index: 'lesson_vectors', path: 'embedText', query: text, numCandidates: 100, limit: 10, filter } },
        { $addFields: { vectorScore: { $meta: 'vectorSearchScore' } } },
        // The index filter can trail a status change by a second or two; the document itself is the truth.
        { $match: filter },
        { $rerank: { query: { text }, path: 'embedText', numDocsToRerank: 10, model: RERANK_MODEL } },
        { $addFields: { score: { $meta: 'score' } } },
        { $project: { embedding: 0 } },
      ]
    : [
        { $vectorSearch: { index: 'lesson_vectors', path: 'embedding', queryVector: (await embed([text], 'query'))[0], numCandidates: 100, limit: 10, filter } },
        { $addFields: { score: { $meta: 'vectorSearchScore' } } },
        { $match: filter },
        { $project: { embedding: 0 } },
      ];
  const all = (await lessons.aggregate(pipeline).toArray()) as (Lesson & { score: number; vectorScore?: number })[];
  const matches = all.map((l) => ({
    id: l._id, title: l.title, skillKey: l.skillKey, version: l.version, score: Number(l.score.toFixed(3)),
    vectorScore: l.vectorScore != null ? Number(l.vectorScore.toFixed(3)) : undefined,
    blockedBy: blockingRule(l.tags, blocked), active: home.activeLessons?.[l.skillKey] === l._id,
  }));
  // The home's own rules drop lessons it may not use; then it runs the version it has active for that skill.
  const allowed = all.filter((l) => !blockingRule(l.tags, blocked) && l.score >= MATCH_FLOOR);
  const skill = allowed.find((l) => home.activeLessons?.[l.skillKey]);
  await emit({ type: 'asked', homeId, detail: { text, lang, top: matches.slice(0, 3) } });
  if (!skill) {
    const refused = all.find((l) => blockingRule(l.tags, blocked) && l.score >= MATCH_FLOOR);
    return {
      homeId, text, lang, answer: 'unknown' as const,
      say: refused
        ? `I won't do that here: "${refused.title}" is blocked by this home's rule (${blockingRule(refused.tags, blocked)}).`
        : "I don't know how to do that yet.",
      matches,
    };
  }
  const lesson = await lessons.findOne({ _id: home.activeLessons[skill.skillKey] });
  if (!lesson) throw new Error('active lesson missing');
  const run = await runLesson(home, lesson, 'ask');
  return {
    homeId, text, lang, answer: 'ran' as const,
    say: `Doing "${lesson.title}" v${lesson.version} (taught by ${lesson.teacherName}).`,
    lesson: { id: lesson._id, title: lesson.title, version: lesson.version, teacherName: lesson.teacherName, tags: lesson.tags },
    run: { ms: run.ms, path: run.path },
    matches,
  };
}

// ---------------------------------------------------------------- lineage ($graphLookup)

export async function lineage(lessonId: string) {
  const { lessons, events } = await collections();
  const up = await lessons.aggregate([
    { $match: { _id: lessonId } },
    { $graphLookup: { from: 'lessons', startWith: '$parentId', connectFromField: 'parentId', connectToField: '_id', as: 'ancestors' } },
    { $project: { ancestors: { _id: 1, parentId: 1 } } },
  ]).toArray();
  if (!up.length) throw new Error('no such lesson');
  const root = (up[0].ancestors as any[]).find((a) => !a.parentId)?._id ?? lessonId;
  const tree = await lessons.aggregate([
    { $match: { _id: root } },
    { $graphLookup: { from: 'lessons', startWith: '$_id', connectFromField: '_id', connectToField: 'parentId', as: 'descendants', depthField: 'depth' } },
  ]).toArray();
  const nodes = [tree[0], ...(tree[0].descendants as any[])].map(({ embedding, embedText, descendants, ...n }: any) => n);
  const ids = nodes.map((n) => n._id);
  const reach = await events.aggregate([
    { $match: { lessonId: { $in: ids }, type: { $in: ['delivered', 'refused', 'ran', 'reverted'] } } },
    { $group: { _id: { lessonId: '$lessonId', type: '$type' }, homes: { $addToSet: '$homeId' } } },
  ]).toArray();
  for (const n of nodes) {
    n.homes = {};
    for (const r of reach) if (r._id.lessonId === n._id) n.homes[r._id.type] = (r.homes as string[]).sort();
  }
  return { root, nodes };
}

// ---------------------------------------------------------------- rollback + forget (transactions)

export async function rollback(lessonId: string, actor: Teacher, allowed: (t: Teacher) => boolean) {
  if (!allowed(actor)) throw Object.assign(new Error(`${actor.name} is not allowed to roll back lessons`), { status: 403 });
  const { lessons, receipts } = await collections();
  const found = await lessons.aggregate([
    { $match: { _id: lessonId } },
    { $graphLookup: { from: 'lessons', startWith: '$_id', connectFromField: '_id', connectToField: 'parentId', as: 'descendants' } },
    { $project: { ids: { $concatArrays: [['$_id'], '$descendants._id'] } } },
  ]).toArray();
  if (!found.length) throw new Error('no such lesson');
  const ids: string[] = found[0].ids;
  const startedAt = new Date();
  const session = client.startSession();
  let receiptId: unknown;
  try {
    await session.withTransaction(async () => {
      await lessons.updateMany({ _id: { $in: ids }, status: { $in: GOOD_STATUSES } }, { $set: { status: 'rolled_back', expiresAt: null } }, { session });
      const r = await receipts.insertOne({ type: 'rollback', by: actor, lessonIds: ids, startedAt }, { session });
      receiptId = r.insertedId;
    });
  } finally {
    await session.endSession();
  }
  await emit({ type: 'rolled_back', lessonId, teacherId: actor.id, detail: { ids, by: actor.name, receiptId } });
  return { receiptId, ids, startedAt };
}

export async function forgetTeacher(teacherId: string, actor: Teacher) {
  if (actor.id !== teacherId) throw Object.assign(new Error('you can only forget yourself'), { status: 403 });
  const { lessons, teachers, receipts, events } = await collections();
  // Everything they ever taught, including lessons already rolled back: the receipt has to account for all of it.
  const taught = await lessons.find({ teacherId, status: { $ne: 'forgotten' } }, { projection: { _id: 1 } }).toArray();
  const ids = taught.map((l) => l._id);
  const homesHolding = await events.distinct('homeId', { lessonId: { $in: ids }, type: 'delivered' });
  const session = client.startSession();
  let receiptId: unknown;
  try {
    await session.withTransaction(async () => {
      // Retire every lesson they taught AND erase who they were: the name leaves the lessons, the
      // teacher record, the event log and the receipt. The lesson text is blanked so search can't find it.
      await lessons.updateMany({ teacherId }, { $set: { status: 'forgotten', expiresAt: null, teacherName: 'a forgotten teacher', embedText: 'forgotten lesson' } }, { session });
      await teachers.updateOne({ _id: teacherId as any }, { $set: { forgottenAt: new Date(), name: null } }, { session });
      await events.updateMany({ teacherId }, { $unset: { 'detail.teacherName': '', 'detail.by': '' } }, { session });
      const r = await receipts.insertOne({ type: 'forget', teacherId, lessonIds: ids, homes: homesHolding, startedAt: new Date(), erased: ['lessons.teacherName', 'lessons.embedText', 'teachers.name', 'events.detail.teacherName'] }, { session });
      receiptId = r.insertedId;
    });
  } finally {
    await session.endSession();
  }
  await emit({ type: 'forgotten', teacherId, detail: { ids, homes: homesHolding, receiptId } });
  return { receiptId, lessonIds: ids, homes: homesHolding };
}

// ---------------------------------------------------------------- scoreboard (measured, never typed)

export async function scoreboard() {
  const { homes, lessons, events, receipts, runs } = await collections();
  const allHomes = await homes.find({}, { projection: { resumeToken: 0, layout: 0 } }).toArray();
  const kidHomes = allHomes.filter((h) => h.hasKids);

  // Live invariant: no lesson a kids' home blocks is active in that home.
  let violations = 0;
  for (const h of kidHomes) {
    const active = Object.values(h.activeLessons ?? {});
    if (!active.length) continue;
    violations += await lessons.countDocuments({ _id: { $in: active }, tags: { $in: h.blockedTags }, status: { $in: GOOD_STATUSES } });
  }

  const lastPub = await events.findOne({ type: 'published' }, { sort: { at: -1 } });
  let ripple = null;
  if (lastPub) {
    const evs = await events.find({ lessonId: lastPub.lessonId, type: { $in: ['delivered', 'refused'] } }).toArray();
    const delivered = evs.filter((e) => e.type === 'delivered');
    const lastAt = Math.max(...evs.map((e) => e.at.getTime()), lastPub.at.getTime());
    ripple = {
      lessonId: lastPub.lessonId, delivered: delivered.length, refused: evs.length - delivered.length,
      homesHeard: evs.length, ms: evs.length ? lastAt - lastPub.at.getTime() : null,
    };
  }

  const lastRb = await receipts.findOne({ type: 'rollback' }, { sort: { startedAt: -1 } });
  let lastRollback = null;
  if (lastRb) {
    const rev = await events.find({ type: 'reverted', lessonId: { $in: lastRb.lessonIds }, at: { $gte: lastRb.startedAt } }).toArray();
    lastRollback = {
      homes: new Set(rev.map((e) => e.homeId)).size,
      ms: rev.length ? Math.max(...rev.map((e) => e.at.getTime())) - lastRb.startedAt.getTime() : null,
    };
  }

  const refusals = await events.aggregate([{ $match: { type: 'refused' } }, { $group: { _id: '$homeId', n: { $sum: 1 } } }]).toArray();
  const refusedInKidHomes = refusals.filter((r) => kidHomes.some((h) => h._id === r._id)).reduce((s, r) => s + r.n, 0);
  const refusedElsewhere = refusals.reduce((s, r) => s + r.n, 0) - refusedInKidHomes;

  const homesKnowing = allHomes.filter((h) => Object.keys(h.activeLessons ?? {}).length > 0).length;

  // Memory in sync: each home should hold, per skill, the newest good version its rules allow.
  // A home that missed a change (offline, or the server was down) shows here until it catches up.
  const good = await lessons.find({ status: { $in: GOOD_STATUSES } }, { projection: { _id: 1, skillKey: 1, version: 1, tags: 1 } }).sort({ version: -1 }).toArray();
  let outOfSync = 0;
  const homesInSync = allHomes.filter((h) => {
    const expected: Record<string, string> = {};
    for (const l of good) if (!expected[l.skillKey] && !blockingRule(l.tags, h.blockedTags)) expected[l.skillKey] = l._id;
    const actual = h.activeLessons ?? {};
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    let bad = 0;
    for (const k of keys) if (expected[k] !== actual[k]) bad++;
    outOfSync += bad;
    return bad === 0;
  }).length;
  const caughtUp = await events.countDocuments({ type: 'caught_up' });
  const runsOk = await runs.countDocuments({ outcome: 'ok' });
  const runsFailed = await runs.countDocuments({ outcome: { $ne: 'ok' } });
  const lessonCounts = await lessons.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]).toArray();

  return {
    at: new Date(),
    invariant: { kidsHomeViolations: violations },
    ripple, lastRollback,
    refusals: { kidHomes: refusedInKidHomes, otherHomes: refusedElsewhere },
    homesOnline: allHomes.filter((h) => h.online).length, homesTotal: allHomes.length, homesKnowing,
    memory: { homesInSync, outOfSync },
    caughtUp, runs: { ok: runsOk, failed: runsFailed },
    lessons: Object.fromEntries(lessonCounts.map((c) => [c._id, c.n])),
  };
}
