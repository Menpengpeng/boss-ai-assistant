/**
 * Options 页专用的 background 一次性消息封装。
 * 这里刻意不复用侧栏的 llm-client（那会把聊天面板的 store / React 状态打进 options 包），
 * 只保留最小逻辑：sendMessage → 校验 BgResponse → 非 ok 抛 AppError。
 */
import { AppError, ERROR_TIPS, toAppError } from '../shared/errors';
import { isBgResponse } from '../shared/protocol';
import type { BgRequest } from '../shared/protocol';

/** 发送一次性请求并解包 data；失败时抛出 AppError（含统一错误码）。 */
export async function sendBg<R = unknown>(req: BgRequest): Promise<R> {
  let raw: unknown;
  try {
    raw = await chrome.runtime.sendMessage(req);
  } catch (e) {
    throw toAppError(e);
  }
  if (!isBgResponse(raw)) {
    throw new AppError('UNKNOWN', ERROR_TIPS.UNKNOWN.title);
  }
  if (!raw.ok) {
    throw new AppError(raw.error.code, raw.error.message);
  }
  return raw.data as R;
}
