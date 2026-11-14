// Practice-run scorecard: reads the demo server's event log (and the Home 5 agent's last conversation, when an
// ElevenLabs key is set) and grades the last run against the pitch script: did each beat fire, and when.
// Usage: node scripts/run-check.mjs   (the control panel's "Check my last run" button runs this)
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(path.join(ROOT, '.env'))) process.loadEnvFile(path.join(ROOT, '.env'));
const DEMO = process.env.DEMO_URL ?? `http://localhost:${process.env.DEMO_PORT ?? 8787}`;

const st = await (await fetch(`${DEMO}/api/state`, { signal: AbortSignal.timeout(10000) })).json();
const ev = st.events.filter((e) => e.type !== 'delivered' && !(e.type === 'ran' && e.detail?.cause !== 'ask'));
const asks = ev.filter((e) => e.type === 'asked');
if (!asks.length) { console.log('No run yet: nothing has been asked since the last reset.'); process.exit(0); }

const ms = (e) => new Date(e.at).getTime();
const T0 = ms(asks[0]) - 10000; // the clock starts with the 10 s "why", before the first ask
const sec = (t) => Math.round((t - T0) / 1000);
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.abs(s) % 60).padStart(2, '0')}`;
const ranAfter = (a) => ev.find((e) => e.type === 'ran' && e.homeId === a.homeId && ms(e) >= ms(a) && ms(e) - ms(a) < 4000);
const knife = (run) => { const p = run?.detail?.path ?? []; for (let i = 0; i < p.length - 1; i++) if (p[i].objectType === 'knife') return p[i + 1].targetType; return null; };

const rows = [];
const beat = (name, target, at, ok, detail) => rows.push({ name, target, at, ok, detail });

// 1 cold open: the first ask, the home does not know yet
const cold = asks[0];
beat('Cold open', 10, ms(cold), !ranAfter(cold), `${cold.homeId.replace('home-', 'Home ')} heard "${cold.detail.text}"${ranAfter(cold) ? ' and RAN something' : ': "I don\'t know"'}${cold.homeId !== 'home-2' ? ' (script: Home 2)' : ''}`);

// 2 teach: the first lesson James publishes
const teach = ev.find((e) => e.type === 'published' && e.detail?.teacherName !== 'Alex');
beat('Teach lands', 35, teach && ms(teach), !!teach, teach ? `"${teach.detail.title}" v${teach.detail.version} published` : 'no lesson published by James');

// 3 the same question again, now it runs the taught lesson
const again = teach && asks.find((a) => ms(a) > ms(teach) && ranAfter(a)?.lessonId === teach.lessonId);
beat('Ask again', 45, again && ms(again), !!again, again ? `${again.homeId.replace('home-', 'Home ')} ran it (${again.detail.top?.[0]?.score ?? '?'})${/--|\bor\b/.test(again.detail.text) ? `, heard "${again.detail.text}"` : ''}` : 'no ask ran the taught lesson');

// 4 bad lesson: Alex's v2, kids' homes refuse
const bad = ev.find((e) => e.type === 'published' && e.detail?.teacherName === 'Alex');
const refusedBy = bad ? ev.filter((e) => e.type === 'refused' && e.lessonId === bad.lessonId).map((e) => e.homeId) : [];
beat('Shift+2 bad lesson', 50, bad && ms(bad), !!bad && refusedBy.includes('home-5') && refusedBy.includes('home-6') && st.scoreboard.invariant.kidsHomeViolations === 0,
  bad ? `kids' homes refused: ${refusedBy.map((h) => h.replace('home-', '')).sort().join(' and ') || 'none'} · violations ${st.scoreboard.invariant.kidsHomeViolations}` : 'Alex\'s lesson never published');

// 5 two kitchens: Home 2 and Home 5 asked within seconds, knife goes low vs high
let split = null;
for (const a of asks) {
  const b = asks.find((x) => x !== a && ms(x) >= ms(a) && ms(x) - ms(a) < 5000 && x.homeId !== a.homeId && a.detail.text.toLowerCase() === x.detail.text.toLowerCase());
  if (b && bad && ms(a) > ms(bad)) { split = [a, b]; break; }
}
const kn = split?.map((a) => `${a.homeId.replace('home-', 'H')} ${knife(ranAfter(a)) ?? 'nothing'}`);
beat('K two kitchens', 75, split && ms(split[0]), !!split && kn.some((k) => k.includes('low_drawer')) && kn.some((k) => k.includes('high_cabinet')), split ? `knife: ${kn.join(' vs ')}` : 'no two-kitchen ask');

