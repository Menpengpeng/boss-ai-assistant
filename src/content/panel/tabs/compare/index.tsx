/**
 * 多岗位对比与收藏标签组（F9）。
 *
 * 契约（不得变更）：路径、导出名（compareStyles / ComparePanel / CompareFooter）与 props（TabProps）。
 * - 对比表按「薪资 / 公司 / 匹配度 / 风险」四维逐行展示，风险维度只使用通过证据校验的条目（由「加入对比」写入）；
 * - 表格容器允许横向滚动，避免撑破 380px 侧栏；
 * - 本标签组不发起模型请求，故无加载 / 错误态。
 */
import { STATE_COPY } from '../../App';
import { Button, CopyButton, EmptyState, IconButton } from '../../components';
import { actions } from '../../store';
import { ICONS } from '../../styles';
import type { TabProps } from '../../types';
import type { CompareItem, JobInfo, RiskItem, RiskLevel } from '../../../../shared/types';

/** 该标签组的增量样式（注入 Shadow DOM；颜色一律用 CSS 变量，保证深色模式可用）。 */
export const compareStyles = `
.ba-cmp-scroll{overflow:auto;max-width:100%}
.ba-cmp-scroll .ba-table{min-width:100%;width:auto}
.ba-cmp-head{display:flex;align-items:flex-start;gap:4px}
.ba-cmp-name{flex:1;min-width:56px;white-space:normal;word-break:break-word}
.ba-cmp-metric{white-space:nowrap}
.ba-cmp-sal{color:var(--salary);font-weight:700}
.ba-cmp-risk{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
.ba-cmp-fav-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.ba-cmp-fav-title{font-weight:600;word-break:break-word}
`;

/** 风险等级 → 徽标样式后缀（对应 baseStyles 的 .ba-badge.h/.m/.l）。 */
function levelClass(level: RiskLevel): 'h' | 'm' | 'l' {
  if (level === '高') return 'h';
  if (level === '中') return 'm';
  return 'l';
}

/** 风险等级权重：用于取最高等级。 */
const RISK_WEIGHT: Record<RiskLevel, number> = { 高: 3, 中: 2, 低: 1 };

/** 一组风险条目中的最高等级；无条目返回 null。 */
export function highestRiskLevel(items: RiskItem[]): RiskLevel | null {
  let best: RiskLevel | null = null;
  for (const item of items ?? []) {
    if (!best || RISK_WEIGHT[item.level] > RISK_WEIGHT[best]) best = item.level;
  }
  return best;
}

/** 风险文案：条数 + 最高等级（等级必须带文字，不能只靠颜色）。 */
export function compareRiskText(items: RiskItem[]): string {
  if (!items || items.length === 0) return '无明显风险';
  return `${items.length} 条 · 最高${highestRiskLevel(items)}`;
}

/** 匹配度文案：未评分时显示「未提供」。 */
export function compareScoreText(score: number | null): string {
  return score === null ? STATE_COPY.empty : String(score);
}

/** 对比摘要纯文本：表头 + 每行「岗位｜薪资｜公司｜匹配度｜风险」；无数据返回空串。 */
export function compareSummaryText(items: CompareItem[]): string {
  if (!items || items.length === 0) return '';
  const header = ['岗位', '薪资', '公司', '匹配度', '风险'].join('｜');
  const rows = items.map((it) =>
    [
      it.job.title || STATE_COPY.empty,
      it.job.salary || STATE_COPY.empty,
      it.job.company || STATE_COPY.empty,
      compareScoreText(it.score),
      compareRiskText(it.red),
    ].join('｜'),
  );
  return [header, ...rows].join('\n');
}

/** 风险单元格：徽标展示最高等级文字 + 条数。 */
function renderRisk(items: RiskItem[]): JSX.Element {
  if (!items || items.length === 0) return <span className="ba-sub">无明显风险</span>;
  const level = highestRiskLevel(items) as RiskLevel;
  return (
    <span className="ba-cmp-risk">
      <span className={`ba-badge ${levelClass(level)}`}>{level}</span>
      <span>{items.length} 条</span>
    </span>
  );
}

