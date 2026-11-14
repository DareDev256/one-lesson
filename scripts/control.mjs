// One Lesson presenter control panel: big buttons for the demo server, on its own port, so it keeps working
// while the demo server is down (that is the pull-the-plug beat). Bound to 127.0.0.1 only; a fixed list of
// actions, no arbitrary commands. Usage: npm run control  -> http://localhost:8799
import http from 'node:http';
import { spawn, execFile, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEMO_PORT = Number(process.env.DEMO_PORT ?? 8787);
const CONTROL_PORT = Number(process.env.CONTROL_PORT ?? 8799);
const DEMO = `http://localhost:${DEMO_PORT}`;
const childEnv = { ...process.env, PORT: String(DEMO_PORT) };

let child = null;
let busy = null;
let last = { action: null, ok: null, at: null, note: '' };
const logs = [];
const log = (line) => { for (const l of String(line).split('\n')) if (l.trim()) logs.push(`${new Date().toLocaleTimeString('en-CA', { hour12: false })}  ${l}`); while (logs.length > 160) logs.shift(); };

const pidOnPort = () => { try { return execFileSync('lsof', ['-nP', `-iTCP:${DEMO_PORT}`, '-sTCP:LISTEN', '-t']).toString().trim().split('\n').filter(Boolean).map(Number); } catch { return []; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function up() { try { const r = await fetch(`${DEMO}/api/config`, { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; } }

function run(script, label) {
  return new Promise((resolve, reject) => {
    log(`▶ ${label}`);
    const p = execFile('npx', ['tsx', script], { cwd: ROOT, env: childEnv, timeout: 240000 }, (err, stdout, stderr) => {
      log(stdout); if (stderr) log(stderr);
      err ? reject(new Error(`${label} failed`)) : resolve();
    });
    p.on('error', reject);
  });
}

async function stop() {
  const pids = pidOnPort();
  if (!pids.length && !child) { log('server already stopped'); return; }
  log(`■ stopping demo server (pid ${pids.join(', ') || child?.pid})`);
  for (const pid of pids) { try { process.kill(pid, 'SIGINT'); } catch {} }
  if (child) { try { child.kill('SIGINT'); } catch {} }
  for (let i = 0; i < 40 && pidOnPort().length; i++) await sleep(150);
  for (const pid of pidOnPort()) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  child = null;
  log('server stopped: the console shows SERVER DOWN');
}

async function start() {
  if (pidOnPort().length) { log('server already running'); return; }
  log('▶ starting demo server');
  child = spawn('npx', ['tsx', 'server/index.ts'], { cwd: ROOT, env: childEnv });
  child.stdout.on('data', (d) => log(d));
  child.stderr.on('data', (d) => log(d));
  child.on('exit', (code) => { log(`server exited (${code ?? 'signal'})`); child = null; });
  for (let i = 0; i < 80; i++) { if (await up()) { log(`server up on ${DEMO}`); return; } await sleep(250); }
  throw new Error('server did not come up in 20 s');
}

async function health() {
  let s = null;
  for (let i = 0; i < 2 && !s; i++) {
    try { s = await (await fetch(`${DEMO}/api/scoreboard`, { signal: AbortSignal.timeout(10000) })).json(); }
    catch (e) { if (i === 1) throw new Error('health check timed out (the homes may still be catching up; press Health check again)'); await sleep(1500); }
  }
  const note = `${s.homesOnline}/${s.homesTotal} homes online · memory in sync ${s.memory.homesInSync}/${s.homesTotal} · ${s.invariant.kidsHomeViolations} blocked lessons in kids' homes`;
  log(`✓ ${note}`); return note;
}

const ACTIONS = {
  reset: { label: 'Reset & start', run: async () => { await stop(); await run('scripts/demo-reset.ts', 'reset demo state'); await run('scripts/voice-warm.ts', 'warm robot voices'); await start(); return health(); } },
  restart: { label: 'Restart (keep memory)', run: async () => { await stop(); await start(); return health(); } },
  start: { label: 'Start', run: async () => { await start(); return health(); } },
  stop: { label: 'Stop (pull the plug)', run: stop },
  publish_direct: { label: 'Write a lesson while down', run: async () => { await run('scripts/publish-direct.ts', 'another server writes a lesson straight to Atlas'); } },
  warm: { label: 'Warm voices', run: () => run('scripts/voice-warm.ts', 'warm robot voices') },
  health: { label: 'Health check', run: health },
  selftest: { label: 'Full self-test, then reset', run: async () => {
    if (!(await up())) await start();
    await run('scripts/smoke.ts', 'self-test: all demo beats (22 checks)');
    await stop(); await run('scripts/demo-reset.ts', 'reset demo state'); await run('scripts/voice-warm.ts', 'warm robot voices'); await start();
    return health();
  } },
  open_console: { label: 'Open console', run: async () => { execFile('open', ['-a', 'Google Chrome', `${DEMO}/`]); log('opened the console in Chrome'); } },
  open_pitch: { label: 'Open pitch page', run: async () => { execFile('open', ['-a', 'Google Chrome', 'https://claude.ai/artifact/Egd7qJWkAsxqbyTtTMHvCM']); log('opened the pitch page'); } },
};

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>One Lesson Control</title>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,800..900&family=IBM+Plex+Sans:wght@500;600&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#000;--ink:#f2f2f2;--dim:#8a8a8a;--line:#222;--accent:#ff5a1f;--red:#ff3b3b;--green:#2fd27a;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:500 16px 'IBM Plex Sans',system-ui,sans-serif}
.wrap{max-width:980px;margin:0 auto;padding:22px max(16px,env(safe-area-inset-left,0px));display:grid;gap:18px}
header{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.wm{font:900 34px 'Archivo';font-stretch:64%;color:var(--accent)}
.status{font:700 15px 'JetBrains Mono',monospace;padding:8px 14px;border-radius:99px;border:2px solid var(--line)}
.status.up{color:#000;background:var(--green);border-color:var(--green)}.status.down{color:#000;background:var(--red);border-color:var(--red)}
.busy{font:600 14px 'JetBrains Mono',monospace;color:var(--accent)}
h2{font:800 22px 'Archivo';font-stretch:72%;margin:0 0 8px;color:var(--dim);letter-spacing:.04em;text-transform:uppercase}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px}
button{font:700 18px 'IBM Plex Sans',sans-serif;min-height:68px;border-radius:12px;border:2px solid #333;background:#111;color:var(--ink);cursor:pointer;padding:10px 14px;text-align:left;display:grid;gap:3px}
button small{font:500 13px 'JetBrains Mono',monospace;color:var(--dim)}
button:hover{border-color:#666}button:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
button.primary{background:var(--accent);border-color:var(--accent);color:#000}button.primary small{color:#331000}
button.danger{border-color:var(--red);color:var(--red)}
button:disabled{opacity:.45;cursor:wait}
.plug{border:2px dashed #333;border-radius:14px;padding:12px}
.note{font:600 15px 'JetBrains Mono',monospace;color:var(--green);min-height:20px}
pre{margin:0;background:#070707;border:1px solid var(--line);border-radius:10px;padding:12px;font:500 13px/1.45 'JetBrains Mono',monospace;color:#cfcfcf;height:260px;overflow:auto;white-space:pre-wrap}
</style></head><body><div class="wrap">
<header><div class="wm">ONE LESSON · CONTROL</div><span id="st" class="status">checking…</span><span id="busy" class="busy"></span></header>
<section><h2>Demo server</h2><div class="grid">
<button class="primary" data-a="reset">Reset &amp; start<small>clean state for a run · ~15 s</small></button>
<button data-a="restart">Restart<small>keeps everything the fleet learned</small></button>
<button data-a="start">Start<small>resumes from saved tokens</small></button>
<button class="danger" data-a="stop">Stop<small>pull the plug</small></button>
</div></section>
<section class="plug"><h2>Pull-the-plug beat (Q&amp;A)</h2><div class="grid">
<button class="danger" data-a="stop">1 · Stop<small>console shows SERVER DOWN</small></button>
<button data-a="publish_direct">2 · Write a lesson while down<small>another server writes to Atlas</small></button>
<button class="primary" data-a="start">3 · Start<small>every home catches up</small></button>
</div></section>
<section><h2>Prep</h2><div class="grid">
<button data-a="health">Health check<small>homes · memory sync · kids' rule</small></button>
<button data-a="warm">Warm voices<small>robot lines play instantly</small></button>
<button data-a="selftest">Full self-test, then reset<small>22 checks · ~2 min · not mid-demo</small></button>
</div></section>
<section><h2>Open</h2><div class="grid">
<button data-a="open_console">Console<small>localhost:${DEMO_PORT} in Chrome</small></button>
<button data-a="open_pitch">Pitch page<small>script, Q&amp;A, submit kit</small></button>
</div></section>
<div id="note" class="note"></div>
<pre id="log"></pre>
</div>
<script>
const st=document.getElementById('st'),busyEl=document.getElementById('busy'),note=document.getElementById('note'),logEl=document.getElementById('log');
async function refresh(){try{const s=await (await fetch('/status')).json();st.textContent=s.up?'SERVER UP':'SERVER DOWN';st.className='status '+(s.up?'up':'down');busyEl.textContent=s.busy?('working: '+s.busy+'…'):'';document.querySelectorAll('button').forEach(b=>b.disabled=!!s.busy);const atBottom=logEl.scrollTop+logEl.clientHeight>=logEl.scrollHeight-8;logEl.textContent=s.logs.join('\\n');if(atBottom)logEl.scrollTop=logEl.scrollHeight;if(s.last&&s.last.action)note.textContent=(s.last.ok===false?'✗ ':'✓ ')+s.last.label+(s.last.note?' · '+s.last.note:'');}catch(e){st.textContent='control panel offline';st.className='status down';}}
document.querySelectorAll('button[data-a]').forEach(b=>b.addEventListener('click',async()=>{note.textContent='';await fetch('/action/'+b.dataset.a,{method:'POST'});refresh();}));
setInterval(refresh,800);refresh();
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return res.end(PAGE); }
  if (req.method === 'GET' && req.url === '/status') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ up: await up(), busy, last, logs: logs.slice(-120) }));
  }
  const m = req.method === 'POST' && req.url.match(/^\/action\/([a-z_]+)$/);
  if (m && ACTIONS[m[1]]) {
    if (busy) { res.writeHead(409); return res.end('busy'); }
    const a = ACTIONS[m[1]];
    busy = a.label;
    res.writeHead(202); res.end('ok');
    try { const note = await a.run(); last = { action: m[1], label: a.label, ok: true, at: Date.now(), note: typeof note === 'string' ? note : '' }; }
    catch (e) { log(`✗ ${e.message}`); last = { action: m[1], label: a.label, ok: false, at: Date.now(), note: e.message }; }
    finally { busy = null; }
    return;
  }
  res.writeHead(404); res.end();
});
server.listen(CONTROL_PORT, '127.0.0.1', () => { log(`control panel on http://localhost:${CONTROL_PORT} (demo server port ${DEMO_PORT})`); console.log(`One Lesson control panel: http://localhost:${CONTROL_PORT}`); });
process.on('SIGINT', () => process.exit(0));
