/**
 * chrome.storage.local 封装：配置、对比、收藏、缓存。
 *
 * 重要约束：本文件**不得** import './idb'。因为 storage.ts 需要在 content 侧可用
 * （chrome.storage 在 content script 中可用），一旦引入 idb.ts，IndexedDB 代码就会被打进
 * content bundle，而 content script 运行在页面源下，其 IndexedDB 归属页面源，属于错误用法。
 * 「一键清除全部数据」（含删除 IndexedDB）请使用 ./wipe 的 clearAllData()，仅限 background / options。
 */
import { DEFAULT_SETTINGS, STORAGE_KEYS } from './constants';
import type { AppSettings, CompareItem, DeepPartial, FavoriteItem } from './types';

/** 是否为普通对象（排除 null / 数组）。 */
function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 递归深合并（patch 中未提供的键保留 base 值），不修改入参。 */
function deepMerge<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (patch === undefined || patch === null) return base;
  if (!isPlain(base) || !isPlain(patch)) {
    return patch as unknown as T;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === undefined) continue;
    const current = out[key];
    out[key] = isPlain(current) && isPlain(value) ? deepMerge(current, value) : value;
  }
  return out as unknown as T;
}

/** 读取单个 storage 键。 */
async function readLocal(key: string): Promise<unknown> {
  const result = (await chrome.storage.local.get(key)) as Record<string, unknown>;
  return result[key];
}

/** 写入单个 storage 键。 */
async function writeLocal(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

/** 读取应用配置（与默认值深合并，保证新增字段始终有默认值）。 */
export async function getSettings(): Promise<AppSettings> {
  const stored = await readLocal(STORAGE_KEYS.settings);
  return deepMerge(DEFAULT_SETTINGS, stored as DeepPartial<AppSettings> | undefined);
}

/** 局部更新应用配置，返回合并后的完整配置。 */
export async function setSettings(patch: DeepPartial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const next = deepMerge(current, patch);
  await writeLocal(STORAGE_KEYS.settings, next);
  return next;
}

/** 读取对比列表。 */
export async function getCompareList(): Promise<CompareItem[]> {
  const stored = await readLocal(STORAGE_KEYS.compare);
  return Array.isArray(stored) ? (stored as CompareItem[]) : [];
}

/** 保存对比列表。 */
export async function setCompareList(list: CompareItem[]): Promise<void> {
  await writeLocal(STORAGE_KEYS.compare, list);
}

/** 读取收藏列表。 */
export async function getFavorites(): Promise<FavoriteItem[]> {
  const stored = await readLocal(STORAGE_KEYS.favorites);
  return Array.isArray(stored) ? (stored as FavoriteItem[]) : [];
}

/** 保存收藏列表。 */
export async function setFavorites(list: FavoriteItem[]): Promise<void> {
  await writeLocal(STORAGE_KEYS.favorites, list);
}

/** 读取缓存项。 */
export async function getCache<T>(key: string): Promise<T | null> {
  const stored = await readLocal(STORAGE_KEYS.cachePrefix + key);
  return stored === undefined ? null : (stored as T);
}

/** 写入缓存项。 */
export async function setCache(key: string, value: unknown): Promise<void> {
  await writeLocal(STORAGE_KEYS.cachePrefix + key, value);
}

/** 清空全部缓存项（保留配置与历史）。 */
export async function clearCache(): Promise<void> {
  const all = (await chrome.storage.local.get(null)) as Record<string, unknown>;
  const keys = Object.keys(all).filter((k) => k.startsWith(STORAGE_KEYS.cachePrefix));
  if (keys.length > 0) await chrome.storage.local.remove(keys);
}

/**
 * 清空 chrome.storage.local 中本扩展的全部键（配置、日志、对比、收藏、会话、缓存）。
 * 不含 IndexedDB（简历 / 分析历史）；完整清除请使用 ./wipe 的 clearAllData()。
 */
export async function clearAllLocalData(): Promise<void> {
  const all = (await chrome.storage.local.get(null)) as Record<string, unknown>;
  const baseKeys = [
    STORAGE_KEYS.settings,
    STORAGE_KEYS.logs,
    STORAGE_KEYS.compare,
    STORAGE_KEYS.favorites,
    STORAGE_KEYS.chatSessions,
  ];
  const cacheKeys = Object.keys(all).filter((k) => k.startsWith(STORAGE_KEYS.cachePrefix));
  const keys = Array.from(new Set([...baseKeys, ...cacheKeys]));
  if (keys.length > 0) await chrome.storage.local.remove(keys);
}