/** 对比主体内容。 */
export function ComparePanel(p: TabProps): JSX.Element {
  const { state, host } = p;
  const items = state.compare;

  if (items.length === 0) {
    return (
      <EmptyState
        title="暂无对比岗位"
        body="在职位详情页点击「加入对比」，或在列表页点击「AI 快评」后加入"
      />
    );
  }

  /** 是否已收藏该岗位。 */
  const isFav = (jobId: string): boolean => state.favorites.some((f) => f.jobId === jobId);

  /** 切换收藏并给出 Toast 提示。 */
  const toggleFav = (job: JobInfo): void => {
    void actions.toggleFavorite(job).then((nowFav) => {
      actions.toast(nowFav ? '已收藏' : '已取消收藏');
    });
  };

  return (
    <>
      {state.apiReady === false ? (
        <div className="ba-note">
          <span>尚未配置模型 API Key</span>
          <Button variant="ghost" onClick={() => host?.openOptions('api')}>
            去配置
          </Button>
        </div>
      ) : null}

      <div className="ba-cmp-scroll">
        <table className="ba-table">
          <thead>
            <tr>
              <th scope="col" className="ba-th">
                维度
              </th>
              {items.map((it) => (
                <th scope="col" className="ba-th" key={it.jobId}>
                  <div className="ba-cmp-head">
                    <span className="ba-cmp-name">{it.job.title || STATE_COPY.empty}</span>
                    <IconButton
                      icon={ICONS.trash}
                      label={`移除 ${it.job.title || STATE_COPY.empty}`}
                      onClick={() => actions.removeFromCompare(it.jobId)}
                    />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" className="ba-th ba-cmp-metric">
                薪资
              </th>
              {items.map((it) => (
                <td className="ba-td" key={it.jobId}>
                  <span className="ba-cmp-sal">{it.job.salary || STATE_COPY.empty}</span>
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row" className="ba-th ba-cmp-metric">
                公司
              </th>
              {items.map((it) => (
                <td className="ba-td" key={it.jobId}>
                  {it.job.company || STATE_COPY.empty}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row" className="ba-th ba-cmp-metric">
                匹配度
              </th>
              {items.map((it) => (
                <td className="ba-td" key={it.jobId}>
                  {compareScoreText(it.score)}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row" className="ba-th ba-cmp-metric">
                风险
              </th>
              {items.map((it) => (
                <td className="ba-td" key={it.jobId}>
                  {renderRisk(it.red)}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row" className="ba-th ba-cmp-metric">
                收藏
              </th>
              {items.map((it) => (
                <td className="ba-td" key={it.jobId}>
                  <IconButton
                    icon={ICONS.star}
                    label={
                      isFav(it.jobId)
                        ? `取消收藏 ${it.job.title || STATE_COPY.empty}`
                        : `收藏 ${it.job.title || STATE_COPY.empty}`
                    }
                    active={isFav(it.jobId)}
                    onClick={() => toggleFav(it.job)}
                  />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {state.favorites.length > 0 ? (
        <div className="ba-card">
          <div className="ba-card-title">收藏的岗位（{state.favorites.length}）</div>
          <div className="ba-list">
            {state.favorites.map((fav) => (
              <div className="ba-li" key={fav.jobId}>
                <div className="ba-cmp-fav-main">
                  <div className="ba-cmp-fav-title">{fav.job.title || STATE_COPY.empty}</div>
                  <div className="ba-sub">
                    {(fav.job.company || STATE_COPY.empty)} · {(fav.job.salary || STATE_COPY.empty)}
                  </div>
                </div>
                <IconButton
                  icon={ICONS.star}
                  label={`取消收藏 ${fav.job.title || STATE_COPY.empty}`}
                  active
                  onClick={() => toggleFav(fav.job)}
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

/** 对比底部固定操作栏（App 会包在 .ba-foot 中）。 */
export function CompareFooter(p: TabProps): JSX.Element | null {
  const items = p.state.compare;
  const empty = items.length === 0;

  return (
    <>
      <Button
        variant="ghost"
        disabled={empty}
        onClick={() => {
          items.forEach((it) => actions.removeFromCompare(it.jobId));
          actions.toast('已清空对比');
        }}
      >
        清空对比
      </Button>
      <CopyButton text={compareSummaryText(items)} label="复制对比摘要" />
    </>
  );
}
