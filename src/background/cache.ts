/**
 * 结果缓存（chunk 级去重）。
 * Key = sha256(task + jd + resumeVersion + model + promptVersion) 前 32 位；存于 chrome.storage.local，
 * 条目形如 { at, value }；总量超过 CACHE_MAX 时按 at 淘汰最旧。
 */
import { cacheKey } from '../shared/cache-key';
import { STORAGE_KEYS } from '../shared/constants';
import { isPlainObject } from '../shared/validate';
import type { JobInfo, LLMTask } from '../shared/types';
import { PROMPT_VERSION } from '../prompts';

/** 缓存条目上限（LIMITS 未定义缓存上限，此处使用本地常量）。 */
export const CACHE_MAX = 200;

/** 取岗位 JD 文本（各行以换行拼接）。 */
export function jdOf(job: JobInfo): string {
  return Array.isArray(job?.jd) ? job.jd.join('\n') : '';
}

/** 计算缓存 Key。 */
async function keyOf(
  task: LLMTask,
  job: JobInfo,
  resumeVersion: number,
  model: string,
): Promise<string> {
  return cacheKey({
    task,
    jd: jdOf(job),
    resumeVersion,
    model,
    promptVersion: PROMPT_VERSION,
  });
}

/** 读取缓存值；未命中返回 null。 */
export async function readCache<T>(
  task: LLMTask,
  job: JobInfo,
  resumeVersion: number,
  model: string,
): Promise<T | null> {
  const key = STORAGE_KEYS.cachePrefix + (await keyOf(task, job, resumeVersion, model));
  const stored = (await chrome.storage.local.get(key)) as Record<string, unknown>;
  const entry = stored[key];
  if (!isPlainObject(entry) || !('value' in entry)) return null;
  return entry.value as T;
}

/** 写入缓存值并裁剪超出上限的最旧条目。 */
export async function writeCache(
  task: LLMTask,
  job: JobInfo,
  resumeVersion: number,
  model: string,
  value: unknown,
): Promise<void> {
  const key = STORAGE_KEYS.cachePrefix + (await keyOf(task, job, resumeVersion, model));
  await chrome.storage.local.set({ [key]: { at: Date.now(), value } });
  await prune();
}

/** 按 at 时间裁剪缓存，删除最旧的超出部分。 */
async function prune(): Promise<void> {
  const all = (await chrome.storage.local.get(null)) as Record<string, unknown>;
  const entries = Object.keys(all)
    .filter((k) => k.startsWith(STORAGE_KEYS.cachePrefix))
    .map((k) => {
      const raw = all[k];
      const at = isPlainObject(raw) && typeof raw.at === 'number' ? raw.at : 0;
      return { key: k, at };
    });
  if (entries.length <= CACHE_MAX) return;
  entries.sort((a, b) => a.at - b.at);
  const stale = entries.slice(0, entries.length - CACHE_MAX).map((it) => it.key);
  if (stale.length > 0) await chrome.storage.local.remove(stale);
}
