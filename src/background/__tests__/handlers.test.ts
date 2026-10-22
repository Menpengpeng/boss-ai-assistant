/**
 * Background 消息处理单测：settings:get 成功、未知 type 返回 UNKNOWN、llm:test 无 Key 时不发请求。
 * 使用内存假 chrome.* 与 fetch spy，不访问真实扩展环境与网络。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BgResponse } from '../../shared/protocol';
import { registerMessageHandler, registerPortHandler } from '../handlers';

/** onMessage 监听器签名。 */
type Listener = (
  msg: unknown,
  sender: chrome.runtime.MessageSender,
  send: (res: BgResponse) => void,
) => unknown;

let messageListener: Listener | null = null;

/** 内存版 chrome.*。 */
const memory: Record<string, unknown> = {};
/** tabs.create 间谍：ui:openOptions 用它打开设置页。 */
const tabsCreate = vi.fn(async () => ({}));
(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: {
    onMessage: {
      addListener: (fn: Listener) => {
        messageListener = fn;
      },
    },
    onConnect: { addListener: () => undefined },
    getURL: (path: string) => `chrome-extension://test/${path}`,
  },
  tabs: { create: tabsCreate },
  storage: {
    local: {
      get: async (key: string | null) => (key === null ? { ...memory } : { [key]: memory[key] }),
      set: async (items: Record<string, unknown>) => {
        Object.assign(memory, items);
      },
      remove: async (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete memory[k];
      },
    },
  },
  permissions: { contains: async () => true },
};

/** 通过注册的监听器发一条消息，等待响应。 */
function send(msg: unknown): Promise<BgResponse> {
  return new Promise((resolve) => {
    if (!messageListener) throw new Error('消息监听器未注册');
    messageListener(msg, {} as chrome.runtime.MessageSender, (res) => resolve(res));
  });
}

beforeEach(() => {
  for (const k of Object.keys(memory)) delete memory[k];
  registerMessageHandler();
  registerPortHandler();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('registerMessageHandler', () => {
  it('settings:get 返回 ok:true 与默认配置', async () => {
    const res = await send({ type: 'settings:get', payload: {} });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { api: { key: string; provider: string } };
      expect(data.api.key).toBe('');
      expect(data.api.provider).toBe('deepseek');
    }
  });

  it('未知 type 返回 ok:false 且错误码为 UNKNOWN', async () => {
    const res = await send({ type: '不存在的类型', payload: {} });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('UNKNOWN');
  });

  it('llm:test 在 Key 为空时返回 NO_KEY 且不发起任何网络请求', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await send({ type: 'llm:test', payload: {} });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NO_KEY');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ui:openOptions 由扩展上下文用 chrome.tabs.create 打开设置页（hash 透传）', async () => {
    tabsCreate.mockClear();
    const withHash = await send({ type: 'ui:openOptions', payload: { hash: 'api' } });
    expect(withHash.ok).toBe(true);
    expect(tabsCreate).toHaveBeenCalledWith({ url: 'chrome-extension://test/options.html#api' });

    tabsCreate.mockClear();
    const noHash = await send({ type: 'ui:openOptions', payload: {} });
    expect(noHash.ok).toBe(true);
    expect(tabsCreate).toHaveBeenCalledWith({ url: 'chrome-extension://test/options.html' });
  });
});
