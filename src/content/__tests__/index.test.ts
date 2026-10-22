// @vitest-environment jsdom
// 装配层集成单测：只断言门控行为（未登录不解析、登录后解析并注入、
// ba:auth-query 查询、退出登录 abort + 关闭侧栏）。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from '../../shared/types';

const H = vi.hoisted(() => {
  const handle = {
    open: vi.fn(),
    close: vi.fn(),
    toggle: vi.fn(),
    isOpen: vi.fn(() => false),
    refresh: vi.fn(),
    destroy: vi.fn(),
  };
  const actions = {
    setState: vi.fn(),
    setAuth: vi.fn(),
    abortAll: vi.fn(),
    resetAllSlots: vi.fn(),
    toast: vi.fn(),
    getState: vi.fn(() => ({})),
  };
  const injector = { apply: vi.fn(), clear: vi.fn(), dispose: vi.fn() };
  const auth = {
    value: 'unknown' as 'logged_in' | 'logged_out' | 'unknown',
    cbs: [] as Array<(s: AuthState) => void>,
    stop: vi.fn(),
  };
  const parsers = {
    detectPageKind: vi.fn(() => 'jobDetail' as const),
    parseJobDetail: vi.fn(() => null),
    parseCompany: vi.fn(() => null),
    parseChat: vi.fn(() => null),
  };
  return { handle, actions, injector, auth, parsers };
});

vi.mock('../panel', () => ({
  mountPanel: () => H.handle,
  actions: H.actions,
}));

vi.mock('../injector', () => ({
  createInjector: () => H.injector,
}));

vi.mock('../parsers', () => ({
  detectPageKind: H.parsers.detectPageKind,
  parseJobDetail: H.parsers.parseJobDetail,
  parseCompany: H.parsers.parseCompany,
  parseChat: H.parsers.parseChat,
}));

vi.mock('../auth-detector', () => ({
  createAuthDetector: () => ({
    detect: () => H.auth.value,
    start: (cb: (s: AuthState) => void) => {
      H.auth.cbs.push(cb);
      return () => undefined;
    },
    stop: H.auth.stop,
    getState: () => H.auth.value,
  }),
}));

/** 记录 chrome.runtime.onMessage 注册的监听器。 */
const messageListeners: Array<(msg: unknown, sender: unknown, send: (r?: unknown) => void) => unknown> =
  [];

beforeEach(() => {
  messageListeners.length = 0;
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      onMessage: {
        addListener: (fn: (typeof messageListeners)[number]) => messageListeners.push(fn),
        removeListener: (fn: (typeof messageListeners)[number]) => {
          const i = messageListeners.indexOf(fn);
          if (i >= 0) messageListeners.splice(i, 1);
        },
      },
      getURL: (p: string) => `chrome-extension://test/${p}`,
    },
    storage: {
      local: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
      onChanged: { addListener: () => undefined, removeListener: () => undefined },
    },
  };
  document.body.innerHTML = '';
  vi.resetModules();
  vi.clearAllMocks();
  H.auth.value = 'unknown';
  H.auth.cbs.length = 0;
  H.parsers.detectPageKind.mockReturnValue('jobDetail');
  H.parsers.parseJobDetail.mockReturnValue(null);
  H.parsers.parseCompany.mockReturnValue(null);
  H.parsers.parseChat.mockReturnValue(null);
});

describe('content 装配层门控', () => {
  it('logged_out：挂载侧栏但不解析页面、不注入控件', async () => {
    H.auth.value = 'logged_out';
    await import('../index');

    expect(H.handle.open).not.toHaveBeenCalled();
    expect(H.parsers.parseJobDetail).not.toHaveBeenCalled();
    expect(H.parsers.parseChat).not.toHaveBeenCalled();
    expect(H.injector.apply).not.toHaveBeenCalled();
    expect(H.handle.close).toHaveBeenCalled();
  });

  it('logged_in：解析上下文并调用 injector.apply', async () => {
    H.auth.value = 'logged_in';
    await import('../index');

    expect(H.parsers.parseJobDetail).toHaveBeenCalledTimes(1);
    expect(H.actions.setAuth).toHaveBeenCalledWith('logged_in');
    expect(H.injector.apply).toHaveBeenCalledWith('jobDetail', 'logged_in');
  });

  it('响应 ba:auth-query，返回当前登录态', async () => {
    H.auth.value = 'logged_in';
    await import('../index');

    expect(messageListeners.length).toBe(1);
    const send = vi.fn();
    const ret = messageListeners[0]({ type: 'ba:auth-query' }, {}, send);
    expect(ret).toBe(true);
    expect(send).toHaveBeenCalledWith({ auth: 'logged_in' });
  });

  it('登录态由 logged_in 变 logged_out：abortAll 且关闭侧栏并清空上下文', async () => {
    H.auth.value = 'logged_in';
    await import('../index');

    H.actions.abortAll.mockClear();
    H.handle.close.mockClear();

    H.auth.cbs.forEach((cb) => cb('logged_out'));

    expect(H.actions.abortAll).toHaveBeenCalled();
    expect(H.handle.close).toHaveBeenCalled();
    expect(H.actions.setState).toHaveBeenCalledWith(
      expect.objectContaining({ chat: null, job: null, company: null }),
    );
    expect(H.injector.clear).toHaveBeenCalled();
  });

  it('登录态 unknown：不解析、不请求，设置 auth 引导', async () => {
    H.auth.value = 'unknown';
    await import('../index');

    expect(H.parsers.parseJobDetail).not.toHaveBeenCalled();
    expect(H.actions.setAuth).toHaveBeenCalledWith(
      'unknown',
      expect.stringContaining('无法确认登录状态'),
    );
  });
});
