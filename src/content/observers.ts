/**
 * SPA 页面观察器：路由变化 / DOM 变化 / 聊天变化。
 *
 * 设计要点：
 * - 路由变化 = popstate + hashchange + 定时 URL 比对，去抖 300ms，相同 URL 不重复回调。
 * - MutationObserver 监听 document.body（childList + subtree），多次变更合并为一次去抖回调；
 *   回调内调用 takeRecords() 清空队列，避免自触发导致的无限循环。
 * - 同一 key 复用同一个 MutationObserver（模块内 Map 登记），避免重复创建。
 * - 所有订阅函数返回的取消函数都会真正 disconnect() 并移除监听，防止切页/关闭侧栏泄漏。
 */
import type { PageKind } from '../shared/types';
import { CHAT_SELECTORS, qs } from '../shared/selectors';
import { detectPageKind } from './parsers';

/** 路由去抖（与 LIMITS.authDebounceMs 同量级）。 */
const ROUTE_DEBOUNCE_MS = 300;
/** 默认 DOM 变化去抖。 */
const DEFAULT_DEBOUNCE_MS = 300;
/** 定时 URL 比对间隔（SPA 用 pushState 时不派发 popstate，需轮询兜底）。 */
const ROUTE_POLL_MS = 500;

interface MutationEntry {
  cb: () => void;
  debounceMs: number;
  timer: ReturnType<typeof setTimeout> | null;
}

interface MutationHub {
  observer: MutationObserver;
  entries: Set<MutationEntry>;
}

/** key → hub：同一 key 复用同一个 MutationObserver。 */
const HUBS = new Map<string, MutationHub>();

/** 去抖触发一个订阅者的回调。 */
function flush(entry: MutationEntry): void {
  if (entry.timer !== null) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    entry.timer = null;
    entry.cb();
  }, entry.debounceMs);
}

/** 取（或创建）指定 key 的 observer hub。 */
function ensureHub(key: string, target: Element): MutationHub {
  const existing = HUBS.get(key);
  if (existing) return existing;

  const entries = new Set<MutationEntry>();
  const observer = new MutationObserver(() => {
    // 清空待处理队列，避免回调内再次触发监视造成的无限循环
    observer.takeRecords();
    entries.forEach(flush);
  });
  observer.observe(target, { childList: true, subtree: true });

  const hub: MutationHub = { observer, entries };
  HUBS.set(key, hub);
  return hub;
}

/** 通用订阅：返回真正移除监听/断开观察的取消函数。 */
function subscribe(key: string, target: Element, cb: () => void, debounceMs: number): () => void {
  const hub = ensureHub(key, target);
  const entry: MutationEntry = { cb, debounceMs, timer: null };
  hub.entries.add(entry);

  return () => {
    hub.entries.delete(entry);
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    if (hub.entries.size === 0) {
      hub.observer.disconnect();
      HUBS.delete(key);
    }
  };
}

/**
 * 订阅 SPA 路由变化；返回取消订阅函数。
 * 相同 URL 不重复回调；URL 变化时回调一次 (kind, url)。
 */
export function onRouteChange(cb: (kind: PageKind, url: string) => void): () => void {
  let lastUrl = location.href;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const check = (): void => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    cb(detectPageKind(lastUrl), lastUrl);
  };

  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      check();
    }, ROUTE_DEBOUNCE_MS);
  };

  window.addEventListener('popstate', schedule);
  window.addEventListener('hashchange', schedule);
  const interval = setInterval(schedule, ROUTE_POLL_MS);

  return () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    clearInterval(interval);
    window.removeEventListener('popstate', schedule);
    window.removeEventListener('hashchange', schedule);
  };
}

/** 订阅指定页面类型的 DOM 变化（去抖合并）；返回取消订阅函数。 */
export function onPageMutation(
  kind: PageKind,
  cb: () => void,
  debounceMs: number = DEFAULT_DEBOUNCE_MS,
): () => void {
  const target: Element = document.body ?? document.documentElement;
  return subscribe(`page:${kind}`, target, cb, debounceMs);
}

/** 订阅聊天列表的 DOM 变化（去抖合并）；返回取消订阅函数。 */
export function onChatMutation(
  cb: () => void,
  debounceMs: number = DEFAULT_DEBOUNCE_MS,
): () => void {
  const item = qs<Element>(document, CHAT_SELECTORS.listItem);
  const target: Element = item?.parentElement ?? item ?? document.body ?? document.documentElement;
  return subscribe('chat:list', target, cb, debounceMs);
}

/** 等待下一帧（requestAnimationFrame；不可用时退化为 setTimeout 0）。 */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(() => resolve(), 0);
  });
}
