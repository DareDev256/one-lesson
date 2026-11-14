import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { collections, getDb } from './db';
import { EMBED_PROVIDER, warmEmbeddings } from './embed';
import { hear, say, voiceEnabled } from './voice';
import { parseSpokenLesson } from './domain';
import {
  ask, forgetTeacher, lineage, onBroadcast, publish, rollback, scoreboard, startAllWorkers, startWorker, stopWorker, type Teacher,
} from './fleet';

const PORT = Number(process.env.PORT ?? 8787);
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN;
const AUTH0_CLIENT_ID = process.env.AUTH0_CLIENT_ID;
// Only these Auth0 subjects may roll back lessons. Enforced here, on the server.
const ROLLBACK_SUBS = (process.env.ROLLBACK_SUBS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const jwks = AUTH0_DOMAIN ? createRemoteJWKSet(new URL(`https://${AUTH0_DOMAIN}/.well-known/jwks.json`)) : null;

const isLocal = (req: Request) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '') && !req.headers['cf-connecting-ip'];

/** Identity comes from a verified Auth0 ID token. Without one, a typed name is accepted and marked unverified. */
async function teacherFrom(req: Request): Promise<Teacher | null> {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ') && jwks) {
    const { payload } = await jwtVerify(auth.slice(7), jwks, { issuer: `https://${AUTH0_DOMAIN}/`, audience: AUTH0_CLIENT_ID });
    return { id: String(payload.sub), name: String(payload.name ?? payload.nickname ?? payload.email ?? 'teacher'), verified: true };
  }
  const typed = String(req.headers['x-teacher-name'] ?? req.body?.teacherName ?? '').trim().slice(0, 40);
  if (!typed) return null;
  return { id: `unverified:${typed.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name: typed, verified: false };
}

function canRollback(t: Teacher, req: Request) {
  if (t.verified) return ROLLBACK_SUBS.includes(t.id);
  // No identity provider configured: only the presenter laptop's "James" may roll back.
  return !jwks && isLocal(req) && t.id === 'unverified:james';
}

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
  fn(req, res).then((out) => res.json(out)).catch((err) => {
    const status = err?.status ?? (err?.code === 'ERR_JWT_EXPIRED' || err?.code?.startsWith?.('ERR_JW') ? 401 : 400);
    res.status(status).json({ error: String(err?.message ?? err) });
  });

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

app.get('/api/config', (_req, res) => res.json({ auth0Domain: AUTH0_DOMAIN ?? null, auth0ClientId: AUTH0_CLIENT_ID ?? null, embedProvider: EMBED_PROVIDER, voice: voiceEnabled() }));

// Speech in (ElevenLabs Scribe). Teach mode also returns the parsed lesson; the steps are deterministic.
app.post('/api/hear', express.raw({ type: () => true, limit: '6mb' }), wrap(async (req) => {
  const teacher = isLocal(req) ? null : await teacherFrom(req);
  if (!isLocal(req) && !teacher?.verified) throw Object.assign(new Error('sign in to use voice'), { status: 401 });
  const text = await hear(req.body as Buffer, String(req.headers['content-type'] ?? 'audio/webm'));
  return { text, lesson: req.query.mode === 'teach' ? parseSpokenLesson(text) : undefined };
}));

// Robot voices (ElevenLabs), presenter laptop only so a public tunnel can't spend the quota.
app.get('/api/say', async (req, res) => {
  try {
    if (!isLocal(req)) return res.status(403).json({ error: 'presenter only' });
    const audio = await say(String(req.query.home ?? ''), String(req.query.text ?? ''));
    res.setHeader('content-type', 'audio/mpeg');
    res.setHeader('cache-control', 'private, max-age=3600');
    res.send(audio);
  } catch (err: any) {
    res.status(err?.status ?? 500).json({ error: String(err?.message ?? err) });
  }
});

app.get('/api/state', wrap(async () => {
  const { homes, lessons, events } = await collections();
  const [h, l, e, s] = await Promise.all([
    homes.find({}, { projection: { resumeToken: 0 } }).sort({ _id: 1 }).toArray(),
    lessons.find({}, { projection: { embedding: 0 } }).sort({ createdAt: 1 }).toArray(),
    events.find({}).sort({ at: -1 }).limit(80).toArray(),
    scoreboard(),
  ]);
  return { homes: h, lessons: l, events: e.reverse(), scoreboard: s };
}));

app.get('/api/scoreboard', wrap(() => scoreboard()));

app.get('/api/lessons', wrap(async () => {
  const { lessons } = await collections();
  return lessons.find({}, { projection: { embedding: 0 } }).sort({ createdAt: 1 }).toArray();
}));

app.post('/api/publish', wrap(async (req) => {
  const teacher = await teacherFrom(req);
  if (!teacher) throw Object.assign(new Error('sign in or give a teacher name'), { status: 401 });
  const { steps, title, skillKey, parentId, originHomeId } = req.body ?? {};
  return publish({ steps, title, skillKey, parentId, teacher, originHomeId: typeof originHomeId === 'string' ? originHomeId : undefined });
}));

app.post('/api/ask', wrap(async (req) => {
  const { homeId, text } = req.body ?? {};
  if (typeof text !== 'string' || !text.trim() || text.length > 200) throw new Error('text is required');
  return ask(String(homeId), text.trim());
}));

app.get('/api/lineage/:id', wrap((req) => lineage(String(req.params.id))));

app.post('/api/rollback', wrap(async (req) => {
  const teacher = await teacherFrom(req);
  if (!teacher) throw Object.assign(new Error('sign in to roll back'), { status: 401 });
  return rollback(String(req.body?.lessonId), teacher, (t) => canRollback(t, req));
}));

app.post('/api/forget', wrap(async (req) => {
  const teacher = await teacherFrom(req);
  if (!teacher) throw Object.assign(new Error('sign in to be forgotten'), { status: 401 });
  return forgetTeacher(teacher.id, teacher);
}));

app.post('/api/homes/:id/:state', wrap(async (req) => {
  if (!isLocal(req)) throw Object.assign(new Error('presenter only'), { status: 403 });
  const id = String(req.params.id);
  if (req.params.state === 'offline') await stopWorker(id);
  else if (req.params.state === 'online') await startWorker(id);
  else throw new Error('state must be online or offline');
  return { ok: true };
}));

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web/dist');
app.use(express.static(dist));
app.get(/^\/(?!api|ws).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
onBroadcast((msg) => {
  const data = JSON.stringify(msg);
  for (const c of wss.clients) if (c.readyState === c.OPEN) c.send(data);
});

// The scoreboard is re-queried every second and pushed live.
setInterval(async () => {
  if (!wss.clients.size) return;
  try {
    const s = await scoreboard();
    const data = JSON.stringify({ kind: 'scoreboard', scoreboard: s });
    for (const c of wss.clients) if (c.readyState === c.OPEN) c.send(data);
  } catch (err) { console.error('scoreboard', err); }
}, 1000);

await getDb();
console.log('connected to Atlas');
const n = await startAllWorkers();
console.log(`${n} home workers watching lessons`);
warmEmbeddings().then(() => console.log(`embeddings ready (${EMBED_PROVIDER})`)).catch((e) => console.error('embed warmup', e));
server.listen(PORT, () => console.log(`One Lesson on http://localhost:${PORT}`));

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { console.log('\nfleet stopping'); process.exit(0); });
