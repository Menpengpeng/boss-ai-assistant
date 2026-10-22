/**
 * 自定义接口域名的权限校验（F1）。
 *
 * 【重要说明】content script 无权调用 chrome.permissions.request，且 background 在没有
 * 用户手势（user gesture）的情况下也无法弹出授权框。因此本模块只做「检查」：
 * - background 侧的 perm:ensure 仅返回是否已授权，不发起任何弹窗；
 * - 真正的动态授权由设置页在用户点击时调用 chrome.permissions.request（Task 11 负责）。
 */
import { AppError } from '../shared/errors';
import { originOf } from './llm';

/** 权限匹配模式：origins 需形如 https://api.example.com/*。 */
function patternOf(origin: string): string {
  return `${origin}/*`;
}

/** 该 URL 所属源是否已获得 host 权限。 */
export async function isOriginGranted(url: string): Promise<boolean> {
  const origin = originOf(url);
  if (!origin) return false;
  try {
    return await chrome.permissions.contains({ origins: [patternOf(origin)] });
  } catch {
    return false;
  }
}

/** 未授权时抛 AppError('NO_PERMISSION')，用于所有外部请求前的门控。 */
export async function assertOriginAllowed(url: string): Promise<void> {
  if (!(await isOriginGranted(url))) {
    throw new AppError('NO_PERMISSION');
  }
}

/** 检查权限并给出是否需要用户手势才能完成授权（background 无法自行弹窗）。 */
export async function checkPermission(
  url: string,
): Promise<{ granted: boolean; origin: string; needsUserGesture: boolean }> {
  const origin = originOf(url);
  const granted = await isOriginGranted(url);
  return { granted, origin, needsUserGesture: !granted };
}
