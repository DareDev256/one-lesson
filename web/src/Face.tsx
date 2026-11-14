export type Mood = 'confused' | 'calm' | 'happy' | 'bad' | 'refused' | 'ring' | 'offline';

/** A robot head: rounded square, antenna, eyes and mouth by mood. Kids' homes carry a dashed shield. */
export function Face({ x, y, mood, shield, label, sub, bubble, selected, onClick, onContextMenu }: {
  x: number; y: number; mood: Mood; shield: boolean; label: string; sub: string; bubble?: string | null;
  selected?: boolean; onClick?: () => void; onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const s = 64;
  const stroke = mood === 'bad' ? 'var(--red)' : mood === 'happy' || mood === 'ring' ? 'var(--accent)' : mood === 'offline' ? '#333' : '#d8d8d8';
  const eyeY = -6;
  return (
    <g transform={`translate(${x},${y})`} className={`face mood-${mood}`} onClick={onClick} onContextMenu={onContextMenu} style={{ cursor: 'pointer' }}>
      {shield && <circle r={58} className={`shield ${mood === 'refused' ? 'shield-hit' : ''}`} />}
      {mood === 'ring' && <circle r={40} className="ring-burst" />}
      {mood === 'happy' && <circle r={40} className="happy-burst" />}
      {selected && <circle r={70} className="selected-ring" />}
      <line x1={0} y1={-s / 2} x2={0} y2={-s / 2 - 14} stroke={stroke} strokeWidth={3} />
      <circle cx={0} cy={-s / 2 - 17} r={5} fill={mood === 'happy' || mood === 'ring' ? 'var(--accent)' : mood === 'bad' ? 'var(--red)' : stroke} />
      <rect x={-s / 2} y={-s / 2} width={s} height={s} rx={16} fill="#0b0b0b" stroke={stroke} strokeWidth={mood === 'calm' || mood === 'confused' ? 2.5 : 4} />
      {mood === 'bad' ? (
        <g stroke="var(--red)" strokeWidth={4} strokeLinecap="round">
          <line x1={-17} y1={eyeY - 6} x2={-7} y2={eyeY + 4} /><line x1={-7} y1={eyeY - 6} x2={-17} y2={eyeY + 4} />
          <line x1={7} y1={eyeY - 6} x2={17} y2={eyeY + 4} /><line x1={17} y1={eyeY - 6} x2={7} y2={eyeY + 4} />
          <path d="M -12 16 Q 0 8 12 16" fill="none" />
        </g>
      ) : mood === 'happy' || mood === 'ring' ? (
        <g stroke="var(--accent)" strokeWidth={4} fill="none" strokeLinecap="round">
          <path d={`M -18 ${eyeY + 2} Q -12 ${eyeY - 7} -6 ${eyeY + 2}`} />
          <path d={`M 6 ${eyeY + 2} Q 12 ${eyeY - 7} 18 ${eyeY + 2}`} />
          <path d="M -13 10 Q 0 22 13 10" />
        </g>
      ) : mood === 'confused' ? (
        <g fill="#d8d8d8">
          <circle cx={-11} cy={eyeY} r={4} /><circle cx={11} cy={eyeY} r={4} />
          <rect x={-8} y={13} width={16} height={3} rx={1.5} />
          <text x={s / 2 - 2} y={-s / 2 + 2} className="qmark">?</text>
        </g>
      ) : (
        <g fill={mood === 'offline' ? '#333' : '#d8d8d8'}>
          <rect x={-16} y={eyeY - 2} width={10} height={4} rx={2} /><rect x={6} y={eyeY - 2} width={10} height={4} rx={2} />
          <path d="M -10 13 Q 0 18 10 13" stroke={mood === 'offline' ? '#333' : '#d8d8d8'} strokeWidth={3} fill="none" strokeLinecap="round" />
        </g>
      )}
      <text y={s / 2 + 24} className="face-label">{label}</text>
      <text y={s / 2 + 42} className="face-sub">{sub}</text>
      {bubble && (
        <g transform={`translate(0, ${-s / 2 - 40})`}>
          <foreignObject x={-150} y={-74} width={300} height={70}>
            <div className="bubble">{bubble}</div>
          </foreignObject>
        </g>
      )}
    </g>
  );
}
