/**
 * 本地日志（环形裁剪到 LIMITS.logCap 条）。
 * 硬性要求：写入前必须脱敏 —— API Key（sk- 前缀 / x-api-key / 长 base64·hex 串）
 * 与手机号、邮箱一律替换为 ***，Key 绝不落盘。
 * 仅依赖 chrome.storage，可被 content / background / options 使用。
 */
import { LIMITS, STORAGE_KEYS } from './constants';
import type { LogEntry } from './types';

/** 脱敏：密钥 + 手机号 + 邮箱。 */
function redact(text: string): string {
  let out = String(text ?? '');
  out = out.replace(/sk-[A-Za-z0-9_-]{6,}/g, '***');
  out = out.replace(/(["?]?x-api-key"?\s*[:=]\s*"?)([A-Za-z0-9\-._]{6,})/gi, '$1***');
  out = out.replace(/[A-Za-z0-9+/=_-]{24,}/g, '***');
  out = out.replace(/1[3-9]\d{9}/g, '***');
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '***');
  return out;
}

/** 安全序列化附加数据。 */
function safeSerialize(data: unknown): string {
  if (data === undefined || data === null) return '';
  if (typeof data === 'string') return data;
  try {
    return JSON.stringify(data) ?? '';
  } catch {
    return String(data);
  }
}

/** 读取当前日志列表。 */
async function readLogs(): Promise<LogEntry[]> {
  const result = (await chrome.storage.local.get(STORAGE_KEYS.logs)) as Record<string, unknown>;
  const list = result[STORAGE_KEYS.logs];
  return Array.isArray(list) ? (list as LogEntry[]) : [];
}

/** 追加一条日志（最新在前，超出上限裁剪）。 */
async function push(level: LogEntry['level'], msg: string, data?: unknown): Promise<void> {
  const extra = safeSerialize(data);
  const line = redact(extra ? `${msg} ${extra}` : msg);
  const entry: LogEntry = { at: Date.now(), level, msg: line };
  const list = await readLogs();
  list.unshift(entry);
  await chrome.storage.local.set({ [STORAGE_KEYS.logs]: list.slice(0, LIMITS.logCap) });
}

/** 写 info 日志。 */
export async function logInfo(msg: string, data?: unknown): Promise<void> {
  await push('info', msg, data);
}

/** 写 warn 日志。 */
export async function logWarn(msg: string, data?: unknown): Promise<void> {
  await push('warn', msg, data);
}

/** 写 error 日志。 */
export async function logError(msg: string, data?: unknown): Promise<void> {
  await push('error', msg, data);
}

/** 读取全部日志（最新在前）。 */
export async function getLogs(): Promise<LogEntry[]> {
  return readLogs();
}

/** 清空日志。 */
export async function clearLogs(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.logs);
}
