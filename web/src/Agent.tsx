import { useEffect, useRef, useState } from 'react';
import { Conversation } from '@elevenlabs/client';
import { api } from './api';

type Line = { who: 'you' | 'home' | 'tool'; text: string };

/** Talk to Home 5: an ElevenLabs Conversational AI agent whose only powers are three read-only client tools
 *  that call our deterministic API. The agent is the mouth; the code decides. Toggle with C (Shift+8 twin). */
export function AgentPanel({ open, onClose, onSpeaking, onToolResult }: {
  open: boolean; onClose: () => void; onSpeaking: (on: boolean) => void; onToolResult: (text: string) => void;
}) {
  const [status, setStatus] = useState<'connecting' | 'listening' | 'speaking' | 'error' | 'ended'>('connecting');
  const [lines, setLines] = useState<Line[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const conv = useRef<Conversation | null>(null);
  const add = (l: Line) => setLines((x) => [...x.slice(-7), l]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLines([]); setErr(null); setStatus('connecting');
    (async () => {
      try {
        const { signedUrl } = await api<{ signedUrl: string }>('/api/agent/session');
        const c = await Conversation.startSession({
          signedUrl,
          clientTools: {
            check_instruction: async ({ instruction }: { instruction: string }) => {
              const r = await api('/api/check', { homeId: 'home-5', text: instruction });
              add({ who: 'tool', text: r.parsed ? `check_instruction → ${r.refused ? `REFUSED (${r.rule})` : 'allowed'}` : 'check_instruction → no object and place' });
              if (r.refused) onToolResult(`Refused: ${r.reason}`);
              return JSON.stringify(r);
            },
            ask_home: async ({ request }: { request: string }) => {
              const r = await api('/api/ask', { homeId: 'home-5', text: request });
              let knife = '';
              const p = r.run?.path ?? [];
              for (let i = 0; i < p.length - 1; i++) if (p[i].objectType === 'knife') knife = p[i + 1].targetType;
              add({ who: 'tool', text: `ask_home → ${r.answer === 'ran' ? `${r.lesson.title} v${r.lesson.version} (${r.lesson.teacherName})` : r.answer}` });
              return JSON.stringify({ answer: r.answer, say: r.say, lesson: r.lesson ?? null, knifeWentTo: knife || null });
            },
            who_taught_you: async () => {
              const r = await api('/api/ask', { homeId: 'home-5', text: 'who taught you that?' });
              add({ who: 'tool', text: `who_taught_you → ${r.provenance ? `${r.provenance.lesson.teacherName}, v${r.provenance.lesson.version}` : 'nothing yet'}` });
              return JSON.stringify(r.provenance ?? { none: true });
            },
          },
          onMessage: ({ message, source }: any) => add({ who: source === 'user' ? 'you' : 'home', text: message }),
          // Recording hook: when the demo recorder sets window.__agentAudio, keep the agent's real audio chunks with timestamps.
          onAudio: (b64: string) => { const w = window as any; if (Array.isArray(w.__agentAudio)) w.__agentAudio.push({ t: performance.now(), b64 }); },
          onConversationMetadata: (m: any) => { (window as any).__agentMeta = m; },
          onModeChange: ({ mode }: any) => { if (!cancelled) { setStatus(mode === 'speaking' ? 'speaking' : 'listening'); onSpeaking(mode === 'speaking'); } },
          onError: (m: string) => { setErr(m); setStatus('error'); },
          onDisconnect: () => { onSpeaking(false); if (!cancelled) setStatus('ended'); },
        } as any);
        if (cancelled) { await c.endSession(); return; }
        conv.current = c;
      } catch (e: any) { setErr(String(e?.message ?? e)); setStatus('error'); }
    })();
    return () => {
      cancelled = true;
      onSpeaking(false);
      conv.current?.endSession().catch(() => {});
      conv.current = null;
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;
  return (
    <div className="agent">
      <div className="agent-head">
        <span className={`dot ${status}`} />
        <b>Talking to Home 5</b>
        <span className="agent-sub">ElevenLabs Agent · tools: check, ask, who taught · cannot teach, roll back or forget</span>
        <button className="ghost" onClick={onClose}>end (C)</button>
      </div>
      <div className="agent-lines">
        {lines.length === 0 && <div className="agent-line tool">{status === 'connecting' ? 'connecting…' : 'say something to Home 5'}</div>}
        {lines.map((l, i) => <div key={i} className={`agent-line ${l.who}`}>{l.who === 'you' ? 'You: ' : l.who === 'home' ? 'Home 5: ' : '⚙ '}{l.text}</div>)}
        {err && <div className="agent-line err">{err}</div>}
      </div>
    </div>
  );
}
