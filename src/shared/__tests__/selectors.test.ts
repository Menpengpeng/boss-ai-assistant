// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { attrOf, qs, qsa, textOf, URL_PATTERNS } from '../selectors';

const HTML = `
  <div class="job-detail" data-jobid="job-abc-123">
    <h1 class="job-name">高级前端工程师</h1>
    <span class="salary">20-40K·14薪</span>
    <ul class="job-keyword-list">
      <li>React</li>
      <li>TypeScript</li>
      <li>性能优化</li>
    </ul>
    <div class="job-sec-text">
      负责核心系统开发   与
      性能优化
    </div>
  </div>
`;

describe('selectors 多候选命中', () => {
  beforeEach(() => {
    document.body.innerHTML = HTML;
  });

  it('qs 依序尝试并返回首个命中元素', () => {
    const el = qs<HTMLElement>(document.body, ['#not-exist', '.job-detail .job-name', 'h1']);
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe('高级前端工程师');
  });

  it('qs 支持 [class*="xxx"] 候选', () => {
    const el = qs<HTMLElement>(document.body, ['[class*="salary"]']);
    expect(el?.textContent).toBe('20-40K·14薪');
  });

  it('qsa 返回首个有命中的选择器的全部结果', () => {
    const list = qsa<HTMLElement>(document.body, ['.not-exist', '.job-keyword-list li']);
    expect(list.map((li) => li.textContent)).toEqual(['React', 'TypeScript', '性能优化']);
  });

  it('textOf 压缩空白', () => {
    expect(textOf(document.body, ['.job-sec-text'])).toBe('负责核心系统开发 与 性能优化');
  });

  it('attrOf 依序取属性', () => {
    expect(attrOf(document.body, ['.job-detail'], ['data-job-id', 'data-jobid'])).toBe('job-abc-123');
  });
});

describe('selectors 未命中路径', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div class="wrapper"></div>';
  });

  it('qs 未命中返回 null', () => {
    expect(qs(document.body, ['#not-exist', '.job-name'])).toBeNull();
  });

  it('qsa 未命中返回空数组', () => {
    expect(qsa(document.body, ['#not-exist', '.job-name'])).toEqual([]);
  });

  it('textOf / attrOf 未命中返回空串，root 为 null 时同样安全', () => {
    expect(textOf(document.body, ['#not-exist'])).toBe('');
    expect(attrOf(document.body, ['#not-exist'], ['data-jobid'])).toBe('');
    expect(textOf(null, ['#not-exist'])).toBe('');
    expect(attrOf(null, ['#not-exist'], ['data-jobid'])).toBe('');
  });
});

describe('URL_PATTERNS', () => {
  it('识别详情 / 列表 / 聊天三类路径', () => {
    expect(URL_PATTERNS.jobDetail.test('/job_detail/abcd.html')).toBe(true);
    expect(URL_PATTERNS.jobList.test('/web/geek/job')).toBe(true);
    expect(URL_PATTERNS.jobList.test('/job/all')).toBe(true);
    expect(URL_PATTERNS.chat.test('/web/geek/chat')).toBe(true);
    expect(URL_PATTERNS.jobDetail.test('/web/geek/job')).toBe(false);
  });
});
