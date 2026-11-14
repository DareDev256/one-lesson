import { useEffect, useState } from 'react';
import { label, type Home } from './api';

const W = 12, H = 8;
const TARGET = new Set(['dishwasher', 'sink', 'high_cabinet', 'low_drawer', 'floor_bin']);
const COLORS: Record<string, string> = {
  knife: '#ff3b3b', scissors: '#ff3b3b', cleaner: '#c86bff', pan: '#ffb020',
  plate: '#e8e8e8', cup: '#e8e8e8', bowl: '#e8e8e8',
  low_drawer: '#ff8a5c', floor_bin: '#ff8a5c', high_cabinet: '#7fb2ff', dishwasher: '#5fd0c8', sink: '#5fd0c8',
};
const DOCK = { x: 1, y: 6 };
const STEP_MS = 550;

type PathStep = { x: number; y: number; action: string; objectType?: string; targetType?: string };

/** Top-down kitchen on a 12 by 8 grid. Click an object to pick it, a target to place it.
 *  Given a run's path, the robot walks it: it carries each object and leaves it IN the target it was placed in. */
export function Kitchen({ home, cell = 52, onPick, path, runKey }: {
  home: Home; cell?: number; onPick?: (type: string, isTarget: boolean) => void;
  path?: PathStep[] | null; runKey?: string;
}) {
  const [robot, setRobot] = useState(DOCK);
  const [carry, setCarry] = useState<string | null>(null);
  const [placed, setPlaced] = useState<Record<string, { x: number; y: number; target: string }>>({});
  const [hit, setHit] = useState<string | null>(null);

  useEffect(() => {
    if (!path?.length) return;
    let cancelled = false;
    setPlaced({}); setCarry(null); setRobot(DOCK);
    (async () => {
      let holding: string | null = null;
      const placedNow: Record<string, { x: number; y: number; target: string }> = {};
      for (const p of [...path, { ...DOCK, action: 'dock' } as PathStep]) {
        if (cancelled) return;
        setRobot({ x: p.x, y: p.y });
        await new Promise((r) => setTimeout(r, STEP_MS));
        if (cancelled) return;
        if (p.action === 'pick') { holding = p.objectType ?? null; setCarry(holding); }
        if (p.action === 'place' && holding) {
          placedNow[holding] = { x: p.x, y: p.y, target: p.targetType ?? '' };
          setPlaced({ ...placedNow });
          setHit(p.targetType ?? null);
          setTimeout(() => setHit(null), 500);
          holding = null; setCarry(null);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [runKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Objects placed into the same target sit side by side inside it.
  const slot: Record<string, number> = {};
  return (
    <svg viewBox={`0 0 ${W * cell} ${H * cell}`} className="kitchen" style={{ width: W * cell, maxWidth: '100%' }}>
      <rect width={W * cell} height={H * cell} fill="#0a0a0a" />
      {Array.from({ length: W + 1 }, (_, i) => <line key={`v${i}`} x1={i * cell} y1={0} x2={i * cell} y2={H * cell} stroke="#161616" />)}
      {Array.from({ length: H + 1 }, (_, i) => <line key={`h${i}`} x1={0} y1={i * cell} x2={W * cell} y2={i * cell} stroke="#161616" />)}
      <rect x={DOCK.x * cell + 4} y={DOCK.y * cell + 4} width={cell - 8} height={cell - 8} fill="none" stroke="#333" strokeDasharray="4 4" />
      {home.layout.filter((o) => TARGET.has(o.type)).map((o) => {
        const c = COLORS[o.type] ?? '#ccc';
        return (
          <g key={o.id} transform={`translate(${o.x * cell},${o.y * cell})`} onClick={() => onPick?.(o.type, true)} style={{ cursor: onPick ? 'pointer' : 'default' }}>
            <rect x={2} y={2} width={cell - 4} height={cell - 4} rx={6} fill="#111" stroke={c} strokeWidth={hit === o.type ? 6 : 2.5} className={hit === o.type ? 'k-hit' : ''} />
            <text x={cell / 2} y={cell / 2 - 2} className="k-label k-target" fill={c}>
              {(o.type === 'dishwasher' ? 'dish washer' : label(o.type)).split(' ').map((w, i, all) => <tspan key={i} x={cell / 2} dy={i === 0 ? (all.length > 1 ? -2 : 4) : 11}>{w}</tspan>)}
            </text>
          </g>
        );
      })}
      {home.layout.filter((o) => !TARGET.has(o.type)).map((o) => {
        const c = COLORS[o.type] ?? '#ccc';
        const pl = placed[o.type];
        if (pl) {
          const n = (slot[pl.target] = (slot[pl.target] ?? 0) + 1) - 1;
          return (
            <g key={o.id} transform={`translate(${pl.x * cell},${pl.y * cell})`}>
              <circle cx={cell * (0.3 + 0.4 * n)} cy={cell * 0.8} r={cell / 7} fill={c} stroke="#000" strokeWidth={2} />
            </g>
          );
        }
        return (
          <g key={o.id} transform={`translate(${o.x * cell},${o.y * cell})`} onClick={() => onPick?.(o.type, false)} style={{ cursor: onPick ? 'pointer' : 'default' }}>
            <circle cx={cell / 2} cy={cell / 2} r={cell / 3.2} fill={c} opacity={carry === o.type ? 0.15 : 1} />
            <text x={cell / 2} y={cell - 3} className="k-label" fill="#9a9a9a">{label(o.type)}</text>
          </g>
        );
      })}
      <g style={{ transform: `translate(${robot.x * cell + cell / 2}px, ${robot.y * cell + cell / 2}px)`, transition: `transform ${STEP_MS - 40}ms ease-in-out` }}>
        <rect x={-cell / 3} y={-cell / 3} width={cell / 1.5} height={cell / 1.5} rx={8} fill="#ff5a1f" />
        <circle cx={-6} cy={-3} r={3} fill="#000" /><circle cx={6} cy={-3} r={3} fill="#000" />
        {carry && <circle cx={cell / 3} cy={-cell / 3} r={cell / 5} fill={COLORS[carry] ?? '#fff'} stroke="#000" strokeWidth={2} />}
      </g>
    </svg>
  );
}
