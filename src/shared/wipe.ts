/**
 * 一键清除全部数据（F12「清除数据」）：settings / 缓存 / 对比 / 收藏 / 日志（chrome.storage.local）
 * + IndexedDB（resumes 含 PDF Blob、analyses、chats）+ session storage。
 * 仅限 background / options 使用（含 idb.ts，不得被 content program 导入）。
 */
import { clearDatabase } from './idb';
import { clearAllLocalData } from './storage';

/** 清除全部本地数据，保证本地无残留（含 PDF 文件）。 */
export async function clearAllData(): Promise<void> {
  await clearAllLocalData();
  await clearDatabase();
  try {
    await chrome.storage.session.clear();
  } catch {
    // session storage 在个别上下文不可用时忽略（无残留风险）
  }
}
