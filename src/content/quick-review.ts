/**
 * 列表页「AI 快评」功能（F7）。
 *
 * 触发链路：injector 在每张岗位卡片注入 class="boss-ai-quick-btn" 的按钮，
 * 该按钮自身的 click 监听调用了 stopPropagation，冒泡阶段的外部监听收不到事件，
 * 因此这里用 **capture 阶段** 的 document 监听来拦截点击。
 *
 * 约束（与需求一致）：
 * - 同一时间最多 1 个快评请求在途（用 state.quickBusyJobId 做并发闸门）；
 * - 命中 state.quickScores 缓存时直接渲染已有徽标，绝不重复发起请求；
 * - 徽标文案同时输出分数、结论与风险等级文字（等级不得仅靠颜色区分）；
 * - 徽标节点带 data-boss-ai="1"（退出登录 / 切页时被注入器一并清理），
 *   但绝不能带 data-boss-ai-kind="quick"，否则会被误当成注入按钮清理。
 *
 * 注意：本文件以 `import type` 引用 features.ts 的类型（编译期擦除，无运行时代码依赖），
 * 由 features.ts 负责把本对象 push 进 FEATURES，避免运行时循环依赖。
 */
import { guardQuickReview } from '../prompts/guards';
import { AppError, ERROR_TIPS } from '../shared/errors';
import type { JobCard, JobInfo, QuickReview } from '../shared/types';
import { extractJson } from '../shared/validate';
import { scoreTone } from './panel/components';
import { runTask } from './panel/llm-client';
import { actions } from './panel/store';
import { findCardElement, jobInfoFromCard, parseJobList } from './parsers';
import type { ContentFeature, FeatureContext } from './features';

/** 快评按钮类名（与 injector 保持一致）。 */
const QUICK_BTN_CLASS = 'boss-ai-quick-btn';
/** 徽标类名（用于定位与清理）。 */
const BADGE_CLASS = 'boss-ai-quick-score';

/** 徽标基础内联样式（徽标注入站点 DOM，非 Shadow DOM，故不使用 CSS 变量）。 */
const BADGE_BASE = [
  'display:inline-flex',
  'align-items:center',
  'gap:4px',
  'margin:0 0 0 8px',
  'padding:0 10px',
  'min-height:28px',
  'border-radius:14px',
  'font-size:12px',
  'font-weight:600',
  'line-height:1',
  'white-space:nowrap',
].join(';');

/** 分档字面色板：与面板的 scoreTone 分档（ok/warn/err）一一对应。 */
const TONE_STYLE: Record<'ok' | 'warn' | 'err', { bg: string; fg: string }> = {
  ok: { bg: '#E2F5EA', fg: '#146C43' },
  warn: { bg: '#FFF1DB', fg: '#8A4B00' },
  err: { bg: '#FDE8E8', fg: '#9B1C1C' },
};

/** 生成中占位的字面色。 */
const PENDING_STYLE = { bg: '#EAF2F3', fg: '#52666B' };

/** 当前「生成中」占位徽标节点（并发限 1，故只可能有一个）。 */
let pendingNode: HTMLElement | null = null;
/** 是否已挂载（mount 幂等）。 */
let mounted = false;

/** 已评徽标文案：分数 + 结论 + 风险等级（等级必须带文字）。 */
export function quickBadgeText(review: QuickReview): string {
  const parts = [`${review.score} 分`];
  if (review.verdict) parts.push(review.verdict);
  if (review.riskLevel) parts.push(`风险${review.riskLevel}`);
  return parts.join(' · ');
}

/** 应用内联样式。 */
function styleBadge(el: HTMLElement, tone: { bg: string; fg: string }): void {
  el.style.cssText = `${BADGE_BASE};background:${tone.bg};color:${tone.fg}`;
}

/** 创建徽标节点（统一携带 data-boss-ai="1"）。 */
function makeBadge(text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = BADGE_CLASS;
  span.dataset.bossAi = '1';
  span.textContent = text;
  return span;
}

/** 移除当前占位徽标（若存在）。 */
function clearPending(): void {
  if (pendingNode) {
    pendingNode.remove();
    pendingNode = null;
  }
}

