// Video v3: records the main beats against an ISOLATED QA server it starts and stops itself (never touches
// the presenter's server), then the live agent moment in a second session. Writes cue sheets for the mix.
// Usage: PW_EXEC=... node scripts/record-demo3.mjs
import { chromium } from 'playwright';
import { execSync, spawn } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PORT = 8791, DB = 'one_lesson_qa', B = `http://localhost:${PORT}`;
const OUT = path.resolve('.state/video/v3'); mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = { ...process.env, DB_NAME: DB, PORT: String(PORT) };
// Refuse to record if any other server is watching the same QA database: every event would be processed twice.
const others = execSync(`ps eww -A | grep "tsx server/index.ts" | grep "DB_NAME=${DB}" | grep -v grep || true`).toString().trim();
if (others) { console.error('another server is watching ' + DB + '; stop it first:\n' + others.slice(0, 300)); process.exit(1); }
execSync('npx tsx scripts/demo-reset.ts', { stdio: 'inherit', env });
const server = spawn('npx', ['tsx', 'server/index.ts'], { env, stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { if ((await fetch(B + '/api/config')).ok) break; } catch {} await sleep(250); }

async function session(name, wav, run) {
  const browser = await chromium.launch({ executablePath: process.env.PW_EXEC, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${path.resolve(wav)}`, '--autoplay-policy=no-user-gesture-required'] });
  const dir = path.join(OUT, name); mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir, size: { width: 1920, height: 1080 } }, permissions: ['microphone'] });
  const page = await ctx.newPage();
  const t0 = Date.now(); const cues = [];
  const cue = (kind, data = {}) => cues.push({ t: (Date.now() - t0) / 1000, kind, ...data });
  page.on('request', (req) => { const u = new URL(req.url()); if (u.pathname === '/api/say') cue('say', { home: u.searchParams.get('home'), text: u.searchParams.get('text'), lang: u.searchParams.get('lang') }); });
  await page.goto(B + '/', { waitUntil: 'networkidle' });
  await page.evaluate(() => { window.__agentAudio = []; window.__t0 = performance.now(); });
  const tPage = (Date.now() - t0) / 1000;
  await run(page, cue);
  const agent = await page.evaluate(() => ({ audio: (window.__agentAudio || []).map((c) => ({ t: c.t - window.__t0, b64: c.b64 })), meta: window.__agentMeta ?? null, lines: window.__agentLines ?? [] }));
  await ctx.close(); await browser.close();
  const vid = readdirSync(dir).filter((f) => f.endsWith('.webm')).map((f) => path.join(dir, f)).pop();
  renameSync(vid, path.join(dir, 'raw.webm'));
  writeFileSync(path.join(dir, 'cues.json'), JSON.stringify({ tPage, cues, agent }, null, 1));
  console.log(`${name}: ${((Date.now() - t0) / 1000).toFixed(1)} s, ${cues.length} cues, ${agent.audio.length} agent audio chunks`);
}

const ask = async (page, homeLabel, text) => {
  await page.getByRole('button', { name: homeLabel, exact: true }).click();
  await page.locator('.askbar input').fill(text);
  await page.locator('.askbar button.primary').click();
  await page.waitForFunction(() => !document.querySelector('.askbar button.primary')?.hasAttribute('disabled'), null, { timeout: 15000 });
};

await session('main', '.state/video/james.wav', async (page, cue) => {
  await sleep(1200); cue('scene', { name: 'before' });
  await ask(page, 'H2', 'put the dishes away'); await sleep(1700);
  cue('scene', { name: 'teach' });
  await page.keyboard.press('t'); await sleep(400);
  await page.locator('.drawer-head button', { hasText: 'James' }).click();
  await page.keyboard.down('v'); cue('mic', { on: true }); await sleep(5000); await page.keyboard.up('v');
  await page.waitForSelector('.heard', { timeout: 20000 }); await sleep(700);
  await page.locator('.drawer button.primary', { hasText: 'Teach the fleet' }).click();
  await sleep(1600); await page.keyboard.press('Escape');
  await ask(page, 'H2', 'put the dishes away'); await sleep(2600);
  cue('scene', { name: 'bad' });
  await page.keyboard.press('Shift+Digit2'); await sleep(5600);
  cue('scene', { name: 'split' });
  await page.keyboard.press('k'); await sleep(11000);
  await page.keyboard.press('Escape');
  cue('scene', { name: 'who' });
  await page.getByRole('button', { name: 'H2', exact: true }).click();
  await page.keyboard.press('Shift+Digit6'); await sleep(7600);
  cue('scene', { name: 'rollback' });
  await page.keyboard.press('l'); await sleep(1100);
  await page.locator('.node', { hasText: 'kitchen tidy v2' }).locator('button.danger').click();
  await sleep(2800); await page.keyboard.press('Escape'); await sleep(600);
  cue('scene', { name: 'end' });
});

await session('agent', '.state/video/agentq.wav', async (page, cue) => {
  await page.evaluate(() => {
    window.__agentLines = [];
    new MutationObserver(() => {
      const seen = new Set(window.__agentLines.map((l) => l.text));
      for (const e of document.querySelectorAll('.agent-line')) if (!seen.has(e.textContent)) window.__agentLines.push({ t: performance.now() - window.__t0, text: e.textContent });
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await sleep(800); cue('scene', { name: 'agent-open' });
  await page.keyboard.press('c');
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const lines = await page.$$eval('.agent-line', (els) => els.map((e) => e.textContent));
    if (lines.some((l) => l.startsWith('⚙')) && lines.filter((l) => l.startsWith('Home 5:')).length >= 2) break;
  }
  await sleep(5500); cue('scene', { name: 'agent-end' });
});

server.kill();
console.log('done');
