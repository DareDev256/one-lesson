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

/** Top-down kitchen on a 12 by 8 grid. Click an object to pick it, a target to place it. */
export function Kitchen({ home, cell = 52, onPick, path, runKey }: {
  home: Home; cell?: number; onPick?: (type: string, isTarget: boolean) => void;
  path?: { x: number; y: number; action: string; objectType?: string }[] | null; runKey?: string;
}) {
  const [robot, setRobot] = useState(DOCK);
  const [carry, setCarry] = useState<string | null>(null);

  useEffect(() => {
    if (!path?.length) return;
    let cancelled = false;
    (async () => {
      const pts = [...path, { ...DOCK, action: 'dock' }];
      for (const p of pts) {
        if (cancelled) return;
        setRobot({ x: p.x, y: p.y });
        await new Promise((r) => setTimeout(r, 420));
        if (p.action === 'pick') setCarry((p as any).objectType ?? null);
        if (p.action === 'place') setCarry(null);
      }
    })();
    return () => { cancelled = true; };
  }, [runKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <svg viewBox={`0 0 ${W * cell} ${H * cell}`} className="kitchen" style={{ width: W * cell, maxWidth: '100%' }}>
      <rect width={W * cell} height={H * cell} fill="#0a0a0a" />
      {Array.from({ length: W + 1 }, (_, i) => <line key={`v${i}`} x1={i * cell} y1={0} x2={i * cell} y2={H * cell} stroke="#161616" />)}
      {Array.from({ length: H + 1 }, (_, i) => <line key={`h${i}`} x1={0} y1={i * cell} x2={W * cell} y2={i * cell} stroke="#161616" />)}
      <rect x={DOCK.x * cell + 4} y={DOCK.y * cell + 4} width={cell - 8} height={cell - 8} fill="none" stroke="#333" strokeDasharray="4 4" />
      {home.layout.map((o) => {
        const isTarget = TARGET.has(o.type);
        const c = COLORS[o.type] ?? '#ccc';
        return (
          <g key={o.id} transform={`translate(${o.x * cell},${o.y * cell})`} onClick={() => onPick?.(o.type, isTarget)} style={{ cursor: onPick ? 'pointer' : 'default' }}>
            {isTarget
              ? <rect x={2} y={2} width={cell - 4} height={cell - 4} rx={6} fill="#111" stroke={c} strokeWidth={2.5} />
              : <circle cx={cell / 2} cy={cell / 2} r={cell / 3.2} fill={c} opacity={carry === o.type ? 0.15 : 1} />}
            <text x={cell / 2} y={isTarget ? cell / 2 + 4 : cell - 3} className="k-label" fill={isTarget ? c : '#9a9a9a'}>{label(o.type)}</text>
          </g>
        );
      })}
      <g style={{ transform: `translate(${robot.x * cell + cell / 2}px, ${robot.y * cell + cell / 2}px)`, transition: 'transform 400ms ease-in-out' }}>
        <rect x={-cell / 3} y={-cell / 3} width={cell / 1.5} height={cell / 1.5} rx={8} fill="#ff5a1f" />
        <circle cx={-6} cy={-3} r={3} fill="#000" /><circle cx={6} cy={-3} r={3} fill="#000" />
        {carry && <circle cx={cell / 3} cy={-cell / 3} r={8} fill={COLORS[carry] ?? '#fff'} stroke="#000" strokeWidth={2} />}
      </g>
    </svg>
  );
}
