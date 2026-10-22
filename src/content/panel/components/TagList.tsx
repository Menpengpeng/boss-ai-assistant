/** 标签列表：空时显示「未提供」。 */
export function TagList(p: { tags: string[] }): JSX.Element {
  return (
    <div className="ba-tag-list">
      {p.tags.length === 0 ? (
        <span className="ba-sub">未提供</span>
      ) : (
        p.tags.map((tag, i) => (
          <span className="ba-tag" key={i}>
            {tag}
          </span>
        ))
      )}
    </div>
  );
}
