// @vitest-environment jsdom
// 登录态检测单测：三种命中场景 / 误判防护 / 隐藏元素 / 去抖与停止。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthDetector } from '../auth-detector';

/**
 * jsdom 不做布局，getClientRects 恒为空数组。
 * 这里按浏览器语义桩定：display:none / [hidden] 的元素视为不可见，其余视为可见。
 */
function stubLayout(): void {
  (Element.prototype as unknown as { getClientRects(): unknown[] }).getClientRects = function (
    this: Element,
  ): unknown[] {
    const el = this as HTMLElement;
    const hidden = el.style?.display === 'none' || el.hasAttribute('hidden');
    return hidden ? [] : [{ width: 10, height: 10, top: 0, left: 0 }];
  };
}

/** 追加一个带类名的元素到 body。 */
function append(cls: string): void {
  const el = document.createElement('div');
  el.className = cls;
  document.body.appendChild(el);
}

/** 让 MutationObserver 微任务先执行，再推进去抖定时器。 */
async function settle(ms = 320): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(ms);
}

describe('createAuthDetector', () => {
  beforeEach(() => {
    stubLayout();
    document.body.innerHTML = '';
  });

  it('命中已登录标志 → logged_in', () => {
    document.body.innerHTML = '<div class="user-nav"><span class="figure">张伟</span></div>';
    const detector = createAuthDetector();
    expect(detector.getState()).toBe('logged_in');
    expect(detector.detect()).toBe('logged_in');
  });

  it('命中登录按钮 → logged_out', () => {
    document.body.innerHTML =
      '<a class="btn-login" href="/web/user/?ka=header-login">登录 / 注册</a>';
    expect(createAuthDetector().getState()).toBe('logged_out');
  });

  it('都不命中 → unknown', () => {
    document.body.innerHTML = '<div class="site-footer">关于我们</div>';
    expect(createAuthDetector().getState()).toBe('unknown');
  });

  it('非可点击的「登录」文本不得判为 logged_out', () => {
    // class 含 login，会被 [class*="login"] 命中；但 span 不是 a/button/[role=button]
    document.body.innerHTML = '<span class="login-tip">登录</span>';
    expect(createAuthDetector().getState()).toBe('unknown');
  });

  it('隐藏元素（display:none）不得命中', () => {
    document.body.innerHTML = '<div class="user-nav" style="display:none">张伟</div>';
    expect(createAuthDetector().getState()).toBe('unknown');
  });

  it('去抖 300ms，状态变化只回调一次；相同状态重复突变不重复回调；stop 后不再回调', async () => {
    vi.useFakeTimers();
    try {
      const detector = createAuthDetector();
      const cb = vi.fn();
      detector.start(cb);

      // 登录标志出现 → 去抖后回调一次
      append('user-nav');
      await settle();
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenLastCalledWith('logged_in');

      // 相同状态继续突变 → 不重复回调
      append('figure');
      append('header-user');
      await settle();
      expect(cb).toHaveBeenCalledTimes(1);

      // stop 后再突变 → 不再回调
      detector.stop();
      append('user-info');
      await settle();
      expect(cb).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

afterEach(() => {
  vi.useRealTimers();
});
