/**
 * 页面控件注入器（F0 门控 + F3 详情「AI 分析」 + F7 列表「AI 快评」）。
 *
 * 门控规则（硬验收）：
 * - auth !== 'logged_in' 时移除全部注入控件，只保留侧栏悬浮入口（由 mountPanel 提供）；
 * - jobDetail + logged_in → 注入详情页「AI 分析」按钮（id=boss-ai-detail-btn）；
 * - jobList + logged_in → 为每张卡片注入「AI 快评」按钮（class=boss-ai-quick-btn）；
 * - chat → 不注入任何按钮（聊天能力在侧栏内）。
 *
 * 其它约束：
 * - apply() 幂等：重复调用不产生重复按钮；
 * - clear() 只移除自己注入的节点，绝不改动站点原有 DOM；
 * - 所有注入节点都带 data-boss-ai="1"，便于测试与清理；
 * - 点击只回调 deps，绝不发请求。
 */
import { LIST_SELECTORS, qsa } from '../shared/selectors';
import type { AuthState, PageKind } from '../shared/types';

/** 详情页锚点候选：优先插到按钮容器附近，取不到时兜底插入 body。 */
const DETAIL_ANCHORS: string[] = [
  '.job-detail-box .btn-container',
  '.job-detail .btn-container',
  '[class*="job-detail"] [class*="btn"]',
  '.job-primary .info-primary',
  '.job-primary',
  '.job-detail-box',
  '.job-detail',
];

/** 详情按钮 id（幂等判重使用）。 */
const DETAIL_BTN_ID = 'boss-ai-detail-btn';
/** 快评按钮类名。 */
const QUICK_BTN_CLASS = 'boss-ai-quick-btn';

/** 注入器依赖：登录态 / 页面类型查询 + 两个用户点击回调。 */
export interface InjectorDeps {
  getAuth(): AuthState;
  getPageKind(): PageKind;
  /** 详情页「AI 分析」按钮点击（只回调，不请求）。 */
  onRequestAnalysis(): void;
  /** 列表卡片「AI 快评」按钮点击（只回调，不请求）。 */
  onRequestQuickReview(card: Element, index: number): void;
}

/** 注入器句柄。 */
export interface Injector {
  apply(kind: PageKind, auth: AuthState): void;
  clear(kind?: PageKind): void;
  dispose(): void;
}

/** 按钮内联样式（不引入任何 .css 文件）。 */
function styleButton(btn: HTMLElement, solid: boolean): void {
  btn.style.cssText = [
    'display:inline-flex',
    'align-items:center',
    'gap:4px',
    'margin:0 0 0 8px',
    'padding:0 12px',
    'min-height:32px',
    'border-radius:16px',
    'font-size:12px',
    'font-weight:600',
    'line-height:1',
    'cursor:pointer',
    solid
      ? 'background:#0B7074;color:#ffffff;border:1px solid transparent'
      : 'background:#ffffff;color:#0B7074;border:1px solid #0B7074',
  ].join(';');
}

/** 移除符合选择器的注入节点。 */
function removeNodes(selector: string): void {
  document.querySelectorAll(selector).forEach((node) => node.remove());
}

/** 创建详情页「AI 分析」按钮。 */
function makeDetailButton(onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.id = DETAIL_BTN_ID;
  btn.type = 'button';
  btn.className = 'boss-ai-detail-btn';
  btn.dataset.bossAi = '1';
  btn.dataset.bossAiKind = 'detail';
  btn.setAttribute('aria-label', '用 AI 分析当前岗位');
  btn.textContent = 'AI 分析';
  styleButton(btn, true);
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return btn;
}

/** 创建列表卡片「AI 快评」按钮。 */
function makeQuickButton(index: number, onView: (btn: HTMLButtonElement) => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = QUICK_BTN_CLASS;
  btn.dataset.bossAi = '1';
  btn.dataset.bossAiKind = 'quick';
  btn.dataset.bossAiIndex = String(index);
  btn.setAttribute('aria-label', `AI 快评：第 ${index + 1} 个岗位`);
  btn.textContent = 'AI 快评';
  styleButton(btn, false);
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onView(btn);
  });
  return btn;
}

/** 创建注入器。 */
export function createInjector(deps: InjectorDeps): Injector {
  /** 详情页按钮：存在即跳过（幂等）。 */
  function ensureDetailButton(): void {
    if (document.getElementById(DETAIL_BTN_ID)) return;
    const btn = makeDetailButton(() => deps.onRequestAnalysis());
    const anchor =
      DETAIL_ANCHORS.map((sel) => {
        try {
          return document.querySelector(sel);
        } catch {
          return null;
        }
      }).find((el): el is Element => el !== null) ?? (document.body as Element | null);
    if (anchor) anchor.appendChild(btn);
    else document.documentElement.appendChild(btn);
  }

  /** 列表快评按钮：卡片已有时跳过；宿主卡片消失的按钮清理掉（幂等）。 */
  function ensureQuickButtons(): void {
    const cards = qsa<Element>(document, LIST_SELECTORS.card);
    const live = new Set<Element>(cards);
    const existing = Array.from(document.querySelectorAll<HTMLButtonElement>(`.${QUICK_BTN_CLASS}`));
    existing.forEach((btn) => {
      const card = btn.parentElement;
      if (!card || !live.has(card)) btn.remove();
    });
    cards.forEach((card, index) => {
      if (card.querySelector(`.${QUICK_BTN_CLASS}`)) return;
      card.appendChild(
        makeQuickButton(index, (btn) => {
          const host = btn.parentElement;
          const idx = Number(btn.dataset.bossAiIndex ?? index);
          if (host) deps.onRequestQuickReview(host, idx);
        }),
      );
    });
  }

  return {
    apply(kind, auth) {
      // 门控红线：非登录态一律不留任何功能控件
      if (auth !== 'logged_in') {
        removeNodes('[data-boss-ai]');
        return;
      }
      if (kind === 'jobDetail') {
        removeNodes('[data-boss-ai-kind="quick"]');
        ensureDetailButton();
        return;
      }
      if (kind === 'jobList') {
        removeNodes('[data-boss-ai-kind="detail"]');
        ensureQuickButtons();
        return;
      }
      // chat / other：不注入任何按钮（聊天能力在侧栏内）
      removeNodes('[data-boss-ai]');
    },

    clear(kind) {
      if (kind === undefined) {
        removeNodes('[data-boss-ai]');
        return;
      }
      if (kind === 'jobDetail') {
        removeNodes('[data-boss-ai-kind="detail"]');
        return;
      }
      if (kind === 'jobList') {
        removeNodes('[data-boss-ai-kind="quick"]');
        return;
      }
      // chat / other 无注入控件，不做任何改动
    },

    dispose() {
      removeNodes('[data-boss-ai]');
    },
  };
}
