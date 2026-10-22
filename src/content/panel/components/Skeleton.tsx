/** 加载骨架屏：aria-busy 标记加载中，行数可配置。 */
export function Skeleton(p: { lines?: number; label?: string }): JSX.Element {
  const lines = Math.max(1, p.lines ?? 3);
  return (
    <div className="ba-skel" aria-busy="true" aria-live="polite" aria-label={p.label ?? '加载中'}>
      {Array.from({ length: lines }, (_, i) => (
        <div
          className="ba-skel-line"
          key={i}
          style={{ width: i === lines - 1 ? '60%' : '100%' }}
        />
      ))}
    </div>
  );
}
