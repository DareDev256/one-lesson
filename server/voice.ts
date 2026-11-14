// Each robot speaks with its own ElevenLabs voice. Lines are cached on disk by hash, so a
// rehearsal pays for each line once and the stage demo plays from cache.
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const KEY = process.env.ELEVENLABS_API_KEY;
const MODEL = process.env.ELEVENLABS_MODEL ?? 'eleven_flash_v2_5';
const CACHE = path.resolve('.state/voice');
const MAX_NEW_PER_RUN = Number(process.env.VOICE_MAX_NEW ?? 300);
let generated = 0;

// ElevenLabs premade voices, one per home.
export const HOME_VOICES: Record<string, { id: string; name: string }> = {
  'home-1': { id: 'iP95p4xoKVk53GoZ742B', name: 'Chris' },
  'home-2': { id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica' },
  'home-3': { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie' },
  'home-4': { id: '2vbhUP8zyKg4dEZaTWGn', name: 'Stella' },
  'home-5': { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice' },
  'home-6': { id: 'nPczCjzI2devNBz1zQrb', name: 'Brian' },
};

export const voiceEnabled = () => !!KEY;

export async function say(homeId: string, text: string, lang = 'en'): Promise<Buffer> {
  const voice = HOME_VOICES[homeId];
  if (!voice) throw Object.assign(new Error('unknown home'), { status: 400 });
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, 140);
  if (!clean) throw Object.assign(new Error('empty line'), { status: 400 });
  mkdirSync(CACHE, { recursive: true });
  const tag = lang === 'en' ? '' : `|${lang}`;
  const file = path.join(CACHE, createHash('sha256').update(`${MODEL}|${voice.id}|${clean}${tag}`).digest('hex').slice(0, 24) + '.mp3');
  if (existsSync(file)) {
    if (!readIndex()[path.basename(file)]) indexLine(path.basename(file), clean);
    return readFileSync(file);
  }
  if (!KEY) throw Object.assign(new Error('no ELEVENLABS_API_KEY'), { status: 503 });
  if (generated >= MAX_NEW_PER_RUN) throw Object.assign(new Error('voice cap reached for this run'), { status: 429 });
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice.id}?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text: clean, model_id: MODEL, ...(lang !== 'en' ? { language_code: lang } : {}), voice_settings: { stability: 0.45, similarity_boost: 0.8, speed: 1.08 } }),
  });
  if (!res.ok) throw Object.assign(new Error(`elevenlabs ${res.status}: ${(await res.text()).slice(0, 160)}`), { status: 502 });
  const buf = Buffer.from(await res.arrayBuffer());
  generated++;
  writeFileSync(file, buf);
  indexLine(path.basename(file), clean);
  return buf;
}

// The cache keeps an index of what each file says, so a forgotten teacher's name can be purged from audio too.
const INDEX = () => path.join(CACHE, 'index.json');
function readIndex(): Record<string, string> {
  try { return JSON.parse(readFileSync(INDEX(), 'utf8')); } catch { return {}; }
}
function indexLine(file: string, text: string) {
  const idx = readIndex(); idx[file] = text; writeFileSync(INDEX(), JSON.stringify(idx));
}
/** Delete every cached line that says this name. Returns how many files went. */
export function purgeVoiceLines(name: string): number {
  if (!name) return 0;
  const idx = readIndex();
  const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  let n = 0;
  for (const [file, text] of Object.entries(idx)) {
    if (!re.test(text)) continue;
    try { unlinkSync(path.join(CACHE, file)); } catch {}
    delete idx[file]; n++;
  }
  writeFileSync(INDEX(), JSON.stringify(idx));
  return n;
}

/** What each robot says. Kept short so it lands while the face is still lit. */
export function lineFor(kind: 'unknown' | 'ran' | 'refused' | 'reverted' | 'blocked-ask', d: { title?: string; version?: number; teacher?: string; knife?: string | null; rule?: string }) {
  switch (kind) {
    case 'unknown': return "I don't know how to do that yet.";
    case 'ran': return `${d.title}, version ${d.version}, from ${d.teacher}.${d.knife ? ` Knife goes ${d.knife}.` : ''}`;
    case 'refused': return 'Refused. There are kids in this house.';
    case 'blocked-ask': return "I won't do that here. There are kids in this house.";
    case 'reverted': return `Rolled back to version ${d.version}.`;
  }
}

// ElevenLabs Speech-to-Text (Scribe) for teaching and asking by voice.
const STT_MODEL = process.env.ELEVENLABS_STT_MODEL ?? 'scribe_v2';
const MAX_HEAR_PER_RUN = Number(process.env.HEAR_MAX ?? 150);
let heard = 0;

export async function hear(audio: Buffer, mime: string, mode: 'ask' | 'teach' = 'teach'): Promise<{ text: string; code: string | null; probability: number | null }> {
  if (!KEY) throw Object.assign(new Error('no ELEVENLABS_API_KEY'), { status: 503 });
  if (heard >= MAX_HEAR_PER_RUN) throw Object.assign(new Error('speech cap reached for this run'), { status: 429 });
  if (audio.length < 800) throw Object.assign(new Error('no audio'), { status: 400 });
  heard++;
  const form = new FormData();
  form.append('model_id', STT_MODEL);
  if (mode === 'teach') form.append('language_code', 'en');
  form.append('tag_audio_events', 'false');
  form.append('file', new Blob([new Uint8Array(audio)], { type: mime || 'audio/webm' }), 'speech.webm');
  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': KEY }, body: form });
  if (!res.ok) throw Object.assign(new Error(`elevenlabs stt ${res.status}: ${(await res.text()).slice(0, 160)}`), { status: 502 });
  const j: any = await res.json();
  // Sounds are not words: drop audio-event tags like [click] or [background noise] so they never become a question.
  const text = String(j.text ?? '').replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  return { text, code: j.language_code ?? null, probability: j.language_probability ?? null };
}
