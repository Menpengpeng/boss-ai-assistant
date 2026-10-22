/** 评分分档：≥70 绿 / 50–69 琥珀 / <50 红。 */
export function scoreTone(score: number): 'ok' | 'warn' | 'err' {
  if (score >= 70) return 'ok';
  if (score >= 50) return 'warn';
  return 'err';
}

/** 分档 → 颜色 Token。 */
function toneColor(tone: 'ok' | 'warn' | 'err'): string {
  if (tone === 'ok') return 'var(--ok)';
  if (tone === 'warn') return 'var(--warn)';
  return 'var(--err)';
}

/**
 * 评分环：SVG stroke-dasharray 画环，同时显示数字（不只靠颜色区分）。
 */
export function ScoreRing(p: { score: number; size?: number; label?: string }): JSX.Element {
  const size = p.size ?? 84;
  const stroke = 8;
  const r = size / 2 - stroke;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, p.score));
  const dash = (c * clamped) / 100;
  const color = toneColor(scoreTone(p.score));
  const center = size / 2;
  return (
    <div className="ba-ring" role="img" aria-label={p.label ?? `评分 ${p.score} 分`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={center} cy={center} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle
          cx={center}
          cy={center}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          transform={`rotate(-90 ${center} ${center})`}
        />
      </svg>
      <span className="ba-score">{p.score}</span>
    </div>
  );
}

/** 分档对应的语义色（供其它组件复用）。 */
export function toneVar(score: number): string {
  return toneColor(scoreTone(score));
}
