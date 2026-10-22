/** 键值对列表：值为空时显示 fallback（默认「未提供」）。 */
export function KeyValue(p: {
  items: { k: string; v: string }[];
  fallback?: string;
}): JSX.Element {
  const fallback = p.fallback ?? '未提供';
  return (
    <div className="ba-kv">
      {p.items.map((item, i) => (
        <div className="ba-kv-row" key={i}>
          <span className="ba-kv-k">{item.k}</span>
          <span className="ba-kv-v">{item.v && item.v.trim() ? item.v : fallback}</span>
        </div>
      ))}
    </div>
  );
}
