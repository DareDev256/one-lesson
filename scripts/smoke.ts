// Runs the demo's beats against a running server (after `npm run demo:reset` + `npm start`)
export {};
// and fails loudly if any of them stop being true. Usage: npm run smoke
const B = process.env.BASE ?? 'http://localhost:8787';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failures++; };

async function call(path: string, body?: unknown, teacher?: string) {
  const res = await fetch(B + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(teacher ? { 'x-teacher-name': teacher } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as any };
}
const ask = async (homeId: string, text: string) => (await call('/api/ask', { homeId, text })).body;
const knife = (r: any) => {
  const p = r.run?.path ?? [];
  for (let i = 0; i < p.length - 1; i++) if (p[i].objectType === 'knife') return p[i + 1].targetType;
  return null;
};

const S = {
  dishwasher: [{ action: 'pick', objectType: 'plate' }, { action: 'place', targetType: 'dishwasher' }, { action: 'pick', objectType: 'cup' }, { action: 'place', targetType: 'dishwasher' }],
  tidyV2: [{ action: 'pick', objectType: 'knife' }, { action: 'place', targetType: 'low_drawer' }, { action: 'pick', objectType: 'scissors' }, { action: 'place', targetType: 'low_drawer' }],
  evening: [{ action: 'pick', objectType: 'pan' }, { action: 'place', targetType: 'sink' }, { action: 'pick', objectType: 'knife' }, { action: 'place', targetType: 'low_drawer' }],
};

// Beat 1: before
let r = await ask('home-2', 'put the dishes away');
check(r.answer === 'unknown', `before: Home 2 does not know "put the dishes away" (${r.say})`);

// Beat 2: teach + ripple
await call('/api/publish', { title: 'load the dishwasher', originHomeId: 'home-1', steps: S.dishwasher }, 'James');
await sleep(1500);
let sb = (await call('/api/scoreboard')).body;
check(sb.ripple?.delivered === 6, `ripple: ${sb.ripple?.delivered}/6 homes learned in ${sb.ripple?.ms} ms`);
r = await ask('home-2', 'put the dishes away');
check(r.answer === 'ran' && r.lesson?.title === 'load the dishwasher', `after: Home 2 runs "${r.lesson?.title}" (score ${r.matches?.[0]?.score})`);

// Beat 3: the bad lesson
await call('/api/publish', { title: 'kitchen tidy', originHomeId: 'home-3', steps: S.tidyV2 }, 'Alex');
await sleep(1500);
sb = (await call('/api/scoreboard')).body;
check(sb.ripple?.delivered === 4 && sb.ripple?.refused === 2, `bad v2: ${sb.ripple?.delivered} took it, ${sb.ripple?.refused} refused`);
check(sb.invariant.kidsHomeViolations === 0, `invariant: ${sb.invariant.kidsHomeViolations} blocked lessons active in kids' homes`);
r = await ask('home-2', 'tidy the kitchen');
check(knife(r) === 'low_drawer', `Home 2 "tidy the kitchen": knife → ${knife(r)}`);
r = await ask('home-5', 'tidy the kitchen');
check(knife(r) === 'high_cabinet', `Home 5 "tidy the kitchen": knife → ${knife(r)}`);
const ev = await call('/api/publish', { title: 'evening reset', parentId: 'kitchen-tidy@v2', originHomeId: 'home-3', steps: S.evening }, 'Alex');
check(ev.body._id === 'evening-reset@v1' && ev.body.parentId === 'kitchen-tidy@v2', `"evening reset" is its own skill built on v2 (${ev.body._id} ← ${ev.body.parentId})`);
await sleep(1500);

// Beat 4: trace and undo
const lin = (await call('/api/lineage/kitchen-tidy@v2')).body;
check(lin.root === 'kitchen-tidy@v1' && lin.nodes.length === 3, `lineage from v2 walks to root ${lin.root}, ${lin.nodes.length} nodes`);
const denied = await call('/api/rollback', { lessonId: 'kitchen-tidy@v2' }, 'Alex');
check(denied.status === 403, `rollback as Alex refused (HTTP ${denied.status})`);
const rb = await call('/api/rollback', { lessonId: 'kitchen-tidy@v2' }, 'James');
check(rb.body.ids?.length === 2, `rollback as James covers v2 and everything built on it (${rb.body.ids})`);
await sleep(2500);
sb = (await call('/api/scoreboard')).body;
check(sb.lastRollback?.homes === 4, `rolled back across ${sb.lastRollback?.homes} homes in ${sb.lastRollback?.ms} ms`);
r = await ask('home-2', 'tidy the kitchen');
check(knife(r) === 'high_cabinet' && r.lesson?.version === 1, `after rollback Home 2: knife → ${knife(r)} (v${r.lesson?.version})`);
check(!r.matches.some((m: any) => m.id === 'kitchen-tidy@v2'), 'rolled-back v2 no longer appears in search');

// Offline home catches up from its resume token
await call('/api/homes/home-4/offline', {});
await call('/api/publish', { title: 'rinse the pan', originHomeId: 'home-1', steps: [{ action: 'pick', objectType: 'pan' }, { action: 'place', targetType: 'sink' }] }, 'James');
await sleep(1200);
await call('/api/homes/home-4/online', {});
await sleep(2000);
sb = (await call('/api/scoreboard')).body;
check(sb.caughtUp >= 1, `offline Home 4 caught up on ${sb.caughtUp} missed change(s) after reconnecting`);

console.log(failures ? `\n${failures} FAILED` : '\nall beats pass');
process.exit(failures ? 1 : 0);
