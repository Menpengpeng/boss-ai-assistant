// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { parseJobDetail } from '../jobDetail';
import { loadHtml, parseInline } from './loadHtml';

describe('parseJobDetail 命中路径', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('解析标题/公司/薪资/城市/经验/学历/标签/JD/HR', () => {
    const job = parseJobDetail(loadHtml('job-detail.html'));
    expect(job).not.toBeNull();
    expect(job?.title).toBe('软件测试高级工程师');
    expect(job?.company).toBe('合肥中科采象科技');
    // 回归：真实详情页顶部导航有 a[href*="/gongsi/"] 的「公司」链接，公司名不得取到它
    expect(job?.company).not.toBe('公司');
    expect(job?.salary).toBe('18-35K·14薪');
    expect(job?.city).toBe('合肥·高新区');
    expect(job?.experience).toBe('5-10年');
    expect(job?.education).toBe('本科');
    expect(job?.hrName).toBe('王先生');
    expect(job?.source).toBe('detail');
  });

  it('标签去重并剔除超长噪声文本', () => {
    const job = parseJobDetail(loadHtml('job-detail.html'));
    expect(job?.tags).toEqual(['性能测试', '自动化测试', '5-10年']);
  });

  it('JD 按块级子元素分段（3 段）且已压缩空白', () => {
    const job = parseJobDetail(loadHtml('job-detail.html'));
    expect(job?.jd.length).toBe(3);
    expect(job?.jd[0]).toBe('1、负责核心系统的性能与功能测试方案设计；');
    expect(job?.jd[2]).toContain('推动质量左移');
  });

  it('id 取 URL 路径分支', () => {
    window.history.replaceState({}, '', '/job_detail/url-9999.html');
    const job = parseJobDetail(loadHtml('job-detail.html'));
    expect(job?.id).toBe('url-9999');
    expect(job?.url).toContain('/job_detail/url-9999.html');
  });

  it('id 取 jobIdAttrs 属性分支', () => {
    const job = parseJobDetail(loadHtml('job-detail.html'));
    expect(job?.id).toBe('BOSSTEST0001');
  });

  it('id 取哈希分支（无 URL / 无属性）', () => {
    const doc = loadHtml('job-detail.html');
    doc.querySelector('[data-jobid]')?.removeAttribute('data-jobid');
    const job = parseJobDetail(doc);
    expect(job?.id).toMatch(/^[0-9a-f]{8}$/);
  });

  it('同一 HTML 解析两次 id 稳定相同', () => {
    const first = parseJobDetail(loadHtml('job-detail.html'));
    const second = parseJobDetail(loadHtml('job-detail.html'));
    expect(first?.id).toBe(second?.id);
  });
});

describe('parseJobDetail 失败路径', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('无关 HTML → null', () => {
    expect(parseJobDetail(parseInline('<div class="wrapper">无关内容</div>'))).toBeNull();
  });

  it('缺失 JD 正文 → null', () => {
    const doc = loadHtml('job-detail.html');
    // fixture 中 JD 与公司介绍各有一个 job-sec-text，需全部移除才是「缺失」
    doc.querySelectorAll('.job-sec-text, [class*="job-sec-text"]').forEach((el) => el.remove());
    expect(parseJobDetail(doc)).toBeNull();
  });

  it('缺失标题 → null', () => {
    const doc = loadHtml('job-detail.html');
    // 顶部职位标题容器的 .job-title 也是标题候选，需一并移除
    doc.querySelectorAll('.job-name, .job-title, [class*="job-title"]').forEach((el) => el.remove());
    expect(parseJobDetail(doc)).toBeNull();
  });
});
