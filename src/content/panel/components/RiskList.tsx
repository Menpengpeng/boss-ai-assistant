import type { RiskItem } from '../../../shared/types';

/** 风险等级 → 样式后缀。 */
function levelClass(level: RiskItem['level']): 'h' | 'm' | 'l' {
  if (level === '高') return 'h';
  if (level === '中') return 'm';
  return 'l';
}

/**
 * 风险信号列表：等级必须显示文字「低 / 中 / 高」（不只靠颜色），并展示类型、结论与原文依据。
 * dropped > 0 时提示被证据子串校验丢弃的条数。
 */
export function RiskList(p: {
  items: RiskItem[];
  dropped?: number;
  emptyText?: string;
}): JSX.Element {
  const dropped = p.dropped ?? 0;
  return (
    <div className="ba-list">
      {p.items.length === 0 ? (
        <div className="ba-sub">{p.emptyText ?? '未发现明显风险信号'}</div>
      ) : (
        p.items.map((item, i) => (
          <div className={`ba-risk ba-risk-${levelClass(item.level)}`} key={i}>
            <div className="ba-risk-type">
              <span className={`ba-badge ${levelClass(item.level)}`}>{item.level}</span>
              <span>{item.type}</span>
            </div>
            <div className="ba-sub">{item.conclusion}</div>
            <div className="ba-risk-ev">
              原文依据：{item.evidence}（来源：{item.src}）
            </div>
          </div>
        ))
      )}
      {dropped > 0 ? (
        <div className="ba-note">已丢弃 {dropped} 条无法在原文中定位的风险</div>
      ) : null}
    </div>
  );
}