// 6 who taught you that
const who = asks.find((a) => a.detail?.provenance);
beat('Who taught', 95, who && ms(who), !!who, who ? `answered with ${who.detail.provenance}` : 'not asked');

// 7 rollback
const rb = ev.find((e) => e.type === 'rolled_back');
const rbMs = st.scoreboard.lastRollback?.ms;
beat('Roll back', 110, rb && ms(rb), !!rb, rb ? `${st.scoreboard.lastRollback?.homes ?? '?'} homes back in ${rbMs} ms: say "${rbMs < 1000 ? `${rbMs} milliseconds` : `${(rbMs / 1000).toFixed(1)} seconds, across the lake to California and back`}"` : 'no rollback');

// 8 French: every ask after the rollback until the agent
const fr = rb ? asks.filter((a) => ms(a) > ms(rb) && a.detail?.lang === 'fr' && ranAfter(a)) : [];
const tries = rb ? asks.filter((a) => ms(a) > ms(rb) && !a.detail?.provenance) : [];
if (tries.length) beat('French (Q&A only)', 125, fr[0] && ms(fr[0]), fr.length > 0, fr.length ? `${tries.length} tr${tries.length === 1 ? 'y' : 'ies'}${tries.length > 1 ? `: ${tries.map((t) => `${t.homeId.replace('home-', 'H')} "${t.detail.text}" [${t.detail.lang}]`).join(' · ')}` : ''}` : 'no French ask ran');

// 9 the ElevenLabs agent refuses (needs the key; the agent's tool is read-only, so it writes no server event)
let agentEnd = null;
const K = process.env.ELEVENLABS_API_KEY, A = process.env.ELEVENLABS_AGENT_ID;
if (K && A) {
  try {
    const j = await (await fetch(`https://api.elevenlabs.io/v1/convai/conversations?page_size=10&agent_id=${A}`, { headers: { 'xi-api-key': K }, signal: AbortSignal.timeout(8000) })).json();
    // the run's own agent call: the FIRST conversation after the run started (a later one may be a test or the next run)
    const c = (j.conversations ?? []).filter((c) => c.start_time_unix_secs * 1000 > T0).sort((x, y) => x.start_time_unix_secs - y.start_time_unix_secs)[0];
    if (c) {
      const d = await (await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${c.conversation_id}`, { headers: { 'xi-api-key': K }, signal: AbortSignal.timeout(8000) })).json();
      const tools = (d.transcript ?? []).flatMap((m) => (m.tool_calls ?? []).map((t) => t.tool_name));
      const said = (d.transcript ?? []).filter((m) => m.role === 'user').map((m) => m.message).join(' / ');
      agentEnd = c.start_time_unix_secs * 1000 + c.call_duration_secs * 1000;
      const users = (d.transcript ?? []).filter((m) => m.role === 'user').length;
      beat('C agent refuses', 120, c.start_time_unix_secs * 1000, tools.includes('check_instruction') && users === 1, `you said "${said}" · tool ${tools.join(', ') || 'none'} · ${c.call_duration_secs} s${users > 1 ? ' · it heard you AFTER the refusal: press C before you speak' : ''}`);
    } else beat('C agent refuses', 120, null, false, 'no agent conversation this run');
  } catch { beat('C agent refuses', 120, null, false, 'could not read the agent log'); }
}

// print
const got = rows.filter((r) => r.ok).length;
console.log(`RUN CHECK  ${got}/${rows.length} beats`);
for (const r of rows) {
  const s = r.at ? sec(r.at) : null;
  const late = s == null ? '' : s - r.target > 8 ? `  +${s - r.target}s late` : '';
  console.log(`${r.ok ? '✓' : '✗'} ${(s == null ? '  -  ' : clock(s)).padStart(5)} (by ${clock(r.target)})  ${r.name.padEnd(18)} ${r.detail}${late}`);
}
const last = agentEnd ?? Math.max(...ev.map(ms));
const total = sec(last) + 15; // + the closing line
const legs = rows.filter((r) => r.at).map((r, i, a) => ({ name: r.name, over: i ? (sec(r.at) - sec(a[i - 1].at)) - (r.target - a[i - 1].target) : 0 }));
const leak = legs.sort((x, y) => y.over - x.over)[0];
console.log(`TOTAL ≈ ${clock(total)} with the close (slot 3:00)${total > 180 ? ` · over by ${total - 180}s · biggest leak: getting to "${leak.name}" (+${leak.over}s)` : ' · on time'}`);
console.log(`SUMMARY ${got}/${rows.length} beats · ≈ ${clock(total)}${total > 180 ? ` (over ${total - 180}s, leak: ${leak.name})` : ' · on time'}`);
