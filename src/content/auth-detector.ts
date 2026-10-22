/**
 * 登录态检测器（F0 门控的第一道防线）。
 *
 * 原则：
 * - 只读 DOM，绝不发出任何网络请求，也不读取 Cookie / localStorage 中的令牌；
 * - AUTH_SELECTORS.loggedIn 命中即视为已登录（优先级最高）；
 * - AUTH_SELECTORS.loginButton 的候选必须是「可点击元素」（a / button / [role=button]）
 *   且可见，避免页面中恰好含「登录」字样的普通文本被误判为未登录；
 * - MutationObserver（document.body）+ 路由变化共同驱动，去抖 LIMITS.authDebounceMs（300ms），
 *   仅当状态字符串真正变化时才回调（相同状态不回调）。
 */
import { LIMITS } from '../shared/constants';
import { AUTH_SELECTORS } from '../shared/selectors';
import type { AuthState } from '../shared/types';
import { onRouteChange } from './observers';

/** 登录态检测器接口。 */
export interface AuthDetector {
  detect(): AuthState;
  start(cb: (state: AuthState) => void): () => void;
  stop(): void;
  getState(): AuthState;
}

/** 元素是否可见：判定标准为存在布局盒（真实浏览器语义）。 */
function isVisible(el: Element): boolean {
  try {
    return el.getClientRects().length > 0;
  } catch {
    return false;
  }
}

/** 元素是否为可点击控件：a / button / [role=button]。 */
function isClickable(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === 'a' || tag === 'button') return true;
  return el.getAttribute('role') === 'button';
}

/**
 * 按候选顺序取首个满足条件的元素。
 * 逐个选择器尝试（而非 qsa 的「首个有命中的选择器」语义），
 * 避免先命中的隐藏节点遮蔽后续选择器里真正可见的节点。
 */
function firstEligible(
  root: ParentNode,
  selectors: string[],
  ok: (el: Element) => boolean,
): Element | null {
  for (const sel of selectors) {
    let list: Element[] = [];
    try {
      list = Array.from(root.querySelectorAll(sel));
    } catch {
      continue; // 非法选择器，跳过并继续尝试
    }
    for (const el of list) {
      if (ok(el)) return el;
    }
  }
  return null;
}

/** 只读 DOM 推断登录态。 */
function detectAuth(root: ParentNode): AuthState {
  const loggedIn = firstEligible(root, AUTH_SELECTORS.loggedIn, isVisible);
  if (loggedIn) return 'logged_in';
  const loginBtn = firstEligible(
    root,
    AUTH_SELECTORS.loginButton,
    (el) => isClickable(el) && isVisible(el),
  );
  if (loginBtn) return 'logged_out';
  return 'unknown';
}

/** 当前检测根节点（优先 body，退化到 document）。 */
function detectRoot(): ParentNode {
  return document.body ?? document;
}

/** 创建登录态检测器。 */
export function createAuthDetector(): AuthDetector {
  let state: AuthState = detectAuth(detectRoot());
  let observer: MutationObserver | null = null;
  let offRoute: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let callback: ((state: AuthState) => void) | null = null;

  /** 去抖后执行一次检测；仅状态变化时回调。 */
  function run(): void {
    const next = detectAuth(detectRoot());
    if (next === state) return;
    state = next;
    callback?.(next);
  }

  /** 登记一次去抖检测。 */
  function schedule(): void {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      run();
    }, LIMITS.authDebounceMs);
  }

  /** 建立观察器与路由订阅（只建立一次）。 */
  function setup(): void {
    if (observer === null) {
      const target: Element = document.body ?? document.documentElement;
      observer = new MutationObserver(() => schedule());
      observer.observe(target, { childList: true, subtree: true, attributes: true });
    }
    if (offRoute === null) {
      offRoute = onRouteChange(() => schedule());
    }
  }

  /** 停止观察并取消路由订阅（幂等）。 */
  function stop(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (offRoute) {
      offRoute();
      offRoute = null;
    }
    callback = null;
  }

  return {
    detect: () => detectAuth(detectRoot()),
    start(cb) {
      callback = cb;
      setup();
      schedule();
      return () => stop();
    },
    stop,
    getState: () => state,
  };
}
