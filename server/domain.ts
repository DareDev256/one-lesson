// Pure domain rules for One Lesson. No database, no network: everything here is
// deterministic so the safety story can never be surprised by a model.

export type ObjectType = 'plate' | 'cup' | 'bowl' | 'knife' | 'scissors' | 'pan' | 'cleaner';
export type TargetType = 'dishwasher' | 'sink' | 'high_cabinet' | 'low_drawer' | 'floor_bin';

export type Step =
  | { action: 'pick'; objectType: ObjectType }
  | { action: 'place'; targetType: TargetType };

export const OBJECT_TAGS: Record<ObjectType, string[]> = {
  plate: [],
  cup: [],
  bowl: [],
  knife: ['sharp'],
  scissors: ['sharp'],
  pan: ['heat'],
  cleaner: ['chemical'],
};

export const TARGET_TAGS: Record<TargetType, string[]> = {
  dishwasher: [],
  sink: [],
  high_cabinet: [],
  low_drawer: ['child-reach'],
  floor_bin: ['child-reach'],
};

export const OBJECT_TYPES = Object.keys(OBJECT_TAGS) as ObjectType[];
export const TARGET_TYPES = Object.keys(TARGET_TAGS) as TargetType[];

/** Tags are the union of every step's tags, plus `sharp+child-reach` when a sharp
 *  item is placed at a child-reach target. Deterministic by design. */
export function computeTags(steps: Step[]): string[] {
  const tags = new Set<string>();
  let holding: ObjectType | null = null;
  for (const s of steps) {
    if (s.action === 'pick') {
      holding = s.objectType;
      OBJECT_TAGS[s.objectType]?.forEach((t) => tags.add(t));
    } else {
      TARGET_TAGS[s.targetType]?.forEach((t) => tags.add(t));
      if (holding && OBJECT_TAGS[holding]?.includes('sharp') && TARGET_TAGS[s.targetType]?.includes('child-reach')) {
        tags.add('sharp+child-reach');
      }
      holding = null;
    }
  }
  return [...tags].sort();
}

/** The rule a home applies before it accepts a lesson. Returns the blocking tag, or null. */
export function blockingRule(lessonTags: string[], blockedTags: string[]): string | null {
  return blockedTags.find((t) => lessonTags.includes(t)) ?? null;
}

export function validateSteps(steps: unknown): Step[] {
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > 24) throw new Error('steps must be 1 to 24 items');
  return steps.map((s: any) => {
    if (s?.action === 'pick' && OBJECT_TYPES.includes(s.objectType)) return { action: 'pick', objectType: s.objectType };
    if (s?.action === 'place' && TARGET_TYPES.includes(s.targetType)) return { action: 'place', targetType: s.targetType };
    throw new Error(`bad step: ${JSON.stringify(s)}`);
  });
}

const CATEGORY: Record<ObjectType, string> = {
  plate: 'dishes', cup: 'dishes', bowl: 'dishes', knife: 'sharp tools', scissors: 'sharp tools', pan: 'cookware', cleaner: 'cleaning chemicals',
};

/** The text Atlas embeds and reranks: the skill name plus what it moves where, in household words.
 *  Measured (scripts/probe-texts.ts, probe-rerank.ts): this form separates "put the dishes away" cleanly under rerank-3. */
export function lessonText(title: string, steps: Step[]): string {
  const moves: { category: string; target: string; objects: string[] }[] = [];
  let holding: ObjectType | null = null;
  for (const s of steps) {
    if (s.action === 'pick') { holding = s.objectType; continue; }
    if (!holding) continue;
    const category = CATEGORY[holding];
    const target = s.targetType.replace('_', ' ');
    const last = moves[moves.length - 1];
    if (last && last.category === category && last.target === target) { if (!last.objects.includes(holding)) last.objects.push(holding); }
    else moves.push({ category, target, objects: [holding] });
    holding = null;
  }
  return `${title}. ${moves.map((m) => `Moves ${m.category} (${m.objects.join(', ')}) into the ${m.target}.`).join(' ')}`.trim();
}

export function describeSteps(steps: Step[]): string {
  return steps
    .map((s) => (s.action === 'pick' ? `pick the ${s.objectType}` : `place it in the ${s.targetType.replace('_', ' ')}`))
    .join(', ');
}

// ---------------------------------------------------------------- homes

export interface LayoutObject { id: string; type: ObjectType | TargetType; x: number; y: number }

export interface HomeSeed {
  _id: string;
  name: string;
  hood: string;
  hasKids: boolean;
  blockedTags: string[];
  // Map position on the Toronto console (0..1 of the map box).
  mapX: number;
  mapY: number;
}

