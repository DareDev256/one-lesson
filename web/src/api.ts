export type Step = { action: 'pick'; objectType: string } | { action: 'place'; targetType: string };

export interface Home {
  _id: string; name: string; hood: string; hasKids: boolean; blockedTags: string[];
  mapX: number; mapY: number; layout: { id: string; type: string; x: number; y: number }[];
  online: boolean; activeLessons: Record<string, string>;
}
export interface Lesson {
  _id: string; skillKey: string; version: number; title: string; steps: Step[]; tags: string[];
  teacherId: string; teacherName: string; teacherVerified: boolean; parentId: string | null;
  status: 'trial' | 'proven' | 'rolled_back' | 'forgotten'; createdAt: string; provenRuns: number;
}
export interface FleetEvent {
  type: string; lessonId?: string; homeId?: string; teacherId?: string; rule?: string; detail?: any; at: string;
}
export interface Scoreboard {
  invariant: { kidsHomeViolations: number };
  ripple: { lessonId: string; delivered: number; refused: number; homesHeard: number; ms: number | null } | null;
  lastRollback: { homes: number; ms: number | null } | null;
  refusals: { kidHomes: number; otherHomes: number };
  homesOnline: number; homesTotal: number; homesKnowing: number; caughtUp: number;
  memory: { homesInSync: number; outOfSync: number };
  runs: { ok: number; failed: number }; lessons: Record<string, number>;
}

let token: string | null = null;
let typedName: string | null = null;
export function setIdentity(t: { token?: string | null; name?: string | null }) {
  token = t.token ?? null;
  typedName = t.name ?? null;
}

export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  else if (typedName) headers['x-teacher-name'] = typedName;
  const res = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
  return j as T;
}

export const OBJECTS = ['plate', 'cup', 'bowl', 'knife', 'scissors', 'pan', 'cleaner'];
export const TARGETS = ['dishwasher', 'sink', 'high_cabinet', 'low_drawer', 'floor_bin'];
export const label = (t: string) => t.replace('_', ' ');
