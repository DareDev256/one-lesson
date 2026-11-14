export type Mood = 'confused' | 'calm' | 'happy' | 'bad' | 'refused' | 'ring' | 'offline';

/** A robot head: rounded square, antenna, eyes and mouth by mood. Kids' homes carry a dashed shield and a KIDS HOME pill.
 *  The home being asked grows (focus 'on') while the rest dim; a speaking home shows sound waves. */
export function Face({ x, y, mood, shield, label, sub, bubble, selected, focus, speaking, onClick, onContextMenu }: {
  x: number; y: number; mood: Mood; shield: boolean; label: string; sub: string | null; bubble?: string | null;
  selected?: boolean; focus?: 'on' | 'dim' | null; speaking?: boolean; onClick?: () => void; onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const s = 78;
  const k = focus === 'on' ? 1.4 : 1;
  const stroke = mood === 'bad' ? 'var(--red)' : mood === 'happy' || mood === 'ring' ? 'var(--accent)' : mood === 'offline' ? '#333' : '#d8d8d8';
  const eyeY = -7;
  const headTop = -(s / 2 + 22) * k;
  return (
    <g transform={`translate(${x},${y})`} className={`face mood-${mood} ${focus === 'dim' ? 'dimmed' : ''}`} onClick={onClick} onContextMenu={onContextMenu} style={{ cursor: 'pointer' }}>
      <g className={`head ${focus === 'on' ? 'pop' : ''}`} transform={`scale(${k})`}>
        {shield && <circle r={66} className={`shield ${mood === 'refused' ? 'shield-hit' : ''}`} />}
        {mood === 'ring' && <circle r={48} className="ring-burst" />}
        {mood === 'happy' && <circle r={48} className="happy-burst" />}
        {selected && !focus && <circle r={80} className="selected-ring" />}
        <line x1={0} y1={-s / 2} x2={0} y2={-s / 2 - 16} stroke={stroke} strokeWidth={3.5} />
        <circle cx={0} cy={-s / 2 - 20} r={6} fill={mood === 'happy' || mood === 'ring' ? 'var(--accent)' : mood === 'bad' ? 'var(--red)' : stroke} />
        <rect x={-s / 2} y={-s / 2} width={s} height={s} rx={19} fill="#0b0b0b" stroke={stroke} strokeWidth={mood === 'calm' || mood === 'confused' ? 3 : 4.5} />
        {mood === 'bad' ? (
          <g stroke="var(--red)" strokeWidth={4.5} strokeLinecap="round">
            <line x1={-21} y1={eyeY - 7} x2={-9} y2={eyeY + 5} /><line x1={-9} y1={eyeY - 7} x2={-21} y2={eyeY + 5} />
            <line x1={9} y1={eyeY - 7} x2={21} y2={eyeY + 5} /><line x1={21} y1={eyeY - 7} x2={9} y2={eyeY + 5} />
            <path d="M -14 20 Q 0 10 14 20" fill="none" />
          </g>
        ) : mood === 'happy' || mood === 'ring' ? (
          <g stroke="var(--accent)" strokeWidth={4.5} fill="none" strokeLinecap="round">
            <path d={`M -22 ${eyeY + 3} Q -15 ${eyeY - 8} -8 ${eyeY + 3}`} />
            <path d={`M 8 ${eyeY + 3} Q 15 ${eyeY - 8} 22 ${eyeY + 3}`} />
            <path d="M -16 12 Q 0 27 16 12" />
          </g>
        ) : mood === 'confused' ? (
          <g fill="#d8d8d8">
            <circle cx={-13} cy={eyeY} r={5} /><circle cx={13} cy={eyeY} r={5} />
            <rect x={-10} y={16} width={20} height={4} rx={2} />
            <text x={s / 2 + 2} y={-s / 2 + 4} className="qmark">?</text>
          </g>
        ) : (
          <g fill={mood === 'offline' ? '#333' : '#d8d8d8'}>
            <rect x={-20} y={eyeY - 2} width={12} height={5} rx={2.5} /><rect x={8} y={eyeY - 2} width={12} height={5} rx={2.5} />
            <path d="M -12 16 Q 0 22 12 16" stroke={mood === 'offline' ? '#333' : '#d8d8d8'} strokeWidth={3.5} fill="none" strokeLinecap="round" />
          </g>
        )}
        {speaking && (
          <g className="waves" fill="none" stroke="var(--accent)" strokeWidth={4} strokeLinecap="round">
            <path d={`M ${s / 2 + 10} -12 Q ${s / 2 + 18} 0 ${s / 2 + 10} 12`} />
            <path d={`M ${s / 2 + 20} -20 Q ${s / 2 + 32} 0 ${s / 2 + 20} 20`} />
            <path d={`M ${s / 2 + 30} -28 Q ${s / 2 + 46} 0 ${s / 2 + 30} 28`} />
          </g>
        )}
      </g>
      <text y={(s / 2) * k + 28} className="face-label">{label}</text>
      {shield ? (
        <g transform={`translate(0, ${(s / 2) * k + 40})`}>
          <rect x={-46} y={0} width={92} height={22} rx={11} className="kids-pill" />
          <text y={15.5} className="kids-pill-text">KIDS HOME</text>
        </g>
      ) : sub ? <text y={(s / 2) * k + 48} className="face-sub">{sub}</text> : null}
      {bubble && (
        <foreignObject x={Math.max(-320, 12 - x) + Math.min(0, (1268 - x) - 320)} y={headTop - 62} width={640} height={54}>
          <div className="bubble-wrap"><div className="bubble">{bubble}</div></div>
        </foreignObject>
      )}
    </g>
  );
}
