// @vitest-environment jsdom
// store 单测：对比上限 / 移除 / 订阅通知 / 槽位重置 / 统一中止。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobInfo } from '../../../shared/types';

// chrome 桩：store 只在函数内使用 chrome.storage（模块求值阶段不访问）
const memory: Record<string, unknown> = {};
(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: memory[key] }),
      set: async (items: Record<string, unknown>) => {
        Object.assign(memory, items);
      },
      remove: async () => undefined,
    },
    onChanged: { addListener: () => undefined, removeListener: () => undefined },
  },
};

import {
  TASK_KEYS,
  abortAll,
  addToCompare,
  clampPanelWidth,
  createInitialState,
  getState,
  initPanelWidth,
  registerAbort,
  removeFromCompare,
  resetAllSlots,
  setPanelWidth,
  setSlot,
  setState,
  subscribe,
} from '../store';
import { PANEL_WIDTH, PANEL_WIDTH_MAX, PANEL_WIDTH_MIN } from '../styles';

/** 构造一个最小可用 JobInfo。 */
function makeJob(id: string): JobInfo {
  return {
    id,
    title: `岗位${id}`,
    company: '某公司',
    salary: '20-40K',
    city: '合肥',
    experience: '5-10年',
    education: '本科',
    tags: [],
    jd: [],
    hrName: '刘女士',
    url: 'https://www.zhipin.com/job_detail/x.html',
    source: 'detail',
  };
}

describe('store', () => {
  beforeEach(() => {
    setState(() => createInitialState());
    abortAll();
  });

  it('addToCompare 最多 4 个，第 5 个返回 {ok:false} 且不写入', () => {
    for (let i = 1; i <= 4; i += 1) {
      expect(addToCompare(makeJob(`j${i}`)).ok).toBe(true);
    }
    expect(getState().compare.length).toBe(4);

    const fifth = addToCompare(makeJob('j5'));
    expect(fifth.ok).toBe(false);
    expect(fifth.reason).toBe('最多对比 4 个岗位，请先移除一个');
    expect(getState().compare.length).toBe(4);
    expect(getState().compare.some((it) => it.jobId === 'j5')).toBe(false);
  });

  it('removeFromCompare 生效', () => {
    addToCompare(makeJob('a'));
    addToCompare(makeJob('b'));
    removeFromCompare('a');
    expect(getState().compare.map((it) => it.jobId)).toEqual(['b']);
  });

  it('setState / subscribe 通知一次，取消订阅后不再通知', () => {
    let count = 0;
    const unsubscribe = subscribe(() => {
      count += 1;
    });
    setState({ tab: 'chat' });
    expect(count).toBe(1);
    unsubscribe();
    setState({ tab: 'job' });
    expect(count).toBe(1);
  });

  it('resetAllSlots 把所有槽位回到 idle', () => {
    setSlot('analysis', { status: 'success', data: { x: 1 }, stream: 'abc', dropped: 2 });
    expect(getState().slots.analysis.status).toBe('success');
    resetAllSlots();
    for (const key of TASK_KEYS) {
      expect(getState().slots[key].status).toBe('idle');
      expect(getState().slots[key].stream).toBe('');
      expect(getState().slots[key].dropped).toBe(0);
    }
  });

  it('abortAll 调用登记的中止函数且只调用一次', () => {
    const fn = vi.fn();
    registerAbort('task-1', fn);
    abortAll();
    expect(fn).toHaveBeenCalledTimes(1);
    abortAll();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('侧栏宽度（拖拽调整）', () => {
  beforeEach(() => {
    setState(() => createInitialState());
    document.documentElement.style.removeProperty('--ba-w');
  });

  it('clampPanelWidth 收敛到 [320,560]，非法值回退默认 380', () => {
    expect(clampPanelWidth(200)).toBe(PANEL_WIDTH_MIN);
    expect(clampPanelWidth(800)).toBe(PANEL_WIDTH_MAX);
    expect(clampPanelWidth(419.6)).toBe(420);
    expect(clampPanelWidth(Number.NaN)).toBe(PANEL_WIDTH);
    expect(clampPanelWidth(Number.POSITIVE_INFINITY)).toBe(PANEL_WIDTH);
  });

  it('setPanelWidth 写 state、应用 --ba-w 变量并持久化', () => {
    setPanelWidth(460);
    expect(getState().panelWidth).toBe(460);
    expect(document.documentElement.style.getPropertyValue('--ba-w')).toBe('460px');
    expect(memory['boss_ai_panel_width']).toBe(460);
  });

  it('setPanelWidth 越界值按收敛结果持久化', () => {
    setPanelWidth(999);
    expect(getState().panelWidth).toBe(PANEL_WIDTH_MAX);
    expect(memory['boss_ai_panel_width']).toBe(PANEL_WIDTH_MAX);
  });

  it('initPanelWidth 恢复已存宽度；脏值收敛、无记录保持默认', async () => {
    memory['boss_ai_panel_width'] = 500;
    await initPanelWidth();
    expect(getState().panelWidth).toBe(500);
    expect(document.documentElement.style.getPropertyValue('--ba-w')).toBe('500px');

    memory['boss_ai_panel_width'] = 9999;
    await initPanelWidth();
    expect(getState().panelWidth).toBe(PANEL_WIDTH_MAX);

    // 无记录：挂载时 state 为默认 380，initPanelWidth 不应改动它
    delete memory['boss_ai_panel_width'];
    setState(() => createInitialState());
    document.documentElement.style.removeProperty('--ba-w');
    await initPanelWidth();
    expect(getState().panelWidth).toBe(PANEL_WIDTH);
    expect(document.documentElement.style.getPropertyValue('--ba-w')).toBe('');
  });
});
