// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextFrame, onChatMutation, onPageMutation, onRouteChange } from '../../observers';

describe('onRouteChange', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('相同 URL 不重复回调', () => {
    const cb = vi.fn();
    const off = onRouteChange(cb);
    window.dispatchEvent(new Event('popstate'));
    vi.advanceTimersByTime(400);
    expect(cb).not.toHaveBeenCalled();
    off();
  });

  it('URL 变化后回调一次，并给出 kind 与 url', () => {
    const cb = vi.fn();
    const off = onRouteChange(cb);
    window.history.replaceState({}, '', '/job_detail/abc.html');
    window.dispatchEvent(new Event('popstate'));
    vi.advanceTimersByTime(400);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toBe('jobDetail');
    expect(String(cb.mock.calls[0][1])).toContain('/job_detail/abc.html');
    // 继续推进时间：URL 未再变化，不应再次回调
    vi.advanceTimersByTime(2000);
    expect(cb).toHaveBeenCalledTimes(1);
    off();
  });

  it('取消订阅后不再回调', () => {
    const cb = vi.fn();
    const off = onRouteChange(cb);
    off();
    window.history.replaceState({}, '', '/web/geek/job');
    window.dispatchEvent(new Event('popstate'));
    vi.advanceTimersByTime(400);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('onPageMutation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('多次突变只回调一次（去抖合并）', async () => {
    const cb = vi.fn();
    const off = onPageMutation('jobList', cb, 20);
    for (let i = 0; i < 3; i += 1) {
      const div = document.createElement('div');
      div.textContent = `节点${i}`;
      document.body.appendChild(div);
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(cb).toHaveBeenCalledTimes(1);
    off();
  });

  it('取消订阅后再突变不回调', async () => {
    const cb = vi.fn();
    const off = onPageMutation('jobList', cb, 20);
    off();
    document.body.appendChild(document.createElement('div'));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('onChatMutation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('聊天区域突变触发一次回调', async () => {
    const list = document.createElement('div');
    list.className = 'chat-record';
    const item = document.createElement('div');
    item.className = 'chat-message';
    list.appendChild(item);
    document.body.appendChild(list);

    const cb = vi.fn();
    const off = onChatMutation(cb, 20);
    const extra = document.createElement('div');
    extra.className = 'chat-message';
    list.appendChild(extra);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(cb).toHaveBeenCalledTimes(1);
    off();
  });
});

describe('nextFrame', () => {
  it('返回一个可 resolve 的 Promise', async () => {
    await expect(nextFrame()).resolves.toBeUndefined();
  });
});
