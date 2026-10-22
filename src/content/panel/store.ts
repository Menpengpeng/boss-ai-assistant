/**
 * 侧栏极简发布订阅 store（核心逻辑不依赖 React，仅 usePanelState 依赖 useSyncExternalStore）。
 *
 * 约定：
 * - 全量 state 只在这里维护，任何模块都通过 setState / 专用函数修改。
 * - 在途任务通过 registerAbort / abortAll 统一登记与中止（页面切换 / 关闭侧栏 / 退出登录）。
 * - quickScores 持久化到 chrome.storage.local 的键：STORAGE_KEYS.cachePrefix + 'quick'。
 */
import { useSyncExternalStore } from 'react';
import { LIMITS, STORAGE_KEYS } from '../../shared/constants';
import type { ErrorCode } from '../../shared/errors';
import {
  getCompareList,
  getFavorites,
  getSettings,
  setCompareList,
  setFavorites,
} from '../../shared/storage';
import type { AuthState, JobInfo, QuickReview, RiskItem } from '../../shared/types';
import { PANEL_WIDTH, PANEL_WIDTH_MAX, PANEL_WIDTH_MIN } from './styles';
import type { PanelState, TaskKey, TaskSlot } from './types';

/** 所有任务键（用于初始化槽位）。 */
export const TASK_KEYS: TaskKey[] = [
  'analysis',
  'match',
  'greeting',
  'interview',
  'company',
  'chatReply',
  'chatRisk',
  'quickReview',
];

/** quickScores 的持久化键。 */
export const QUICK_SCORES_KEY = STORAGE_KEYS.cachePrefix + 'quick';

/** 对比数量上限提示文案（与原型 / 需求一致）。 */
export const COMPARE_FULL_REASON = '最多对比 4 个岗位，请先移除一个';

/** 默认值：一次点开的 Toast 显示时长。 */
const TOAST_MS = 2400;

/** 生成一份全新的空槽位表。 */
function createSlots(): Record<TaskKey, TaskSlot> {
  const slots = {} as Record<TaskKey, TaskSlot>;
  for (const key of TASK_KEYS) {
    slots[key] = { status: 'idle', data: null, error: null, stream: '', dropped: 0 };
  }
  return slots;
}

/** 初始状态。 */
export function createInitialState(): PanelState {
  return {
    mounted: false,
    open: false,
    tab: 'job',
    jobTab: 'analysis',
    auth: 'unknown',
    authNote: '',
    job: null,
    company: null,
    chat: null,
    slots: createSlots(),
    busyKey: null,
    quickScores: {},
    quickBusyJobId: null,
    compare: [],
    favorites: [],
    chatConsent: false,
    resumeVersion: 0,
    hasResume: false,
    apiReady: false,
    panelWidth: PANEL_WIDTH,
    theme: 'light',
    toast: null,
    logs: [],
  };
}

let state: PanelState = createInitialState();

const listeners = new Set<() => void>();

/** 登记的在途任务中止函数（key → abort）。 */
const abortFns = new Map<string, () => void>();

let toastTimer: ReturnType<typeof setTimeout> | null = null;

/** 当前状态（引用稳定，仅 setState 时变化）。 */
export function getState(): PanelState {
  return state;
}

/** 订阅状态变化；返回取消订阅函数。 */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 更新状态并通知订阅者（一次调用只通知一次）。 */
export function setState(patch: Partial<PanelState> | ((s: PanelState) => Partial<PanelState>)): void {
  const next = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...next };
  listeners.forEach((fn) => fn());
}

/** 取某个任务的槽位。 */
export function getSlot(key: TaskKey): TaskSlot {
  return state.slots[key];
}

/** 局部更新某个任务的槽位。 */
export function setSlot(key: TaskKey, patch: Partial<TaskSlot>): void {
  setState((s) => ({
    slots: { ...s.slots, [key]: { ...s.slots[key], ...patch } },
  }));
}

