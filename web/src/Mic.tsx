import { useEffect, useRef, useState } from 'react';

/** Hold to talk (mouse, touch, or the V key). On release the audio goes to /api/hear (ElevenLabs Scribe). */
export function Mic({ mode, onResult, label = 'hold to talk', hotkey = false }: {
  mode: 'ask' | 'teach'; onResult: (r: { text: string; lang?: any; lesson?: any; homeId?: string | null; empty?: boolean; heard?: string }) => void; label?: string; hotkey?: boolean;
}) {
  const [state, setState] = useState<'idle' | 'rec' | 'hearing' | 'error'>('idle');
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  // The mic stays open after first use, so recording starts the instant V goes down (opening it per press lost the
  // first words). A release before the recorder is running still stops it, and a press under 350 ms is not sent.
  const stream = useRef<MediaStream | null>(null);
  const starting = useRef(false);
  const wantStop = useRef(false);
  const t0 = useRef(0);
  const start = async () => {
    if (rec.current || starting.current) return;
    starting.current = true; wantStop.current = false;
    try {
      if (!stream.current || stream.current.getAudioTracks().every((t) => t.readyState === 'ended')) {
        stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      }
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
      const r = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = async () => {
        rec.current = null;
        if (performance.now() - t0.current < 350) { setState('idle'); onResultRef.current({ text: '', empty: true }); return; }
        const blob = new Blob(chunks.current, { type: r.mimeType || 'audio/webm' });
        setState('hearing');
        try {
          const res = await fetch(`/api/hear?mode=${mode}`, { method: 'POST', headers: { 'content-type': blob.type }, body: blob });
          const j = await res.json();
          if (!res.ok) throw new Error(j.error);
          setState('idle');
          onResultRef.current(j);
        } catch {
          setState('error');
          setTimeout(() => setState('idle'), 1500);
        }
      };
      rec.current = r;
      r.start();
      t0.current = performance.now();
      setState('rec');
      if (wantStop.current) r.stop();
    } catch {
      setState('error');
      setTimeout(() => setState('idle'), 1500);
    } finally {
      starting.current = false;
    }
  };
  const stop = () => { if (rec.current?.state === 'recording') rec.current.stop(); else if (starting.current) wantStop.current = true; };
  useEffect(() => () => { stream.current?.getTracks().forEach((t) => t.stop()); }, []);

  useEffect(() => {
    if (!hotkey) return;
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === 'v' && !e.repeat && tag !== 'INPUT' && tag !== 'SELECT') start();
    };
    const up = (e: KeyboardEvent) => { if (e.key === 'v') stop(); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  });

  return (
    <button
      className={`mic mic-${state}`}
      onPointerDown={(e) => { e.preventDefault(); start(); }}
      onPointerUp={stop}
      onPointerLeave={stop}
      title="ElevenLabs Scribe speech-to-text"
    >
      {state === 'rec' ? '● listening' : state === 'hearing' ? 'hearing…' : state === 'error' ? 'mic error' : `🎙 ${label}`}
    </button>
  );
}