export const HOMES: HomeSeed[] = [
  { _id: 'home-1', name: 'Home 1', hood: 'Downtown', hasKids: false, blockedTags: [], mapX: 0.45, mapY: 0.74 },
  { _id: 'home-2', name: 'Home 2', hood: 'Etobicoke', hasKids: false, blockedTags: [], mapX: 0.13, mapY: 0.56 },
  { _id: 'home-3', name: 'Home 3', hood: 'North York', hasKids: false, blockedTags: [], mapX: 0.4, mapY: 0.3 },
  { _id: 'home-4', name: 'Home 4', hood: 'Scarborough', hasKids: false, blockedTags: [], mapX: 0.83, mapY: 0.3 },
  { _id: 'home-5', name: 'Home 5', hood: 'East York', hasKids: true, blockedTags: ['sharp+child-reach', 'chemical'], mapX: 0.66, mapY: 0.44 },
  { _id: 'home-6', name: 'Home 6', hood: 'Leslieville', hasKids: true, blockedTags: ['sharp+child-reach', 'chemical'], mapX: 0.8, mapY: 0.7 },
];

// Small seeded PRNG so every home gets its own kitchen, the same one every reset.
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const GRID_W = 12;
export const GRID_H = 8;

/** A 12 by 8 kitchen: targets along the walls, objects on the counter area, robot dock fixed. */
export function generateLayout(homeIndex: number): LayoutObject[] {
  const rnd = mulberry32(1000 + homeIndex * 7919);
  const taken = new Set<string>(['1,6']); // robot dock
  const pick = (cells: [number, number][]) => {
    const free = cells.filter(([x, y]) => !taken.has(`${x},${y}`));
    const [x, y] = free[Math.floor(rnd() * free.length)];
    taken.add(`${x},${y}`);
    return { x, y };
  };
  // Walls mean something: cabinets and the sink line the top wall (up high), drawers and the bin sit on the
  // bottom wall (down low), so "knife goes low" and "knife goes high" are visible as the robot walks down or up.
  const top: [number, number][] = [];
  const bottom: [number, number][] = [];
  for (let x = 2; x < GRID_W - 1; x++) { top.push([x, 0]); bottom.push([x, GRID_H - 1]); }
  const floor: [number, number][] = [];
  for (let x = 2; x < GRID_W - 2; x++) for (let y = 2; y < GRID_H - 2; y++) floor.push([x, y]);
  const WALL: Record<TargetType, [number, number][]> = { high_cabinet: top, sink: top, dishwasher: top, low_drawer: bottom, floor_bin: bottom };

  const out: LayoutObject[] = [];
  for (const t of TARGET_TYPES) out.push({ id: t, type: t, ...pick(WALL[t]) });
  for (const o of OBJECT_TYPES) out.push({ id: o, type: o, ...pick(floor) });
  return out;
}

export const ROBOT_DOCK = { x: 1, y: 6 };

/** Adapt a lesson to one home's kitchen: resolve every step to a grid cell. */
export function adaptToLayout(steps: Step[], layout: LayoutObject[]) {
  return steps.map((s) => {
    const type = s.action === 'pick' ? s.objectType : s.targetType;
    const obj = layout.find((o) => o.type === type);
    if (!obj) throw new Error(`no ${type} in this kitchen`);
    return { ...s, x: obj.x, y: obj.y };
  });
}

/** Manhattan path length, used to give each simulated run a real duration. */
export function pathLength(points: { x: number; y: number }[]) {
  let len = 0;
  let cur = ROBOT_DOCK;
  for (const p of points) { len += Math.abs(p.x - cur.x) + Math.abs(p.y - cur.y); cur = p; }
  return len + Math.abs(ROBOT_DOCK.x - cur.x) + Math.abs(ROBOT_DOCK.y - cur.y);
}

// ---------------------------------------------------------------- speech → lesson (deterministic)

const OBJECT_WORDS: Record<string, ObjectType[]> = {
  plate: ['plate'], plates: ['plate'], dish: ['plate'], dishes: ['plate', 'cup', 'bowl'],
  cup: ['cup'], cups: ['cup'], mug: ['cup'], mugs: ['cup'], glass: ['cup'], glasses: ['cup'],
  bowl: ['bowl'], bowls: ['bowl'],
  knife: ['knife'], knives: ['knife'], scissors: ['scissors'],
  pan: ['pan'], pans: ['pan'], pot: ['pan'], pots: ['pan'],
  cleaner: ['cleaner'], bleach: ['cleaner'], spray: ['cleaner'], soap: ['cleaner'], detergent: ['cleaner'],
};
// Multi-word targets are matched before single words.
const TARGET_PHRASES: [string, TargetType][] = [
  ['high cabinet', 'high_cabinet'], ['top cabinet', 'high_cabinet'], ['upper cabinet', 'high_cabinet'], ['top shelf', 'high_cabinet'], ['high shelf', 'high_cabinet'],
  ['low drawer', 'low_drawer'], ['bottom drawer', 'low_drawer'], ['lower drawer', 'low_drawer'], ['low cabinet', 'low_drawer'], ['bottom cabinet', 'low_drawer'],
  ['floor bin', 'floor_bin'], ['recycling bin', 'floor_bin'],
  ['dishwasher', 'dishwasher'], ['sink', 'sink'], ['cupboard', 'high_cabinet'], ['cabinet', 'high_cabinet'], ['drawer', 'low_drawer'],
  ['bin', 'floor_bin'], ['trash', 'floor_bin'], ['garbage', 'floor_bin'],
];

