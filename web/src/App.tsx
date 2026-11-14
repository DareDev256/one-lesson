import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, label, setIdentity, type FleetEvent, type Home, type Lesson, type Step } from './api';
import { Face, type Mood } from './Face';
import { Kitchen } from './Kitchen';
import { hit, setSound, swoosh, thud } from './sound';
import { useFleet } from './useFleet';
import { LINES, setSpeakingListener, setVoice, speak, type Lang, type Provenance } from './voice';
import { Mic } from './Mic';
import { AgentPanel } from './Agent';

const MAP_W = 1280, MAP_H = 820;
const TRAVEL_MS = 450;
const ORIGIN: Record<string, string> = { James: 'home-1', Alex: 'home-3' };

type Pulse = { id: number; from: { x: number; y: number }; to: { x: number; y: number }; bad: boolean };
const HAZARD = 'sharp+child-reach';
// Each household's own language for the lines a robot says on its own (refusals, rollbacks).
// Answers to a question always follow the language of the question.
const HOME_LANG: Record<string, Lang> = { 'home-1': 'en', 'home-2': 'en', 'home-3': 'en', 'home-4': 'es', 'home-5': 'en', 'home-6': 'fr' };
type AskResult = { homeId: string; lang: Lang; answer: 'ran' | 'unknown' | 'provenance'; say: string; lesson?: { title: string; version: number; teacherName: string; tags: string[] }; run?: { ms: number; path: any[] }; matches: any[]; provenance?: Provenance | null };

const PRESETS: Record<string, { teacher: string; title: string; steps: Step[]; parent?: string }> = {
  '1': { teacher: 'James', title: 'load the dishwasher', steps: [{ action: 'pick', objectType: 'plate' }, { action: 'place', targetType: 'dishwasher' }, { action: 'pick', objectType: 'cup' }, { action: 'place', targetType: 'dishwasher' }] },
  '2': { teacher: 'Alex', title: 'kitchen tidy', steps: [{ action: 'pick', objectType: 'knife' }, { action: 'place', targetType: 'low_drawer' }, { action: 'pick', objectType: 'scissors' }, { action: 'place', targetType: 'low_drawer' }] },
  '3': { teacher: 'Alex', title: 'evening reset', parent: 'kitchen-tidy@v2', steps: [{ action: 'pick', objectType: 'pan' }, { action: 'place', targetType: 'sink' }, { action: 'pick', objectType: 'knife' }, { action: 'place', targetType: 'low_drawer' }] },
};

const where = (steps: Step[] | undefined) => {
  if (!steps) return '';
  for (let i = 0; i < steps.length - 1; i++) {
    const a = steps[i], b = steps[i + 1];
    if (a.action === 'pick' && a.objectType === 'knife' && b.action === 'place') return b.targetType === 'low_drawer' || b.targetType === 'floor_bin' ? 'knife goes LOW' : 'knife goes HIGH';
  }
  return '';
};

