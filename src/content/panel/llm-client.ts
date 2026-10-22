/**
 * Content ↔ Background 流式客户端。
 *
 * - 使用 chrome.runtime.connect({ name: BG_PORT_NAME }) 建立长连接；
 * - 每条任务用 makeRequestId() 生成 requestId，消息严格按 shared/protocol 的
 *   StreamClientMsg / StreamServerMsg 收发；
 * - 端口断开（disconnected）时把全部在途任务以 NETWORK 失败结束，绝不允许永久 pending；
 * - 所有任务句柄登记到 store 的 registerAbort / clearAbort，便于页面切换时统一中止。
 */
import { AppError, ERROR_TIPS, toAppError } from '../../shared/errors';
import type { ErrorCode } from '../../shared/errors';
import { BG_PORT_NAME, isBgResponse, makeRequestId } from '../../shared/protocol';
import type {
  BgRequest,
  LLMPayload,
  StreamClientMsg,
  StreamServerMsg,
} from '../../shared/protocol';
import type { LLMTask } from '../../shared/types';
import { clearAbort, registerAbort } from './store';

/** 任务句柄。 */
export interface TaskHandle<T> {
  abort(): void;
  done: Promise<T>;
}

/** 流式回调。 */
export interface RunOptions {
  onDelta?: (text: string) => void;
  onDone?: (full: string) => void;
  onError?: (e: { code: ErrorCode; message: string }) => void;
  /** 为 true 时跳过缓存（「重新生成」用）。 */
  force?: boolean;
}

interface PendingTask {
  text: string;
  opts: RunOptions;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

let port: chrome.runtime.Port | null = null;

const pending = new Map<string, PendingTask>();

/** 建立（或复用）长连接。 */
function ensurePort(): chrome.runtime.Port {
  if (port) return port;
  const next = chrome.runtime.connect({ name: BG_PORT_NAME });
  next.onMessage.addListener((msg: unknown) => {
    handleMessage(msg as StreamServerMsg);
  });
  next.onDisconnect.addListener(() => {
    handleDisconnect();
  });
  port = next;
  return next;
}

/** 安全发送（端口可能已断开）。 */
function safePost(target: chrome.runtime.Port | null, msg: StreamClientMsg): void {
  if (!target) return;
  try {
    target.postMessage(msg);
  } catch {
    /* 端口已失效，交由 onDisconnect 统一处理 */
  }
}

/** 结束一条任务（成功或失败）。 */
function settle(requestId: string): PendingTask | null {
  const entry = pending.get(requestId);
  if (!entry) return null;
  pending.delete(requestId);
  clearAbort(requestId);
  return entry;
}

/** 处理服务端消息。 */
function handleMessage(msg: StreamServerMsg): void {
  if (!msg || typeof msg !== 'object') return;
  const requestId = (msg as { requestId?: unknown }).requestId;
  if (typeof requestId !== 'string') return;
  const entry = pending.get(requestId);
  if (!entry) return;

  if (msg.type === 'delta') {
    entry.text += msg.text;
    entry.opts.onDelta?.(msg.text);
    return;
  }

  const done = settle(requestId);
  if (!done) return;

  if (msg.type === 'done') {
    done.opts.onDone?.(msg.text);
    done.resolve(msg.text);
    return;
  }

  const err = { code: msg.code, message: msg.message };
  done.opts.onError?.(err);
  done.reject(new AppError(msg.code, msg.message));
}

/** 端口断开：全部在途任务以 NETWORK 结束。 */
function handleDisconnect(): void {
  port = null;
  const ids = Array.from(pending.keys());
  ids.forEach((requestId) => {
    const entry = settle(requestId);
    if (!entry) return;
    const err = { code: 'NETWORK' as ErrorCode, message: ERROR_TIPS.NETWORK.title };
    entry.opts.onError?.(err);
    entry.reject(new AppError('NETWORK', ERROR_TIPS.NETWORK.title));
  });
}

/** 主动中止单条任务：发 abort 消息并让 done reject 为 ABORTED。 */
function abortInternal(requestId: string): void {
  const entry = pending.get(requestId);
  if (!entry) return;
  pending.delete(requestId);
  clearAbort(requestId);
  safePost(port, { type: 'abort', requestId });
  entry.reject(new AppError('ABORTED', ERROR_TIPS.ABORTED.title));
}

/** 发起一次流式任务。 */
export function runTask<T = unknown>(
  task: LLMTask,
  payload: LLMPayload,
  opts: RunOptions = {},
): TaskHandle<T> {
  const requestId = makeRequestId();
  let resolveFn: (value: T) => void = () => undefined;
  let rejectFn: (reason: unknown) => void = () => undefined;
  const done = new Promise<T>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  let target: chrome.runtime.Port;
  try {
    target = ensurePort();
  } catch (e) {
    rejectFn(toAppError(e));
    return { abort: () => undefined, done };
  }

  const entry: PendingTask = {
    text: '',
    opts,
    resolve: (value) => resolveFn(value as T),
    reject: rejectFn,
  };
  pending.set(requestId, entry);
  const abort = (): void => abortInternal(requestId);
  registerAbort(requestId, abort);

  const startMsg: StreamClientMsg = {
    type: 'start',
    requestId,
    task,
    payload,
    ...(opts.force ? { force: true } : {}),
  };
  safePost(target, startMsg);

  return { abort, done };
}

/** 中止全部在途任务并断开端口。 */
export function abortAllTasks(): void {
  const ids = Array.from(pending.keys());
  ids.forEach((requestId) => abortInternal(requestId));
  if (port) {
    try {
      port.disconnect();
    } catch {
      /* 忽略 */
    }
    port = null;
  }
}

/** 一次性消息封装：非 ok 时抛 AppError。 */
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

/** 测试连接（最小请求）；返回延迟毫秒或错误码。 */
export async function testConnection(): Promise<
  { ok: true; ms: number } | { ok: false; code: ErrorCode; message: string }
> {
  try {
    const data = await sendBg<{ ms?: number; latencyMs?: number }>({
      type: 'llm:test',
      payload: {},
    });
    const ms =
      typeof data?.ms === 'number' ? data.ms : typeof data?.latencyMs === 'number' ? data.latencyMs : 0;
    return { ok: true, ms };
  } catch (e) {
    const err = toAppError(e);
    return { ok: false, code: err.code, message: err.message };
  }
}

/** 申请访问指定接口域名的权限（由 background 执行 chrome.permissions.request）。 */
export async function ensurePermission(origin: string): Promise<boolean> {
  try {
    await sendBg({ type: 'perm:ensure', payload: { baseUrl: origin } });
    return true;
  } catch {
    return false;
  }
}