/** 把某个槽位重置为初始态。 */
export function resetSlot(key: TaskKey): void {
  setSlot(key, { status: 'idle', data: null, error: null, stream: '', dropped: 0 });
}

/** 重置全部槽位（并清空 busyKey）。 */
export function resetAllSlots(): void {
  setState({ slots: createSlots(), busyKey: null });
}

/** 把某个槽位置为失败态。 */
export function setSlotError(key: TaskKey, code: ErrorCode, message: string): void {
  setSlot(key, { status: 'error', error: { code, message }, stream: '' });
}

/** 设置当前正在执行的任务键。 */
export function setBusy(key: TaskKey | null): void {
  setState({ busyKey: key });
}

/** 展示一条 Toast（默认 2.4 秒后自动消失）。 */
export function toast(msg: string, ms: number = TOAST_MS): void {
  if (toastTimer !== null) clearTimeout(toastTimer);
  setState({ toast: msg });
  toastTimer = setTimeout(() => {
    toastTimer = null;
    setState({ toast: null });
  }, ms);
}

/** 登记一个可中止的任务。 */
export function registerAbort(key: string, fn: () => void): void {
  abortFns.set(key, fn);
}

/** 注销一个可中止的任务。 */
export function clearAbort(key: string): void {
  abortFns.delete(key);
}

/** 中止全部已登记的任务（页面切换 / 关闭侧栏 / 退出登录时调用）。 */
export function abortAll(): void {
  const fns = Array.from(abortFns.values());
  abortFns.clear();
  fns.forEach((fn) => {
    try {
      fn();
    } catch {
      /* 单个中止失败不影响其它任务 */
    }
  });
}

/** 设置登录态；非登录态时中止全部在途请求。 */
export function setAuth(auth: AuthState, note?: string): void {
  setState({ auth, authNote: note ?? '' });
  if (auth !== 'logged_in') abortAll();
}

/** 读取已持久化的 quickScores。 */
async function readQuickScores(): Promise<Record<string, QuickReview>> {
  const result = (await chrome.storage.local.get(QUICK_SCORES_KEY)) as Record<string, unknown>;
  const value = result[QUICK_SCORES_KEY];
  return (value && typeof value === 'object' ? value : {}) as Record<string, QuickReview>;
}

/** 从 chrome.storage 载入 compare / favorites / quickScores 并写入 state。 */
export async function getCompare(): Promise<void> {
  const [compare, favorites, quickScores] = await Promise.all([
    getCompareList(),
    getFavorites(),
    readQuickScores(),
  ]);
  setState({ compare, favorites, quickScores });
}

/** 写入某个岗位的快评分数。 */
export function setQuickScore(jobId: string, review: QuickReview): void {
  const next = { ...state.quickScores, [jobId]: review };
  setState({ quickScores: next });
  chrome.storage.local.set({ [QUICK_SCORES_KEY]: next }).catch(() => {
    /* 忽略 */
  });
}

/**
 * 加入对比。超过 LIMITS.maxCompare 时返回失败原因，且不写入。
 * 已存在同一岗位时仅更新其分数与风险条目。
 */
export function addToCompare(
  job: JobInfo,
  score: number | null = null,
  red: RiskItem[] = [],
): { ok: boolean; reason?: string } {
  const list = state.compare;
  const exists = list.some((it) => it.jobId === job.id);
  if (!exists && list.length >= LIMITS.maxCompare) {
    return { ok: false, reason: COMPARE_FULL_REASON };
  }
  const next = exists
    ? list.map((it) => (it.jobId === job.id ? { ...it, job, score, red } : it))
    : [...list, { jobId: job.id, job, score, red, addedAt: Date.now() }];
  setState({ compare: next });
  setCompareList(next).catch(() => {
    /* 本地持久化失败不影响内存状态 */
  });
  return { ok: true };
}

