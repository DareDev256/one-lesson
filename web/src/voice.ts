// Robots speak through the server's ElevenLabs endpoint. One queue so lines never talk over each other.
let enabled = true;
export const setVoice = (on: boolean) => { enabled = on; };
let chain: Promise<void> = Promise.resolve();

export type Lang = 'en' | 'fr' | 'es' | 'zh';
const url = (homeId: string, text: string, lang: Lang) => `/api/say?home=${encodeURIComponent(homeId)}&text=${encodeURIComponent(text)}&lang=${lang}`;

export function speak(homeId: string, text: string, lang: Lang = 'en') {
  if (!enabled) return;
  chain = chain.then(() => new Promise<void>((resolve) => {
    const a = new Audio(url(homeId, text, lang));
    const done = () => resolve();
    a.onended = done; a.onerror = done;
    a.play().catch(done);
    setTimeout(done, 8000);
  }));
}

export function prefetch(homeId: string, text: string, lang: Lang = 'en') {
  fetch(url(homeId, text, lang)).catch(() => {});
}

type Knife = 'low' | 'high' | '';
export interface Provenance {
  lesson: { title: string; version: number; teacherName: string; status: string };
  parents: { title: string; version: number; teacherName: string }[];
  took: number; refused: number;
}
const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

export const LINES: Record<Lang, {
  unknown: string; blockedAsk: string; refused: string;
  ran: (title: string, v: number, teacher: string, knife: Knife) => string;
  reverted: (v: number | null) => string;
  provenance: (p: Provenance | null) => string;
}> = {
  en: {
    unknown: "I don't know how to do that yet.",
    blockedAsk: "I won't do that here. There are kids in this house.",
    refused: 'Refused. There are kids in this house.',
    ran: (t, v, who, k) => `${t}, version ${v}, from ${who}.${k ? ` Knife goes ${k}.` : ''}`,
    reverted: (v) => (v ? `Rolled back to version ${v}.` : 'Forgotten.'),
    provenance: (p) => !p ? "I haven't done anything yet." :
      `${p.lesson.teacherName} taught me this. ${p.lesson.title}, version ${p.lesson.version}${p.parents[0] ? `, built on ${p.parents[0].teacherName}'s version ${p.parents[0].version}` : ''}. ${n(p.took, 'home', 'homes')} took it. ${p.refused} refused.${p.lesson.status === 'rolled_back' ? ' It has since been rolled back.' : ''}`,
  },
  fr: {
    unknown: 'Je ne sais pas encore faire ça.',
    blockedAsk: 'Je ne ferai pas ça ici. Il y a des enfants dans cette maison.',
    refused: 'Refusé. Il y a des enfants dans cette maison.',
    ran: (t, v, who, k) => `${t}, version ${v}, appris de ${who}.${k === 'low' ? ' Le couteau va en bas.' : k === 'high' ? ' Le couteau va en haut.' : ''}`,
    reverted: (v) => (v ? `Retour à la version ${v}.` : 'Oublié.'),
    provenance: (p) => !p ? "Je n'ai encore rien fait." :
      `${p.lesson.teacherName} m'a appris ça. ${p.lesson.title}, version ${p.lesson.version}${p.parents[0] ? `, basée sur la version ${p.parents[0].version} de ${p.parents[0].teacherName}` : ''}. ${p.took} maisons l'ont prise, ${p.refused} l'ont refusée.`,
  },
  es: {
    unknown: 'Todavía no sé hacer eso.',
    blockedAsk: 'Aquí no lo haré. En esta casa hay niños.',
    refused: 'Rechazado. En esta casa hay niños.',
    ran: (t, v, who, k) => `${t}, versión ${v}, de ${who}.${k === 'low' ? ' El cuchillo va abajo.' : k === 'high' ? ' El cuchillo va arriba.' : ''}`,
    reverted: (v) => (v ? `De vuelta a la versión ${v}.` : 'Olvidado.'),
    provenance: (p) => !p ? 'Todavía no he hecho nada.' :
      `${p.lesson.teacherName} me enseñó esto. ${p.lesson.title}, versión ${p.lesson.version}${p.parents[0] ? `, basada en la versión ${p.parents[0].version} de ${p.parents[0].teacherName}` : ''}. ${p.took} casas la aceptaron, ${p.refused} la rechazaron.`,
  },
  zh: {
    unknown: '我还不会做这个。',
    blockedAsk: '这里我不会做。这个家里有孩子。',
    refused: '拒绝。这个家里有孩子。',
    ran: (t, v, who, k) => `${t}，第${v}版，${who}教的。${k === 'low' ? '刀放在下面。' : k === 'high' ? '刀放在上面。' : ''}`,
    reverted: (v) => (v ? `已回到第${v}版。` : '已忘记。'),
    provenance: (p) => !p ? '我还什么都没做。' :
      `这是${p.lesson.teacherName}教我的：${p.lesson.title}，第${p.lesson.version}版${p.parents[0] ? `，基于${p.parents[0].teacherName}的第${p.parents[0].version}版` : ''}。${p.took}个家接受了，${p.refused}个拒绝了。`,
  },
};
