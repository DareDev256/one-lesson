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
  { _id: 'home-4', name: 'Home 4', hood: 'Scarborough', hasKids: false, blockedTags: [], mapX: 0.87, mapY: 0.3 },
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
  const wall: [number, number][] = [];
  for (let x = 0; x < GRID_W; x++) { wall.push([x, 0]); wall.push([x, GRID_H - 1]); }
  for (let y = 1; y < GRID_H - 1; y++) { wall.push([0, y]); wall.push([GRID_W - 1, y]); }
  const floor: [number, number][] = [];
  for (let x = 2; x < GRID_W - 2; x++) for (let y = 2; y < GRID_H - 2; y++) floor.push([x, y]);

  const out: LayoutObject[] = [];
  for (const t of TARGET_TYPES) out.push({ id: t, type: t, ...pick(wall) });
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