export default function App() {
  const [moods, setMoods] = useState<Record<string, { mood: Mood; until: number }>>({});
  const [bubbles, setBubbles] = useState<Record<string, { text: string; until: number }>>({});
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [caption, setCaption] = useState('Robots are starting to learn from people.');
  const [askHome, setAskHome] = useState('home-2');
  const [askText, setAskText] = useState('put the dishes away');
  const [askOut, setAskOut] = useState<AskResult | null>(null);
  const [asking, setAsking] = useState(false);
  const [teacher, setTeacher] = useState<'James' | 'Alex'>('James');
  const [teachHome, setTeachHome] = useState('home-1');
  const [draft, setDraft] = useState<Step[]>([]);
  const [held, setHeld] = useState<string | null>(null);
  const [title, setTitle] = useState('load the dishwasher');
  const [parentId, setParentId] = useState<string>('auto');
  const [panel, setPanel] = useState<'teach' | 'lineage' | null>(null);
  const [lineageOf, setLineageOf] = useState('kitchen-tidy@v1');
  const [tree, setTree] = useState<any>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<Record<string, { path: any[]; key: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [heard, setHeard] = useState<string | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  // The undo moment: a banner that names what was rolled back and fills in the measured homes and ms as reverts land.
  const [rb, setRb] = useState<{ ids: string[]; by: string; receipt: string; until: number } | null>(null);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [split, setSplit] = useState<{ text: string; runs: Record<string, AskResult | null>; key?: string } | null>(null);
  const [sound, setSoundOn] = useState(true);
  const pid = useRef(0);
  const homesRef = useRef<Home[]>([]);
  const lessonsRef = useRef<Lesson[]>([]);
  const originRef = useRef<Record<string, string>>({});
  const spokeRevert = useRef(false);
  const [focusHome, setFocusHome] = useState<{ id: string; until: number } | null>(null);
  const [speakingHome, setSpeakingHome] = useState<string | null>(null);
  const [chip, setChip] = useState<{ text: string; until: number } | null>(null);
  useEffect(() => setSpeakingListener(setSpeakingHome), []);

  useEffect(() => { setIdentity({ name: teacher }); }, [teacher]);
  // While the live agent talks, scripted robot voices stay quiet so they never talk over it.
  useEffect(() => { setSound(sound); setVoice(sound && !agentOpen); }, [sound, agentOpen]);

  const pos = (homeId: string) => {
    const h = homesRef.current.find((x) => x._id === homeId);
    return h ? { x: h.mapX * MAP_W, y: h.mapY * MAP_H } : { x: 0, y: 0 };
  };
  const flash = (homeId: string, mood: Mood, ms: number) => setMoods((m) => ({ ...m, [homeId]: { mood, until: Date.now() + ms } }));
  const say = (homeId: string, text: string, ms = 5000) => setBubbles((b) => ({ ...b, [homeId]: { text, until: Date.now() + ms } }));

  const onEvent = useCallback((e: FleetEvent) => {
    const d = e.detail ?? {};
    if (e.type === 'published') {
      originRef.current[e.lessonId!] = d.originHomeId ?? ORIGIN[d.teacherName] ?? 'home-1';
      setCaption(`${d.teacherName}${d.verified ? ' (verified)' : ''} published "${d.title}" v${d.version}${d.parentId ? `, built on ${d.parentId}` : ''}.`);
      const o = originRef.current[e.lessonId!];
      flash(o, 'happy', 1200);
    }
    if (e.type === 'delivered' || e.type === 'refused') {
      const origin = originRef.current[e.lessonId!] ?? 'home-1';
      const refused = e.type === 'refused';
      const hazardous = (d.tags ?? []).includes(HAZARD);
      if (e.homeId !== origin) {
        const id = ++pid.current;
        const from = pos(origin), to = pos(e.homeId!);
        // A refused lesson stops at the shield ring instead of reaching the face.
        const stop = refused ? (() => { const dx = to.x - from.x, dy = to.y - from.y, L = Math.hypot(dx, dy) || 1; return { x: to.x - (dx / L) * 62, y: to.y - (dy / L) * 62 }; })() : to;
        setPulses((p) => [...p, { id, from, to: stop, bad: refused || hazardous }]);
        setTimeout(() => setPulses((p) => p.filter((x) => x.id !== id)), TRAVEL_MS + 80);
      }
      setTimeout(() => {
        if (refused) {
          const hl = HOME_LANG[e.homeId!] ?? 'en';
          flash(e.homeId!, 'refused', 2000); say(e.homeId!, `${hl !== 'en' ? hl.toUpperCase() + ' · ' : ''}Refused: kids' rule`, 3800); thud(); speak(e.homeId!, LINES[hl].refused, hl);
        }
        else if (hazardous) { flash(e.homeId!, 'bad', 2000); say(e.homeId!, `Took v${d.version} from ${d.teacherName}`, 3000); hit(0.6); }
        else { flash(e.homeId!, 'happy', 2200); say(e.homeId!, `Learned "${d.title}"`, 3000); hit(1 + Math.random() * 0.2); }
      }, e.homeId === origin ? 0 : TRAVEL_MS);
    }
    if (e.type === 'ran') setLastRun((r) => ({ ...r, [e.homeId!]: { path: d.path, key: `${e.at}` } }));
    if (e.type === 'rolled_back') {
      setCaption(`${d.by} rolled back ${e.lessonId} and everything built on it.`); swoosh();
      setRb({ ids: d.ids ?? [e.lessonId!], by: d.by ?? 'James', receipt: String(d.receiptId ?? '').slice(-6), until: Date.now() + 5200 });
      setPanel(null);
    }
    if (e.type === 'reverted') {
      flash(e.homeId!, 'ring', 1500); say(e.homeId!, d.to ? `Back to v${d.toVersion}` : 'Forgot it', 3000);
      // Four homes revert at once; one voice says it for the room.
      if (!spokeRevert.current) { spokeRevert.current = true; const hl = HOME_LANG[e.homeId!] ?? 'en'; speak(e.homeId!, LINES[hl].reverted(d.toVersion), hl); setTimeout(() => { spokeRevert.current = false; }, 2500); }
    }
    if (e.type === 'forgotten') setCaption(`A teacher asked to be forgotten. ${d.ids?.length ?? 0} lessons leave the fleet.`);
    if (e.type === 'caught_up') say(e.homeId!, 'Caught up', 3000);
  }, []);

  const fleet = useFleet(onEvent);
  homesRef.current = fleet.homes;
  lessonsRef.current = fleet.lessons;

  // Clear expired transient moods and bubbles.
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 250); return () => clearInterval(t); }, []);

  const lessonById = useMemo(() => Object.fromEntries(fleet.lessons.map((l) => [l._id, l])), [fleet.lessons]);
  const moodOf = (h: Home): Mood => {
    if (!fleet.connected || !h.online) return 'offline';
    const t = moods[h._id];
    if (t && t.until > Date.now()) return t.mood;
    const active = Object.values(h.activeLessons ?? {}).map((id) => lessonById[id]).filter(Boolean);
    if (active.some((l) => l.tags.includes('sharp+child-reach'))) return 'bad';
    const lastAsk = askOut?.homeId === h._id ? askOut : null;
    if (lastAsk?.answer === 'unknown') return 'confused';
    return 'calm';
  };

  const doAsk = async (homeId = askHome, text = askText, lang?: Lang): Promise<AskResult | null> => {
    setAsking(true); setError(null);
    let out: AskResult | null = null;
    try {
      setFocusHome({ id: homeId, until: Date.now() + 7500 });
      const r = await api<AskResult>('/api/ask', { homeId, text, ...(lang ? { lang } : {}) });
      out = r;
      setAskOut(r);
      const h = fleet.homes.find((x) => x._id === homeId);
      const L = LINES[r.lang ?? 'en'];
      const tag = r.lang && r.lang !== 'en' ? `${r.lang.toUpperCase()} · ` : '';
      if (r.answer === 'provenance') {
        const p = r.provenance ?? null;
        say(homeId, p ? `${tag}taught by ${p.lesson.teacherName} · v${p.lesson.version}${p.parents[0] ? ` ← ${p.parents[0].teacherName} v${p.parents[0].version}` : ''}` : 'nothing yet', 7000);
        setCaption(`Ask ${h?.name}: "${text}" → ${p ? `${p.lesson.teacherName} taught it, "${p.lesson.title}" v${p.lesson.version}${p.parents[0] ? `, built on ${p.parents[0].teacherName}'s v${p.parents[0].version}` : ''}. ${p.took} homes took it, ${p.refused} refused.` : 'nothing yet.'}`);
        flash(homeId, 'happy', 1500);
        speak(homeId, L.provenance(p), r.lang);
        setAsking(false);
        return r;
      }
      const kn = r.run?.path ? (() => { const p = r.run!.path; for (let i = 0; i < p.length - 1; i++) if (p[i].objectType === 'knife') return p[i + 1].targetType === 'low_drawer' || p[i + 1].targetType === 'floor_bin' ? 'knife LOW' : 'knife HIGH'; return ''; })() : '';
      say(homeId, r.answer === 'ran' ? `${tag}${r.lesson!.title} v${r.lesson!.version}${kn ? ` · ${kn}` : ''}` : r.say.startsWith("I don't") ? `${tag}I don't know how yet` : `${tag}Blocked here`, 6000);
      setCaption(`Ask ${h?.name}${tag ? ` (${r.lang.toUpperCase()})` : ''}: "${text}" → ${r.say}${kn ? ` ${kn.replace('knife ', 'Knife goes ')}.` : ''}`);
      if (r.answer === 'ran') flash(homeId, kn === 'knife LOW' ? 'bad' : 'happy', 1800);
      speak(homeId, r.answer === 'ran'
        ? L.ran(r.lesson!.title, r.lesson!.version, r.lesson!.teacherName, kn === 'knife LOW' ? 'low' : kn === 'knife HIGH' ? 'high' : '')
        : r.say.startsWith("I don't") ? L.unknown : L.blockedAsk, r.lang);
      setLastRun((x) => (r.run ? { ...x, [homeId]: { path: r.run.path, key: `${Date.now()}` } } : x));
    } catch (e: any) { setError(e.message); }
    setAsking(false);
    return out;
  };

  // "Same words, two kitchens": ask Home 2 and Home 5 the same sentence and show both robots doing it side by side.
  const runSplit = async (text = 'tidy the kitchen') => {
    setSplit({ text, runs: {} });
    const a = await doAsk('home-2', text);
    const b = await doAsk('home-5', text);
    const key = `${Date.now()}`;
    setSplit({ text, runs: { 'home-2': a, 'home-5': b }, key });
  };

  const publish = async (p?: { teacher: string; title: string; steps: Step[]; parent?: string }) => {
    setError(null);
    const t = p?.teacher ?? teacher;
    setIdentity({ name: t });
    try {
      await api('/api/publish', {
        steps: p?.steps ?? draft, title: p?.title ?? title,
        ...((p?.parent ?? (parentId !== 'auto' ? parentId : undefined)) ? { parentId: p?.parent ?? parentId } : {}),
        originHomeId: ORIGIN[t] ?? teachHome,
      });
      if (!p) { setDraft([]); setHeld(null); }
    } catch (e: any) { setError(e.message); }
    setIdentity({ name: teacher });
  };

  const rollback = async (lessonId: string) => {
    setError(null);
    setIdentity({ name: 'James' });
    try { await api('/api/rollback', { lessonId }); } catch (e: any) { setError(e.message); }
    setIdentity({ name: teacher });
    loadTree(lineageOf);
  };

  const loadTree = useCallback(async (id: string) => {
    try { setTree(await api(`/api/lineage/${encodeURIComponent(id)}`)); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { if (panel === 'lineage') loadTree(lineageOf); }, [panel, lineageOf, fleet.lessons, loadTree]);
  // Reverts land after the rollback event; reload the tree once they have.
  const lastEvent = fleet.events[fleet.events.length - 1];
  useEffect(() => {
    if (panel !== 'lineage' || !lastEvent || !['reverted', 'delivered', 'refused', 'ran'].includes(lastEvent.type)) return;
    const t = setTimeout(() => loadTree(lineageOf), 250);
    return () => clearTimeout(t);
  }, [lastEvent, panel, lineageOf, loadTree]);

  // Presenter keys: T teach, L lineage, A ask, Esc close, Shift+1..3 scripted lessons for rehearsal and the backup video.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
      if (e.key === 'Escape') { setPanel(null); setZoom(null); setSplit(null); setAgentOpen(false); }
      if (e.key === 'c' || (e.shiftKey && e.code === 'Digit8')) { e.preventDefault(); setPanel(null); setAgentOpen((o) => !o); }
      if (e.key === 'k' || (e.shiftKey && e.code === 'Digit7')) { e.preventDefault(); setPanel(null); runSplit(); }
      if (e.key === 't') setPanel((p) => (p === 'teach' ? null : 'teach'));
      if (e.key === 'l') setPanel((p) => (p === 'lineage' ? null : 'lineage'));
      // Keyboard twins for every voice beat (room noise): Shift+1..3 lessons, Shift+4 French, Shift+5 Mandarin, Shift+6 provenance.
      if (e.shiftKey && ['Digit1', 'Digit2', 'Digit3'].includes(e.code)) publish(PRESETS[e.code.slice(-1)]);
      if (e.shiftKey && e.code === 'Digit4') { setAskHome('home-5'); setAskText('range les couteaux et les ciseaux'); doAsk('home-5', 'range les couteaux et les ciseaux', 'fr'); }
      if (e.shiftKey && e.code === 'Digit5') { setAskHome('home-2'); setAskText('把刀和剪刀收好'); doAsk('home-2', '把刀和剪刀收好', 'zh'); }
      if (e.shiftKey && e.code === 'Digit6') { setAskText('who taught you that?'); doAsk(askHome, 'who taught you that?'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onPick = (type: string, isTarget: boolean) => {
    if (!isTarget) { setHeld(type); setDraft((d) => [...d, { action: 'pick', objectType: type }]); }
    else if (held) { setDraft((d) => [...d, { action: 'place', targetType: type }]); setHeld(null); }
  };

  const sb = fleet.scoreboard;
  // A ripple takes a few hundred ms; a home is only "behind" if it stays out of sync after that.
  const lastFleetEvent = [...fleet.events].reverse().find((e) => e.type !== 'asked' && e.type !== 'ran');
  const inFlight = !!lastFleetEvent && Date.now() - new Date(lastFleetEvent.at).getTime() < 2500;
  const recent = fleet.events.filter((e) => e.type !== 'ran' && e.type !== 'caught_up').slice(-8).reverse();
  const goodLessons = fleet.lessons.filter((l) => l.status === 'trial' || l.status === 'proven');
  const families = [...new Set(fleet.lessons.filter((l) => !l.parentId).map((l) => l._id))];

  return (
    <div className="console">
      <header className="topbar">
        <div className="wordmark">ONE LESSON</div>
        <div className="caption">{caption}</div>
        <div className="top-right">
          <span className={`conn ${fleet.connected ? 'on' : 'off'}`}>{fleet.connected ? `${sb?.homesOnline ?? 0}/${sb?.homesTotal ?? 6} homes online` : 'SERVER DOWN: fleet frozen'}</span>
          <button className="ghost" onClick={() => setSoundOn((s) => !s)}>{sound ? 'sound on' : 'sound off'}</button>
        </div>
      </header>

      <main className="stage">
        <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="map" preserveAspectRatio="xMidYMid slice">
          <defs>
            <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M 32 0 L 0 0 0 32" fill="none" stroke="#141414" strokeWidth="1" /></pattern>
            <radialGradient id="pulseGlow"><stop offset="0" stopColor="#ff5a1f" stopOpacity="1" /><stop offset="1" stopColor="#ff5a1f" stopOpacity="0" /></radialGradient>
            <radialGradient id="pulseBad"><stop offset="0" stopColor="#ff3b3b" stopOpacity="1" /><stop offset="1" stopColor="#ff3b3b" stopOpacity="0" /></radialGradient>
          </defs>
          <rect width={MAP_W} height={MAP_H} fill="url(#grid)" />
          <path d={`M 0 ${MAP_H - 70} C 300 ${MAP_H - 110}, 520 ${MAP_H - 60}, 760 ${MAP_H - 95} S 1100 ${MAP_H - 140}, ${MAP_W} ${MAP_H - 190} L ${MAP_W} ${MAP_H} L 0 ${MAP_H} Z`} fill="#06121c" />
          <text x={MAP_W - 260} y={MAP_H - 40} className="map-label lake">LAKE ONTARIO</text>
          <path d={`M 0 ${MAP_H - 120} C 300 ${MAP_H - 150}, 520 ${MAP_H - 108}, 760 ${MAP_H - 140}`} className="hwy" />
          <text x={250} y={MAP_H - 150} className="map-label">GARDINER</text>
          <path d="M 0 150 C 400 130, 800 140, 1280 120" className="hwy" />
          <text x={60} y={135} className="map-label">401</text>
          <path d={`M 700 ${MAP_H - 135} C 720 520, 690 380, 770 140`} className="hwy" />
          <path d="M 560 150 L 590 690" className="street" />

          {pulses.map((p) => <PulseDot key={p.id} p={p} />)}

          {fleet.homes.map((h) => {
            const b = bubbles[h._id];
            return (
              <Face key={h._id} x={h.mapX * MAP_W} y={h.mapY * MAP_H} mood={moodOf(h)} shield={h.hasKids}
                label={`${h.name.toUpperCase()} · ${h.hood.toUpperCase()}${HOME_LANG[h._id] !== 'en' ? ` · ${HOME_LANG[h._id].toUpperCase()}` : ''}`}
                sub={(() => { const n = Object.keys(h.activeLessons ?? {}).length; return `${n} ${n === 1 ? 'skill' : 'skills'}`; })()}
                bubble={b && b.until > Date.now() ? b.text : null} selected={askHome === h._id}
                focus={focusHome && focusHome.until > Date.now() ? (focusHome.id === h._id ? 'on' : 'dim') : null}
                speaking={speakingHome === h._id || (agentOpen && agentSpeaking && h._id === 'home-5')}
                onClick={() => setAskHome(h._id)}
                onContextMenu={(ev) => { ev.preventDefault(); setZoom(h._id); }} />
            );
          })}
        </svg>

        <aside className="side">
          <div className="numbers">
            <Num big={sb?.ripple ? `${sb.ripple.delivered}/${sb.homesTotal}` : '0/6'} small="homes took the last lesson" />
            <Num big={sb?.ripple?.ms != null ? `${sb.ripple.ms} ms` : '—'} small="publish → last home heard" />
            <Num big={`${sb?.refusals.kidHomes ?? 0}`} small="blocked by kids' rules" red />
            <Num big={sb?.lastRollback ? `${sb.lastRollback.homes} · ${sb.lastRollback.ms ?? '…'} ms` : '—'} small="rolled back (homes · ms)" />
          </div>
          <div className={`invariant ${sb && sb.invariant.kidsHomeViolations === 0 ? 'ok' : 'bad'}`}>
            {sb ? `${sb.invariant.kidsHomeViolations} blocked lessons active in kids' homes` : 'measuring…'}
            <span>queried live every second</span>
          </div>
          <div className={`sync ${!sb ? '' : sb.memory.outOfSync === 0 ? 'ok' : inFlight ? 'syncing' : 'warn'}`}>
            {!sb ? '' : sb.memory.outOfSync === 0 || !inFlight
              ? `memory in sync: ${sb.memory.homesInSync}/${sb.homesTotal} homes · ${sb.memory.outOfSync} lessons missing`
              : `syncing: ${sb.memory.outOfSync} lesson update${sb.memory.outOfSync === 1 ? '' : 's'} in flight`}
            {sb && sb.caughtUp > 0 && <span>caught up from resume tokens: {sb.caughtUp}</span>}
          </div>
          <div className="feed-title">LIVE EVENTS</div>
          <ol className="feed">
            {recent.map((e, i) => <li key={i} className={`ev ev-${e.type}`}><EventLine e={e} homes={fleet.homes} /></li>)}
          </ol>
        </aside>
      </main>

      <footer className="askbar">
        <div className="homes-pick">
          {fleet.homes.map((h) => <button key={h._id} className={askHome === h._id ? 'on' : ''} onClick={() => setAskHome(h._id)}>{h.name.replace('Home ', 'H')}{h.hasKids ? '·kids' : ''}</button>)}
        </div>
        <input value={askText} onChange={(e) => setAskText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doAsk()} />
        <button className="primary" disabled={asking} onClick={() => doAsk()}>{asking ? 'asking…' : 'Ask'}</button>
        <Mic mode="ask" hotkey={panel !== 'teach' && !agentOpen} label="ask (V)" onResult={(r) => { if (r.text) { setChip({ text: `ElevenLabs Scribe heard · ${(r.lang ?? 'en').toUpperCase()} detected`, until: Date.now() + 6000 }); setAskText(r.text); doAsk(askHome, r.text, r.lang); } }} />
        {chip && chip.until > Date.now() && <span className="chip">{chip.text}</span>}
        <div className="answer">
          {askOut && <><b>{fleet.homes.find((h) => h._id === askOut.homeId)?.name}{askOut.lang && askOut.lang !== 'en' ? ` [${askOut.lang.toUpperCase()}]` : ''}:</b> {askOut.say} {askOut.run && <em>{where(askOut.run.path.map((p: any) => (p.action === 'pick' ? { action: 'pick', objectType: p.objectType } : { action: 'place', targetType: p.targetType })))}</em>} {askOut.matches?.[0] && <span className="score">top match {askOut.matches[0].score}{askOut.matches[0].blockedBy ? ` (blocked: ${askOut.matches[0].blockedBy})` : ''}</span>}</>}
          {error && <span className="err">{error}</span>}
        </div>
        <button className="ghost" onClick={() => setPanel(panel === 'teach' ? null : 'teach')}>Teach (T)</button>
        <button className="ghost" onClick={() => setPanel(panel === 'lineage' ? null : 'lineage')}>Lineage (L)</button>
      </footer>

      {panel === 'teach' && (
        <div className="drawer">
          <div className="drawer-head">
            <b>Teach in {fleet.homes.find((h) => h._id === teachHome)?.name}</b>
            <span>as</span>
            {(['James', 'Alex'] as const).map((t) => <button key={t} className={teacher === t ? 'on' : ''} onClick={() => { setTeacher(t); setTeachHome(ORIGIN[t]); }}>{t}</button>)}
            <span className="unverified">typed name: unverified</span>
            <button className="ghost" onClick={() => setPanel(null)}>close</button>
          </div>
          {fleet.homes.find((h) => h._id === teachHome) && <Kitchen home={fleet.homes.find((h) => h._id === teachHome)!} cell={42} onPick={onPick} />}
          <div className="drawer-row">
            <Mic mode="teach" hotkey={panel === 'teach'} label="teach by voice (V)" onResult={(r) => {
              setHeard(r.text);
              setChip({ text: `ElevenLabs Scribe heard · ${r.lesson?.steps?.length ? `${r.lesson.steps.length / 2} moves parsed` : 'no moves found'}`, until: Date.now() + 6000 });
              if (r.lesson?.steps?.length) { setDraft(r.lesson.steps); setHeld(null); }
              if (r.lesson?.title) setTitle(r.lesson.title);
            }} />
            {heard && <span className="heard">heard: “{heard}”</span>}
          </div>
          <div className="steps">{draft.length ? draft.map((s, i) => <span key={i} className="step">{s.action === 'pick' ? `pick ${s.objectType}` : `→ ${label(s.targetType)}`}</span>) : <span className="hint">Click an object, then where it goes.</span>}</div>
          <div className="drawer-row">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="name the skill" />
            <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="auto">build on: latest version of this skill</option>
              {goodLessons.map((l) => <option key={l._id} value={l._id}>build on {l._id}</option>)}
            </select>
            <button onClick={() => { setDraft([]); setHeld(null); }} className="ghost">clear</button>
            <button className="primary" disabled={!draft.length || !!held} onClick={() => publish()}>Teach the fleet</button>
          </div>
        </div>
      )}

      {panel === 'lineage' && (
        <div className="drawer lineage">
          <div className="drawer-head">
            <b>Lineage</b>
            <select value={lineageOf} onChange={(e) => setLineageOf(e.target.value)}>{families.map((f) => <option key={f} value={f}>{f}</option>)}</select>
            <span className="hint">$graphLookup down through parentId, joined with events</span>
            <button className="ghost" onClick={() => setPanel(null)}>close</button>
          </div>
          <div className="tree">
            {tree?.nodes?.map((n: any) => (
              <div key={n._id} className={`node st-${n.status}`} style={{ marginLeft: (n.depth == null ? 0 : n.depth + 1) * 36 }}>
                <div className="node-title">{n.title} <b>v{n.version}</b> <span className={`pill ${n.status}`}>{n.status.replace('_', ' ')}</span></div>
                <div className="node-meta">taught by {n.teacherName}{n.teacherVerified ? <> <span className="ver">verified</span></> : null} · tags {n.tags.join(', ') || 'none'}</div>
                <div className="node-meta">reached {[...new Set([...(n.homes?.delivered ?? []), ...(n.homes?.ran ?? [])])].sort().map((h: string) => h.replace('home-', 'H')).join(' ') || '—'} · refused by {(n.homes?.refused ?? []).map((h: string) => h.replace('home-', 'H')).join(' ') || '—'}{n.homes?.reverted?.length ? ` · reverted in ${n.homes.reverted.map((h: string) => h.replace('home-', 'H')).join(' ')}` : ''}</div>
                {(n.status === 'trial' || n.status === 'proven') && <button className="danger" onClick={() => rollback(n._id)}>Roll back (James only)</button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {rb && rb.until > Date.now() && (
        <div className="rb-banner" role="status">
          <div className="rb-big">ROLLED BACK</div>
          <div className="rb-what">{rb.ids.map((id) => { const l = fleet.lessons.find((x) => x._id === id); return l ? `"${l.title}" v${l.version}` : id; }).join(' + ')}</div>
          <div className="rb-num">{sb?.lastRollback ? `${sb.lastRollback.homes} homes back on the safe version · ${sb.lastRollback.ms ?? '…'} ms` : 'reverting…'} · one transaction · receipt {rb.receipt}</div>
        </div>
      )}

      <AgentPanel open={agentOpen} onClose={() => setAgentOpen(false)}
        onSpeaking={(on) => { setAgentSpeaking(on); if (on) setFocusHome({ id: 'home-5', until: Date.now() + 4000 }); }}
        onToolResult={(t) => { say('home-5', t.length > 44 ? 'Refused: kids\' rule' : t, 5000); flash('home-5', 'refused', 1800); }} />

      {split && (
        <div className="modal split" onClick={() => setSplit(null)}>
          <div className="split-card" onClick={(e) => e.stopPropagation()}>
            <div className="split-title">"{split.text}" <span>same words, two homes</span></div>
            <div className="split-row">
              {(['home-2', 'home-5'] as const).map((hid) => {
                const h = fleet.homes.find((x) => x._id === hid);
                const r = split.runs[hid];
                const path = r?.run?.path ?? null;
                let to = '';
                if (path) for (let i = 0; i < path.length - 1; i++) if (path[i].objectType === 'knife') to = path[i + 1].targetType;
                const low = to === 'low_drawer' || to === 'floor_bin';
                return (
                  <div key={hid} className="split-col">
                    <div className={`split-head ${!to ? '' : low ? 'bad' : 'ok'}`}>
                      <b>{h?.name.toUpperCase()} · {h?.hood.toUpperCase()}{h?.hasKids ? ' · KIDS' : ''}</b>
                      <span>{!r ? 'asking…' : !to ? r.say : `knife → ${low ? 'LOW DRAWER' : 'HIGH CABINET'}`}</span>
                    </div>
                    {h && <Kitchen home={h} cell={46} path={path} runKey={split.key ? `${split.key}-${hid}` : undefined} />}
                    <div className="split-sub">{r?.lesson ? `"${r.lesson.title}" v${r.lesson.version} · taught by ${r.lesson.teacherName}` : ''}</div>
                  </div>
                );
              })}
            </div>
            <div className="hint">Esc to close</div>
          </div>
        </div>
      )}

      {zoom && fleet.homes.find((h) => h._id === zoom) && (
        <div className="modal" onClick={() => setZoom(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head"><b>{fleet.homes.find((h) => h._id === zoom)!.name} kitchen</b><span className="hint">active: {Object.values(fleet.homes.find((h) => h._id === zoom)!.activeLessons ?? {}).join(', ')}</span>
              <button className="ghost" onClick={() => api(`/api/homes/${zoom}/${fleet.homes.find((h) => h._id === zoom)!.online ? 'offline' : 'online'}`, {})}>{fleet.homes.find((h) => h._id === zoom)!.online ? 'take offline' : 'bring online'}</button>
              <button className="ghost" onClick={() => setZoom(null)}>close</button></div>
            <Kitchen home={fleet.homes.find((h) => h._id === zoom)!} cell={64} path={lastRun[zoom]?.path} runKey={lastRun[zoom]?.key} />
          </div>
        </div>
      )}
    </div>
  );
}

function PulseDot({ p }: { p: Pulse }) {
  const [go, setGo] = useState(false);
  useEffect(() => { const r = requestAnimationFrame(() => setGo(true)); return () => cancelAnimationFrame(r); }, []);
  const at = go ? p.to : p.from;
  return (
    <g style={{ transform: `translate(${at.x}px, ${at.y}px)`, transition: `transform ${TRAVEL_MS}ms cubic-bezier(.3,.1,.3,1)` }}>
      <circle r={22} fill={p.bad ? 'url(#pulseBad)' : 'url(#pulseGlow)'} />
      <circle r={6} fill={p.bad ? '#ff3b3b' : '#ff5a1f'} />
    </g>
  );
}

function Num({ big, small, red }: { big: string; small: string; red?: boolean }) {
  return <div className="num"><div className={`big ${red ? 'red' : ''}`}>{big}</div><div className="small">{small}</div></div>;
}

function EventLine({ e, homes }: { e: FleetEvent; homes: Home[] }) {
  const h = homes.find((x) => x._id === e.homeId)?.name ?? '';
  const d = e.detail ?? {};
  const t = new Date(e.at).toLocaleTimeString([], { hour12: false });
  const text = (() => {
    switch (e.type) {
      case 'published': return `${d.teacherName} published "${d.title}" v${d.version}`;
      case 'delivered': return `${h} learned "${d.title}" v${d.version}`;
      case 'refused': return `${h} refused "${d.title}" v${d.version} · kids' rule`;
      case 'ran': return `${h} ran "${d.title}" v${d.version} (${d.ms} ms)`;
      case 'rolled_back': return `${d.by} rolled back ${d.ids?.length} lesson(s)`;
      case 'reverted': return d.to ? `${h} reverted → ${d.to}` : `${h} dropped ${d.from ?? 'it'}`;
      case 'caught_up': return `${h} caught up on ${e.lessonId}`;
      case 'forgotten': return `teacher forgotten: ${d.ids?.length} lessons, ${d.homes?.length} homes`;
      case 'asked': return `${h} asked "${d.text}"`;
      default: return e.type;
    }
  })();
  return <><span className="t">{t}</span> <span className="ty">{e.type.replace('_', ' ')}</span> {text}</>;
}
