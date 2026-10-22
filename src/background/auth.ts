/**
 * 登录态二次校验（F0）。
 * - 登录态只由 content script 依据页面 DOM 推断，background 无法直接读取页面；
 * - 因此每次流式请求前，background 都会向来源标签页的 content script 发起一次
 *   AUTH_QUERY 查询（1.5 秒超时），非 logged_in 一律拒绝请求；
 * - chrome.tabs.sendMessage 不需要额外的 tabs 权限（已有 zhipin 的 host_permissions 即可）。
 */
import { AppError } from '../shared/errors';
import { logInfo } from '../shared/log';
import { AUTH_QUERY } from '../shared/protocol';
import type { AuthState } from '../shared/types';

/** 查询超时时间（毫秒）。 */
const QUERY_TIMEOUT_MS = 1500;

/** 最近一次各标签页上报的登录态（仅供审计/日志，不参与门控判断）。 */
const lastAuth = new Map<number, AuthState>();

/** 判断任意值是否为合法 AuthState。 */
function asAuthState(v: unknown): AuthState {
  return v === 'logged_in' || v === 'logged_out' || v === 'unknown' ? v : 'unknown';
}

/** 缓存最近一次上报（供审计/日志使用）。 */
export function setTabAuth(tabId: number, auth: AuthState): void {
  lastAuth.set(tabId, auth);
  void logInfo('[auth] 登录态上报', { tabId, auth });
}

/** 读取缓存的上报值（不存在时返回 'unknown'）。 */
export function getLastTabAuth(tabId: number): AuthState {
  return lastAuth.get(tabId) ?? 'unknown';
}

/**
 * 向指定标签页的 content script 查询登录态。
 * 容错：无 content script / 页面正在导航 / 超时 一律返回 'unknown'，绝不向调用方抛异常。
 */
export async function queryTabAuth(tabId: number): Promise<AuthState> {
  if (typeof tabId !== 'number') return 'unknown';
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), QUERY_TIMEOUT_MS);
    });
    const response = (await Promise.race([
      chrome.tabs.sendMessage(tabId, { type: AUTH_QUERY }),
      timeout,
    ])) as { auth?: unknown } | undefined;
    return asAuthState(response?.auth);
  } catch {
    return 'unknown';
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/** 断言当前标签页处于已登录状态；否则抛 AppError('NOT_LOGGED_IN')。 */
export async function assertLoggedIn(tabId: number | undefined): Promise<void> {
  const auth = typeof tabId === 'number' ? await queryTabAuth(tabId) : 'unknown';
  if (auth !== 'logged_in') {
    throw new AppError('NOT_LOGGED_IN');
  }
}
