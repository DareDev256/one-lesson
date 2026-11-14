// Records the demo end to end in a real browser against the real server and writes a cue sheet
// (what each robot said, and when) so the audio can be laid back over the silent recording.
// Alex's lesson is spoken into a simulated microphone (Chromium fake capture) and goes through
// ElevenLabs Scribe like a live mic would.
// Usage: node scripts/record-demo.mjs  (expects PW_EXEC for a local Chromium; restarts the server itself)
import { chromium } from 'playwright';
import { execSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readdirSync, renameSync } from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('.state/video');
mkdirSync(OUT, { recursive: true });
const B = 'http://localhost:8787';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  const p = spawn('npx', ['tsx', 'server/index.ts'], { stdio: 'ignore', detached: true });
  p.unref();
}
async function waitUp() {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(B + '/api/config')).ok) return; } catch {} await sleep(250); }
  throw new Error('server did not come up');
}
const killServer = () => { try { execSync('pkill -f "tsx server/index.ts"'); } catch {} };

killServer(); await sleep(800);
execSync('npx tsx scripts/demo-reset.ts', { stdio: 'inherit' });
startServer(); await waitUp();

const browser = await chromium.launch({
  executablePath: process.env.PW_EXEC,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${path.join(OUT, 'alex.wav')}`, '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } }, permissions: ['microphone'] });
const page = await ctx.newPage();
const t0 = Date.now();
const cues = [];
const cue = (kind, data = {}) => cues.push({ t: (Date.now() - t0) / 1000, kind, ...data });

// Capture what the robots say: the console requests /api/say for every spoken line.
page.on('request', (req) => {
  const u = new URL(req.url());
  if (u.pathname === '/api/say') cue('say', { home: u.searchParams.get('home'), text: u.searchParams.get('text') });
});

await page.goto(B + '/', { waitUntil: 'networkidle' });
await sleep(1500);
cue('scene', { name: 'before' });

const ask = async (homeLabel, text) => {
  await page.getByRole('button', { name: homeLabel, exact: true }).click();
  await page.locator('.askbar input').fill(text);
  await page.locator('.askbar button.primary').click();
  await page.waitForFunction(() => !document.querySelector('.askbar button.primary')?.hasAttribute('disabled'), null, { timeout: 15000 });
};

await ask('H2', 'put the dishes away');
await sleep(2600);

cue('scene', { name: 'teach' });
await page.keyboard.press('Shift+!');
await sleep(3200);
await ask('H2', 'put the dishes away');
await sleep(3000);

cue('scene', { name: 'voice-teach' });
await page.keyboard.press('t');
await sleep(600);
await page.locator('.drawer-head button', { hasText: 'Alex' }).click();
await sleep(400);
await page.keyboard.down('v');
cue('mic', { on: true });
await sleep(5600);
await page.keyboard.up('v');
cue('mic', { on: false });
await page.waitForSelector('.heard', { timeout: 20000 });
await sleep(1500);
await page.locator('.drawer button.primary', { hasText: 'Teach the fleet' }).click();
cue('scene', { name: 'bad-lesson' });
await sleep(3800);
await page.keyboard.press('Escape');

cue('scene', { name: 'same-words' });
await ask('H2', 'tidy the kitchen');
await sleep(3800);
await ask('H5·kids', 'tidy the kitchen');
await sleep(3800);

cue('scene', { name: 'rollback' });
await page.keyboard.press('l');
await sleep(1800);
await page.locator('.node', { hasText: 'kitchen tidy v2' }).locator('button.danger').click();
await sleep(3500);
await page.keyboard.press('Escape');
await ask('H2', 'tidy the kitchen');
await sleep(3500);

cue('scene', { name: 'pull-plug' });
killServer();
await sleep(2200);
execSync('npx tsx scripts/publish-direct.ts', { stdio: 'inherit' });
startServer(); await waitUp();
await sleep(4500);
cue('scene', { name: 'end' });
await sleep(1500);

await ctx.close();
await browser.close();
const vid = readdirSync(OUT).filter((f) => f.endsWith('.webm')).map((f) => path.join(OUT, f)).sort().pop();
renameSync(vid, path.join(OUT, 'raw.webm'));
writeFileSync(path.join(OUT, 'cues.json'), JSON.stringify(cues, null, 1));
console.log(`recorded ${((Date.now() - t0) / 1000).toFixed(1)} s, ${cues.length} cues → .state/video/raw.webm`);
