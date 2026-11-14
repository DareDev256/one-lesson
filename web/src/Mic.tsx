import { useEffect, useRef, useState } from 'react';

/** Hold to talk (mouse, touch, or the V key). On release the audio goes to /api/hear (ElevenLabs Scribe). */
export function Mic({ mode, onResult, label = 'hold to talk', hotkey = false }: {
  mode: 'ask' | 'teach'; onResult: (r: { text: string; lang?: any; lesson?: any }) => void; label?: string; hotkey?: boolean;
}) {
  const [state, setState] = useState<'idle' | 'rec' | 'hearing' | 'error'>('idle');
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const start = async () => {
    if (rec.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        rec.current = null;
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
      setState('rec');
    } catch {
      setState('error');
      setTimeout(() => setState('idle'), 1500);
    }
  };
  const stop = () => { if (rec.current?.state === 'recording') rec.current.stop(); };

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
