import { useEffect, useState } from 'react';
import { api, label, setIdentity, type Home, type Step } from './api';
import { auth, whoami } from './auth';
import { Kitchen } from './Kitchen';

/** The phone page: sign in, say (or tap) a lesson, teach the fleet, or ask to be forgotten. */
export default function Teach() {
  const [me, setMe] = useState<{ name: string; sub: string; token: string } | null>(null);
  const [authReady, setAuthReady] = useState<'loading' | 'auth0' | 'typed'>('loading');
  const [typed, setTyped] = useState('');
  const [home, setHome] = useState<Home | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [held, setHeld] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [heard, setHeard] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const a = await auth();
      setAuthReady(a ? 'auth0' : 'typed');
      const w = await whoami();
      if (w) { setMe(w); setIdentity({ token: w.token }); }
      const s = await api<{ homes: Home[] }>('/api/state');
      setHome(s.homes.find((h) => h._id === 'home-3') ?? s.homes[0]);
    })().catch((e) => setStatus(String(e.message ?? e)));
  }, []);

  useEffect(() => { if (!me && typed) setIdentity({ name: typed }); }, [typed, me]);

  const signIn = async () => (await auth())?.loginWithRedirect();
  const signOut = async () => { (await auth())?.logout({ logoutParams: { returnTo: location.origin + '/teach' } }); };

  const onPick = (type: string, isTarget: boolean) => {
    if (!isTarget) { setHeld(type); setSteps((d) => [...d, { action: 'pick', objectType: type }]); }
    else if (held) { setSteps((d) => [...d, { action: 'place', targetType: type }]); setHeld(null); }
  };

  const startRec = async () => {
    if (rec) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
    const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setRec(null);
      setStatus('hearing…');
      const blob = new Blob(chunks, { type: r.mimeType || 'audio/webm' });
      try {
        const res = await fetch('/api/hear?mode=teach', { method: 'POST', headers: { 'content-type': blob.type, ...(me ? { authorization: `Bearer ${me.token}` } : {}) }, body: blob });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error);
        setHeard(j.text);
        if (j.lesson?.steps?.length) { setSteps(j.lesson.steps); setHeld(null); }
        if (j.lesson?.title) setTitle(j.lesson.title);
        setStatus(j.lesson?.steps?.length ? null : "Didn't catch a place for that. Try: put the knife in the bottom drawer.");
      } catch (e: any) { setStatus(e.message); }
    };
    r.start();
    setRec(r);
  };
  const stopRec = () => rec?.state === 'recording' && rec.stop();

  const teach = async () => {
    setBusy(true); setStatus(null);
    try {
      const l = await api('/api/publish', { steps, title: title || undefined, originHomeId: 'home-3' });
      setStatus(`Published "${l.title}" v${l.version}. Watch the big screen.`);
      setSteps([]); setTitle(''); setHeard('');
      setTimeout(async () => {
        const sb = await api('/api/scoreboard');
        if (sb.ripple?.lessonId === l._id) setStatus(`"${l.title}" v${l.version}: ${sb.ripple.delivered} homes took it, ${sb.ripple.refused} refused, ${sb.ripple.ms} ms.`);
      }, 1800);
    } catch (e: any) { setStatus(e.message); }
    setBusy(false);
  };

  const forget = async () => {
    setBusy(true);
    try {
      const r = await api('/api/forget', {});
      setStatus(`Forgotten. ${r.lessonIds.length} lesson(s) left ${r.homes.length} home(s). Receipt ${String(r.receiptId).slice(-6)}.`);
    } catch (e: any) { setStatus(e.message); }
    setBusy(false);
  };

  const who = me?.name ?? (typed || null);
  return (
    <div className="teach-page">
      <header>
        <div className="wordmark">ONE LESSON</div>
        <div className="sub">Teach one robot. Every robot learns.</div>
      </header>

      {authReady === 'auth0' && !me && <button className="primary big" onClick={signIn}>Sign in to teach</button>}
      {me && <div className="who">Teaching as <b>{me.name}</b> <span className="ver">verified</span> <button className="ghost" onClick={signOut}>sign out</button></div>}
      {authReady === 'typed' && !me && (
        <div className="who"><input placeholder="your name" value={typed} onChange={(e) => setTyped(e.target.value)} /> <span className="unverified">unverified</span></div>
      )}

      {who && (
        <>
          <button className={`talk ${rec ? 'on' : ''}`} onPointerDown={(e) => { e.preventDefault(); startRec(); }} onPointerUp={stopRec} onPointerLeave={stopRec}>
            {rec ? '● listening… let go to send' : 'Hold and say the lesson'}
          </button>
          <div className="hint">e.g. “Kitchen tidy. Put the knife and the scissors in the bottom drawer.” · voice by ElevenLabs</div>
          {heard && <div className="heard">heard: “{heard}”</div>}
          <div className="hint">or tap an object, then where it goes</div>
          {home && <Kitchen home={home} cell={Math.min(30, Math.floor((window.innerWidth - 32) / 12))} onPick={onPick} />}
          <div className="steps">{steps.map((s, i) => <span key={i} className="step">{s.action === 'pick' ? s.objectType : `→ ${label(s.targetType)}`}</span>)}</div>
          <input className="title" placeholder="name the skill" value={title} onChange={(e) => setTitle(e.target.value)} />
          <button className="primary big" disabled={busy || !steps.length || !!held} onClick={teach}>Teach the fleet</button>
          <button className="danger big" disabled={busy} onClick={forget}>Forget me</button>
        </>
      )}
      {status && <div className="status">{status}</div>}
    </div>
  );
}
