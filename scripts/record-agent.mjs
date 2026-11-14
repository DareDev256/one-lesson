// Records the "talk to Home 5" moment against the QA server: a simulated mic asks the question, the live
// ElevenLabs agent answers, and its real output audio chunks are captured with timestamps for the mix.
// Usage: BASE=http://localhost:8790 WAV=.state/video/agentq.wav OUT=.state/video/agent node scripts/record-agent.mjs
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const B = process.env.BASE ?? 'http://localhost:8790';
const OUT = path.resolve(process.env.OUT ?? '.state/video/agent');
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PW_EXEC,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${path.resolve(process.env.WAV)}`, '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } }, permissions: ['microphone'] });
const page = await ctx.newPage();
await page.goto(B + '/', { waitUntil: 'networkidle' });
await page.evaluate(() => { window.__agentAudio = []; window.__t0 = performance.now(); });
await page.waitForTimeout(1200);
const tOpen = await page.evaluate(() => performance.now() - window.__t0);
await page.keyboard.press('c');
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(1000);
  const lines = await page.$$eval('.agent-line', (els) => els.map((e) => e.textContent));
  if (lines.some((l) => l.startsWith('⚙')) && lines.filter((l) => l.startsWith('Home 5:')).length >= 2) break;
}
await page.waitForTimeout(6000);
const data = await page.evaluate(() => ({ audio: window.__agentAudio, meta: window.__agentMeta ?? null, t0: window.__t0, lines: [...document.querySelectorAll('.agent-line')].map((e) => e.textContent) }));
await page.keyboard.press('c');
await page.waitForTimeout(800);
await ctx.close(); await browser.close();
const vid = readdirSync(OUT).filter((f) => f.endsWith('.webm') && f !== 'agent.webm').map((f) => path.join(OUT, f)).pop();
renameSync(vid, path.join(OUT, 'agent.webm'));
writeFileSync(path.join(OUT, 'agent-audio.json'), JSON.stringify({ tOpen, t0: data.t0, meta: data.meta, chunks: data.audio.map((c) => ({ t: c.t - data.t0, b64: c.b64 })) }));
console.log(`agent clip saved; ${data.audio.length} audio chunks; meta format: ${JSON.stringify(data.meta?.agent_output_audio_format ?? data.meta)?.slice(0, 120)}`);
console.log(data.lines.join('\n'));
