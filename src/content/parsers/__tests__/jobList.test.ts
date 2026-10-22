// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { findCardElement, jobIdOfCardElement, jobInfoFromCard, parseJobList } from '../jobList';
import { loadHtml, parseInline } from './loadHtml';

describe('parseJobList 命中路径', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/web/geek/job');
  });

  it('解析 3 张卡片，index 从 0 起', () => {
    const cards = parseJobList(loadHtml('job-list.html'));
    expect(cards.length).toBe(3);
    expect(cards.map((c) => c.index)).toEqual([0, 1, 2]);
  });

  it('卡片字段与绝对 URL 正确', () => {
    const cards = parseJobList(loadHtml('job-list.html'));
    expect(cards[0].title).toBe('公共事务经理');
    expect(cards[0].company).toBe('滴滴');
    expect(cards[0].salary).toBe('20-40K·15薪');
    expect(cards[0].tags).toEqual(['5-10年', '本科', '政府渠道沟通']);
    expect(new URL(cards[0].url).pathname).toBe('/job_detail/list-0001.html');
    // 已是绝对 URL 的链接保持不变
    expect(cards[2].url).toBe('https://www.zhipin.com/job_detail/list-0003.html');
  });

  it('id 优先取链接内 jobId', () => {
    const cards = parseJobList(loadHtml('job-list.html'));
    expect(cards.map((c) => c.id)).toEqual(['list-0001', 'list-0002', 'list-0003']);
  });

  it('jobInfoFromCard：source=list 且 jd 为空数组', () => {
    const card = parseJobList(loadHtml('job-list.html'))[1];
    const job = jobInfoFromCard(card);
    expect(job.source).toBe('list');
    expect(job.jd).toEqual([]);
    expect(job.id).toBe(card.id);
    expect(job.title).toBe(card.title);
  });

  it('findCardElement：列表重渲染后仍按 id 定位', () => {
    const doc = loadHtml('job-list.html');
    const cards = parseJobList(doc);
    doc.querySelector('.job-card-wrapper')?.remove();
    const found = findCardElement(cards[1], doc);
    expect(found?.getAttribute('data-jobid')).toBe('list-0002');
  });

  it('jobIdOfCardElement：无链接时走哈希分支', () => {
    const doc = parseInline(
      '<div class="job-card-wrapper"><span class="job-name">测试岗</span><span class="salary">10-20K</span></div>',
    );
    const card = parseJobList(doc)[0];
    expect(card.id).toMatch(/^[0-9a-f]{8}$/);
    expect(jobIdOfCardElement(doc.querySelector('.job-card-wrapper') as Element, 0)).toBe(card.id);
  });
});

describe('parseJobList 失败路径', () => {
  it('无关 HTML → []', () => {
    expect(parseJobList(parseInline('<div class="wrapper"></div>'))).toEqual([]);
  });

  it('findCardElement 无卡片时返回 null', () => {
    const doc = parseInline('<div class="wrapper"></div>');
    const card = { id: 'x', index: 0, title: '', company: '', salary: '', tags: [], url: '' };
    expect(findCardElement(card, doc)).toBeNull();
  });
});
