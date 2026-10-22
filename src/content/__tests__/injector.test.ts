// @vitest-environment jsdom
// 注入器门控单测：详情/列表注入、未登录清空、幂等、clear 只删自己节点。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState, PageKind } from '../../shared/types';
import { createInjector } from '../injector';

/** 构造注入器依赖。 */
function makeDeps() {
  return {
    getAuth: vi.fn<() => AuthState>(() => 'logged_in'),
    getPageKind: vi.fn<() => PageKind>(() => 'jobDetail'),
    onRequestAnalysis: vi.fn(),
    onRequestQuickReview: vi.fn(),
  };
}

/** 3 张列表卡片（使用 LIST_SELECTORS.card 的真实候选类名）。 */
function threeCards(): void {
  document.body.innerHTML =
    '<div class="job-card-wrapper">1</div>' +
    '<div class="job-card-wrapper">2</div>' +
    '<div class="job-card-wrapper">3</div>' +
    '<div class="site-node">站点原有节点</div>';
}

describe('createInjector', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('logged_in + jobDetail → 注入 #boss-ai-detail-btn，点击只回调', () => {
    document.body.innerHTML = '<div class="job-primary"><div class="site-node">原节点</div></div>';
    const deps = makeDeps();
    const injector = createInjector(deps);

    injector.apply('jobDetail', 'logged_in');

    const btn = document.getElementById('boss-ai-detail-btn') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.type).toBe('button');
    expect(btn.dataset.bossAi).toBe('1');
    expect(btn.getAttribute('aria-label')).toBeTruthy();

    btn.click();
    expect(deps.onRequestAnalysis).toHaveBeenCalledTimes(1);
    // clear 后站点原有节点保留
    injector.clear();
    expect(document.querySelector('.site-node')).not.toBeNull();
    expect(document.getElementById('boss-ai-detail-btn')).toBeNull();
  });

  it('logged_in + jobList → 为 3 张卡片各注入 1 个 .boss-ai-quick-btn，点击回调携带卡片与序号', () => {
    threeCards();
    const deps = makeDeps();
    const injector = createInjector(deps);

    injector.apply('jobList', 'logged_in');

    const btns = Array.from(document.querySelectorAll('.boss-ai-quick-btn'));
    expect(btns.length).toBe(3);
    expect(btns.map((b) => (b as HTMLElement).dataset.bossAiIndex)).toEqual(['0', '1', '2']);

    (btns[1] as HTMLButtonElement).click();
    expect(deps.onRequestQuickReview).toHaveBeenCalledTimes(1);
    const card = document.querySelectorAll('.job-card-wrapper')[1];
    expect(deps.onRequestQuickReview.mock.calls[0][0]).toBe(card);
    expect(deps.onRequestQuickReview.mock.calls[0][1]).toBe(1);
  });

  it('logged_out → 详情与列表控件都不存在', () => {
    threeCards();
    document.body.insertAdjacentHTML('afterbegin', '<div class="job-primary"></div>');
    const injector = createInjector(makeDeps());

    injector.apply('jobDetail', 'logged_out');
    expect(document.getElementById('boss-ai-detail-btn')).toBeNull();
    injector.apply('jobList', 'logged_out');
    expect(document.querySelectorAll('.boss-ai-quick-btn').length).toBe(0);
  });

  it('apply 幂等：重复调用不产生重复按钮', () => {
    threeCards();
    document.body.insertAdjacentHTML('afterbegin', '<div class="job-primary"></div>');
    const injector = createInjector(makeDeps());

    injector.apply('jobDetail', 'logged_in');
    injector.apply('jobDetail', 'logged_in');
    expect(document.querySelectorAll('#boss-ai-detail-btn').length).toBe(1);

    injector.apply('jobList', 'logged_in');
    injector.apply('jobList', 'logged_in');
    expect(document.querySelectorAll('.boss-ai-quick-btn').length).toBe(3);
  });

  it('chat → 不注入任何按钮', () => {
    threeCards();
    const injector = createInjector(makeDeps());
    injector.apply('chat', 'logged_in');
    expect(document.querySelectorAll('[data-boss-ai]').length).toBe(0);
  });

  it('clear(kind) 只删对应类型的节点', () => {
    threeCards();
    document.body.insertAdjacentHTML('afterbegin', '<div class="job-primary"></div>');
    const injector = createInjector(makeDeps());

    // 注入详情按钮后 clear('jobList') 不应影响它（此时没有快评节点）
    injector.apply('jobDetail', 'logged_in');
    expect(document.getElementById('boss-ai-detail-btn')).not.toBeNull();
    injector.clear('jobList');
    expect(document.getElementById('boss-ai-detail-btn')).not.toBeNull();

    // 再注入列表快评（apply 会清掉详情按钮），clear('jobDetail') 不影响快评节点
    injector.apply('jobList', 'logged_in');
    expect(document.querySelectorAll('.boss-ai-quick-btn').length).toBe(3);
    injector.clear('jobDetail');
    expect(document.querySelectorAll('.boss-ai-quick-btn').length).toBe(3);

    injector.clear('jobList');
    expect(document.querySelectorAll('.boss-ai-quick-btn').length).toBe(0);
  });

  it('dispose 移除全部注入节点且保留站点节点', () => {
    threeCards();
    document.body.insertAdjacentHTML('afterbegin', '<div class="job-primary"></div>');
    const injector = createInjector(makeDeps());

    injector.apply('jobDetail', 'logged_in');
    injector.apply('jobList', 'logged_in');
    injector.dispose();

    expect(document.querySelectorAll('[data-boss-ai]').length).toBe(0);
    expect(document.querySelector('.site-node')).not.toBeNull();
    expect(document.querySelectorAll('.job-card-wrapper').length).toBe(3);
  });
});