/** 在卡片上渲染「生成中」占位徽标。 */
function showPending(card: Element): void {
  card.querySelectorAll(`.${BADGE_CLASS}`).forEach((node) => node.remove());
  const span = makeBadge('快评中…');
  styleBadge(span, PENDING_STYLE);
  card.appendChild(span);
  pendingNode = span;
}

/** 在卡片上渲染已评分数徽标（同一卡片上最多一个徽标）。 */
function renderBadge(card: Element, review: QuickReview): void {
  card.querySelectorAll(`.${BADGE_CLASS}`).forEach((node) => node.remove());
  const span = makeBadge(quickBadgeText(review));
  span.title = 'AI 快评结果';
  styleBadge(span, TONE_STYLE[scoreTone(review.score)]);
  card.appendChild(span);
}

/**
 * 从被点击的快评按钮解析出对应卡片与岗位信息。
 * 按钮由 injector 写入 data-boss-ai-index（等于卡片在列表中的序号），据此定位 JobCard。
 */
function resolveJob(btn: HTMLElement): { card: JobCard; job: JobInfo } | null {
  const indexAttr = btn.getAttribute('data-boss-ai-index');
  const index = indexAttr === null ? Number.NaN : Number(indexAttr);
  if (!Number.isFinite(index)) return null;
  const card = parseJobList().find((it) => it.index === index) ?? null;
  if (!card) return null;
  const job = jobInfoFromCard(card);
  if (!job.id) return null;
  return { card, job };
}

/** 处理快评点击（用户点击触发，唯一会发起模型请求的入口）。 */
async function handleQuickClick(e: MouseEvent): Promise<void> {
  const target = e.target instanceof HTMLElement ? e.target : null;
  const btn = target?.closest<HTMLElement>(`.${QUICK_BTN_CLASS}`) ?? null;
  if (!btn) return;
  e.preventDefault();

  const resolved = resolveJob(btn);
  if (!resolved) return;
  const { card, job } = resolved;

  // 1) 命中缓存：直接渲染已有徽标，不再发起请求
  const current = actions.getState();
  const cached = current.quickScores[job.id];
  if (cached) {
    const cardEl = findCardElement(card);
    if (cardEl) renderBadge(cardEl, cached);
    actions.toast('已使用缓存结果');
    return;
  }

  // 2) 并发限 1：已有在途快评时提示并放弃
  if (current.quickBusyJobId !== null) {
    actions.toast('正在生成上一个岗位的快评，请稍候');
    return;
  }

  // 3) 发起请求
  actions.setState({ quickBusyJobId: job.id });
  const startEl = findCardElement(card);
  if (startEl) showPending(startEl);

  try {
    const raw = await runTask<string>('quickReview', { job }).done;
    const review = guardQuickReview(extractJson(raw));
    if (!review) throw new AppError('BAD_JSON');
    actions.setQuickScore(job.id, review);
    const doneEl = findCardElement(card);
    clearPending();
    if (doneEl) renderBadge(doneEl, review);
  } catch (err) {
    const code = err instanceof AppError ? err.code : 'UNKNOWN';
    // 被中止（切页 / 退出登录）时静默移除占位徽标
    if (code !== 'ABORTED') actions.toast(ERROR_TIPS[code].title);
    clearPending();
  } finally {
    actions.setState({ quickBusyJobId: null });
  }
}

/** capture 阶段监听的稳定回调。 */
function onQuickClick(e: MouseEvent): void {
  void handleQuickClick(e);
}

/** 列表快评功能（F7），由 features.ts 注册进 FEATURES。 */
export const quickReviewFeature: ContentFeature = {
  id: 'quick-review',

  mount(_ctx: FeatureContext): void {
    if (mounted) return;
    mounted = true;
    document.addEventListener('click', onQuickClick, true);
  },

  unmount(): void {
    if (!mounted) return;
    mounted = false;
    document.removeEventListener('click', onQuickClick, true);
    pendingNode = null;
    document.querySelectorAll(`.${BADGE_CLASS}`).forEach((node) => node.remove());
  },
};