/** 从对比中移除指定岗位。 */
export function removeFromCompare(jobId: string): void {
  const next = state.compare.filter((it) => it.jobId !== jobId);
  setState({ compare: next });
  setCompareList(next).catch(() => {
    /* 忽略 */
  });
}

/** 切换收藏；返回切换后的收藏状态（true = 已收藏）。 */
export async function toggleFavorite(job: JobInfo): Promise<boolean> {
  const list = state.favorites;
  const exists = list.some((it) => it.jobId === job.id);
  const next = exists
    ? list.filter((it) => it.jobId !== job.id)
    : [...list, { jobId: job.id, job, at: Date.now() }];
  setState({ favorites: next });
  await setFavorites(next);
  return !exists;
}

/** 解析主题：auto 时跟随系统。 */
function resolveTheme(theme: 'auto' | 'light' | 'dark'): 'light' | 'dark' {
  if (theme === 'dark') return 'dark';
  if (theme === 'light') return 'light';
  const dark =
    typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  return dark ? 'dark' : 'light';
}

/** 读取配置并更新 hasResume / resumeVersion / apiReady / chatConsent / theme。 */
export async function refreshSettings(): Promise<void> {
  const settings = await getSettings();
  setState({
    hasResume: settings.activeResumeVersion > 0,
    resumeVersion: settings.activeResumeVersion,
    apiReady: settings.api.verified,
    chatConsent: settings.chatConsent,
    theme: resolveTheme(settings.theme),
  });
}

/** 把侧栏宽度写到页面 <html> 的 --ba-w 变量（hostStyles 中宽度 / 挤压量均引用它）。 */
export function applyPanelWidth(width: number): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--ba-w', `${width}px`);
}

/** 侧栏宽度收敛到合法范围（拖动越界 / 存储脏值时；非法数值回退默认 380）。 */
export function clampPanelWidth(width: number): number {
  if (!Number.isFinite(width)) return PANEL_WIDTH;
  return Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, Math.round(width)));
}

/** 提交侧栏宽度：收敛 → 写 state → 应用 CSS 变量 → 持久化（拖动结束时调用一次）。 */
export function setPanelWidth(width: number): void {
  const next = clampPanelWidth(width);
  if (next !== state.panelWidth) {
    setState({ panelWidth: next });
    applyPanelWidth(next);
  }
  chrome.storage.local.set({ [STORAGE_KEYS.panelWidth]: next }).catch(() => {
    /* 持久化失败不影响内存状态 */
  });
}

/** 挂载时读取已保存的侧栏宽度并应用（无记录 / 脏值时保持默认 380）。 */
export async function initPanelWidth(): Promise<void> {
  try {
    const result = (await chrome.storage.local.get(
      STORAGE_KEYS.panelWidth,
    )) as Record<string, unknown>;
    const saved = result[STORAGE_KEYS.panelWidth];
    if (typeof saved === 'number') {
      const next = clampPanelWidth(saved);
      setState({ panelWidth: next });
      applyPanelWidth(next);
    }
  } catch {
    /* 非扩展环境或存储异常时保持默认宽度 */
  }
}

/** React hook：订阅 store 状态。 */
export function usePanelState(): PanelState {
  return useSyncExternalStore(subscribe, getState, getState);
}

/** store 函数聚合对象，供 UI 层以 actions.xxx 形式调用。 */
export const actions = {
  createInitialState,
  getState,
  setState,
  subscribe,
  getSlot,
  setSlot,
  resetSlot,
  resetAllSlots,
  setSlotError,
  setBusy,
  toast,
  registerAbort,
  clearAbort,
  abortAll,
  setAuth,
  getCompare,
  setQuickScore,
  addToCompare,
  removeFromCompare,
  toggleFavorite,
  refreshSettings,
  applyPanelWidth,
  clampPanelWidth,
  setPanelWidth,
  initPanelWidth,
  usePanelState,
};