/** Turn a spoken lesson into steps. "Kitchen tidy. Put the knife and the scissors in the bottom drawer."
 *  → title "kitchen tidy", pick knife → low drawer, pick scissors → low drawer. Objects wait for the next
 *  place they are told to go. Words it does not know are ignored and reported. */
export function parseSpokenLesson(transcript: string): { title: string | null; steps: Step[]; leftover: string[] } {
  const sentences = transcript.split(/[.!?\n]+/).map((x) => x.trim()).filter(Boolean);
  // A short first sentence that names no object is the skill's name ("Kitchen tidy.", "Load the dishwasher.").
  const hasObject = (t: string) => t.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).some((w) => OBJECT_WORDS[w]);
  let title: string | null = null;
  const named = transcript.match(/(?:this is called|call it|it'?s called|lesson(?: is)?|skill(?: is)?)[:\s]+([a-z\s']{3,40}?)(?:[.!?,]|$)/i);
  if (named) title = named[1].trim().toLowerCase();
  else if (sentences.length > 1 && !hasObject(sentences[0]) && sentences[0].split(/\s+/).length <= 5) title = sentences[0].toLowerCase();

  const body = sentences.filter((x) => !(title && x.toLowerCase() === title)).join(' ').toLowerCase().replace(/[^a-z\s]/g, ' ');
  const words = body.split(/\s+/).filter(Boolean);
  const steps: Step[] = [];
  let pending: ObjectType[] = [];
  const leftover: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const two = `${words[i]} ${words[i + 1] ?? ''}`;
    const phrase = TARGET_PHRASES.find(([p]) => (p.includes(' ') ? two === p : words[i] === p));
    if (phrase) {
      for (const o of pending) steps.push({ action: 'pick', objectType: o }, { action: 'place', targetType: phrase[1] });
      pending = [];
      if (phrase[0].includes(' ')) i++;
      continue;
    }
    const objs = OBJECT_WORDS[words[i]];
    if (objs) { for (const o of objs) if (!pending.includes(o)) pending.push(o); continue; }
  }
  for (const o of pending) leftover.push(o);
  return { title, steps, leftover };
}

// ---------------------------------------------------------------- languages (Ask only; teaching stays English)

export type Lang = 'en' | 'fr' | 'es' | 'zh';
export const LANGS: Lang[] = ['en', 'fr', 'es', 'zh'];
const ISO3: Record<string, Lang> = { eng: 'en', en: 'en', fra: 'fr', fr: 'fr', spa: 'es', es: 'es', zho: 'zh', cmn: 'zh', yue: 'zh', zh: 'zh' };
const FR = /\b(les|des|dans|mets|range|ranger|fais|cuisine|vaisselle|couteaux?|ciseaux|assiettes?|qui t'a|lave-vaisselle|s'il te pla[iî]t)\b/i;
const ES = /\b(los|las|platos|cocina|recoge|guarda|ordena|cuchillos?|tijeras|lavavajillas|qui[eé]n te)\b/i;

/** Shipped languages only: measured with scripts/probe-multilingual.ts (fr, es, zh pass; ta, hi did not and are not offered).
 *  Trust the speech model's language when it is confident and allowed; otherwise decide from the words; default English. */
export function detectLang(text: string, hint?: { code?: string | null; probability?: number | null } | string | null): Lang {
  if (typeof hint === 'string' && LANGS.includes(hint as Lang)) return hint as Lang;
  if (hint && typeof hint === 'object' && hint.code && (hint.probability ?? 0) >= 0.6 && ISO3[hint.code]) return ISO3[hint.code];
  if (/[一-鿿]/.test(text)) return 'zh';
  if (FR.test(text)) return 'fr';
  if (ES.test(text)) return 'es';
  return 'en';
}

/** "Who taught you that?" in the shipped languages. */
export const PROVENANCE_ASK = /(who taught (you|that|this)|where did you learn|qui t'a appris|qui vous a appris|qui(é|e)n te (lo )?ense(ñ|n)(ó|o)|谁教(你|的))/i;
