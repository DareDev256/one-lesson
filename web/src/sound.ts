// Tiny Web Audio cues: a hit when a home learns, a thud on a shield refusal, a reverse swoosh on rollback.
let ctx: AudioContext | null = null;
let enabled = true;
export const setSound = (on: boolean) => { enabled = on; };
function ac() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function hit(pitch = 1) {
  if (!enabled) return;
  const a = ac(); const t = a.currentTime;
  const o = a.createOscillator(); const g = a.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(880 * pitch, t);
  o.frequency.exponentialRampToValueAtTime(440 * pitch, t + 0.12);
  g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + 0.26);
}

export function thud() {
  if (!enabled) return;
  const a = ac(); const t = a.currentTime;
  const o = a.createOscillator(); const g = a.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.25);
  g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + 0.36);
}

export function swoosh() {
  if (!enabled) return;
  const a = ac(); const t = a.currentTime;
  const len = 0.5;
  const buf = a.createBuffer(1, a.sampleRate * len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (i / d.length);
  const src = a.createBufferSource(); src.buffer = buf;
  const f = a.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2;
  f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(3200, t + len);
  const g = a.createGain(); g.gain.setValueAtTime(0.35, t); g.gain.linearRampToValueAtTime(0, t + len);
  src.connect(f).connect(g).connect(a.destination); src.start(t);
}
