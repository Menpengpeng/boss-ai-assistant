/*
 * ============================================================================
 * 【重要】本文件只允许被 background 与 options 导入，绝不能被 content program 导入！
 *
 * 原因：content script 运行在页面源（zhipin.com）下，其 IndexedDB 归属页面源，
 * 会把简历、PDF Blob、分析历史写入站点域名下，既不符合「数据仅存本地扩展」的隐私要求，
 * 也会在站点清理存储时丢失/被站点脚本读取。同时 content 产物是 IIFE 经典脚本，
 * 引入本文件会把整套 IDB 代码打进 content bundle。
 * 需要「一键清除全部数据」时，由 background / options 调用 ./wipe 的 clearAllData()。
 * ============================================================================
 */

/**
 * 原生 IndexedDB 封装（无第三方依赖）。
 * 对象仓库：resumes(keyPath version) / analyses(keyPath id, index at) / chats(keyPath jobId)
 */
import { getSettings } from './storage';
import type {
  AnalysisRecord,
  ChatContext,
  ResumeMeta,
  ResumeRecord,
  ResumeSnapshot,
} from './types';

export const DB_NAME = 'boss-ai';
export const DB_VERSION = 1;

/** 对象仓库名。 */
const STORE_RESUMES = 'resumes';
const STORE_ANALYSES = 'analyses';
const STORE_CHATS = 'chats';

/** 数据库连接单例（避免重复 open）。 */
let dbPromise: Promise<IDBDatabase> | null = null;

/** 打开（并按需初始化）数据库。 */
export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_RESUMES)) {
        db.createObjectStore(STORE_RESUMES, { keyPath: 'version' });
      }
      if (!db.objectStoreNames.contains(STORE_ANALYSES)) {
        const store = db.createObjectStore(STORE_ANALYSES, { keyPath: 'id' });
        store.createIndex('at', 'at');
      }
      if (!db.objectStoreNames.contains(STORE_CHATS)) {
        db.createObjectStore(STORE_CHATS, { keyPath: 'jobId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

/** 在指定仓库上执行一次请求并 Promise 化。 */
function runRequest<T>(
  store: string,
  mode: IDBTransactionMode,
  create: (objectStore: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const request = create(tx.objectStore(store));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error);
      }),
  );
}

/** 按主键读取。 */
export async function idbGet<T>(store: string, key: IDBValidKey): Promise<T | null> {
  const value = await runRequest<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
  return value === undefined ? null : value;
}

/** 读取仓库内全部记录。 */
export async function idbGetAll<T>(store: string): Promise<T[]> {
  return runRequest<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
}

/** 写入（不传 key 时使用对象仓库自身的 keyPath）。 */
export async function idbPut(store: string, value: unknown, key?: IDBValidKey): Promise<void> {
  await runRequest<IDBValidKey>(store, 'readwrite', (s) =>
    (key === undefined ? s.put(value) : s.put(value, key)) as IDBRequest<IDBValidKey>,
  );
}

/** 按主键删除。 */
export async function idbDelete(store: string, key: IDBValidKey): Promise<void> {
  await runRequest<undefined>(store, 'readwrite', (s) => s.delete(key) as IDBRequest<undefined>);
}

/** 清空仓库。 */
export async function idbClear(store: string): Promise<void> {
  await runRequest<undefined>(store, 'readwrite', (s) => s.clear() as IDBRequest<undefined>);
}

/** 删除整个数据库（一键清除用）。 */
export async function clearDatabase(): Promise<void> {
  if (dbPromise) {
    try {
      const db = await dbPromise;
      db.close();
    } catch {
      // 打开失败时忽略，继续删除数据库
    }
    dbPromise = null;
  }
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    // 其它标签页仍占用时不再阻塞，视为已请求删除
    request.onblocked = () => resolve();
  });
}

// ---------------------------------------------------------------------------
// 领域封装
// ---------------------------------------------------------------------------

/** 保存简历记录。 */
export async function putResume(rec: ResumeRecord): Promise<void> {
  await idbPut(STORE_RESUMES, rec);
}

/** 按版本号读取简历记录。 */
export async function getResume(version: number): Promise<ResumeRecord | null> {
  return idbGet<ResumeRecord>(STORE_RESUMES, version);
}

/** 读取当前启用版本对应的简历快照（PDF 返回 Blob，文本返回脱敏文本）。 */
export async function getActiveResumeSnapshot(): Promise<ResumeSnapshot | null> {
  const settings = await getSettings();
  const version = settings.activeResumeVersion;
  if (!version || version <= 0) return null;
  const rec = await getResume(version);
  if (!rec) return null;
  const snapshot: ResumeSnapshot = {
    version: rec.version,
    kind: rec.kind,
    name: rec.name,
    maskName: rec.maskName,
  };
  if (rec.kind === 'pdf') {
    snapshot.blob = rec.blob;
  } else {
    snapshot.text = rec.maskedText ?? rec.rawText ?? '';
  }
  return snapshot;
}

/** 列出全部简历元信息（按版本倒序）。 */
export async function listResumes(): Promise<ResumeMeta[]> {
  const all = await idbGetAll<ResumeRecord>(STORE_RESUMES);
  return all
    .slice()
    .sort((a, b) => (b.version ?? 0) - (a.version ?? 0))
    .map((r) => ({
      kind: r.kind,
      name: r.name,
      version: r.version,
      updatedAt: r.updatedAt,
      size: r.size,
      sha256: r.sha256,
      maskName: r.maskName,
    }));
}

/** 删除指定版本简历（含 PDF Blob）。 */
export async function deleteResume(version: number): Promise<void> {
  await idbDelete(STORE_RESUMES, version);
}

/** 追加一条分析历史。 */
export async function addAnalysis(rec: AnalysisRecord): Promise<void> {
  await idbPut(STORE_ANALYSES, rec);
}

/** 列出分析历史（按时间倒序，可限制条数）。 */
export async function listAnalyses(limit?: number): Promise<AnalysisRecord[]> {
  const all = await idbGetAll<AnalysisRecord>(STORE_ANALYSES);
  const sorted = all.slice().sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  return typeof limit === 'number' && limit > 0 ? sorted.slice(0, limit) : sorted;
}

/** 清空分析历史。 */
export async function clearAnalyses(): Promise<void> {
  await idbClear(STORE_ANALYSES);
}

/** 保存会话上下文（键为 jobId）。 */
export async function saveChatSession(ctx: ChatContext): Promise<void> {
  await idbPut(STORE_CHATS, ctx);
}

/** 读取会话上下文。 */
export async function getChatSession(jobId: string): Promise<ChatContext | null> {
  return idbGet<ChatContext>(STORE_CHATS, jobId);
}

/** 清空全部会话上下文。 */
export async function clearChatSessions(): Promise<void> {
  await idbClear(STORE_CHATS);
}
