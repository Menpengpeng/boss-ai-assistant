// @vitest-environment jsdom
// 页面类型识别（单页路由）单测：detectPageKind 的 chat > jobDetail > jobList 优先级与兜底 other。
// 说明：URL_PATTERNS 三条规则按路径前缀互斥（/web/geek/chat、/job_detail/、/web/geek/job），
// 因此这里用「全量映射表 + 查询串不参与判定 + 无参回退 location」三组断言锁定优先级与容错行为。
import { beforeEach, describe, expect, it } from 'vitest';
import { buildManualJob, detectPageKind } from '../index';

describe('detectPageKind', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('聊天页优先识别为 chat（含绝对 URL 形式）', () => {
    expect(detectPageKind('/web/geek/chat')).toBe('chat');
    expect(detectPageKind('/web/geek/chat/index')).toBe('chat');
    expect(detectPageKind('/chat/list')).toBe('chat');
    expect(detectPageKind('https://www.zhipin.com/web/geek/chat')).toBe('chat');
  });

  it('职位详情页识别为 jobDetail', () => {
    expect(detectPageKind('/job_detail/abc123.html')).toBe('jobDetail');
    expect(detectPageKind('https://www.zhipin.com/job_detail/abc123.html')).toBe('jobDetail');
  });

  it('列表页识别为 jobList（/web/geek/job 与 /job/ 两种前缀）', () => {
    expect(detectPageKind('/web/geek/job')).toBe('jobList');
    expect(detectPageKind('/web/geek/job?query=test&city=101')).toBe('jobList');
    expect(detectPageKind('/job/list')).toBe('jobList');
  });

  it('只依据 pathname 判定：查询串中的其它路径不改变结果', () => {
    // 聊天页带「返回详情页」类查询串时，仍必须判为 chat（chat 优先级最高）
    expect(detectPageKind('/web/geek/chat?ref=/job_detail/abc.html')).toBe('chat');
    // 详情页带列表页查询串时，仍为 jobDetail（jobDetail 优先于 jobList）
    expect(detectPageKind('/job_detail/abc.html?from=/web/geek/job')).toBe('jobDetail');
  });

  it('未命中任何规则时返回 other', () => {
    expect(detectPageKind('/')).toBe('other');
    expect(detectPageKind('/web/geek/recommend')).toBe('other');
  });

  it('不传参时回退读取 location.href', () => {
    window.history.replaceState({}, '', '/job_detail/from-location.html');
    expect(detectPageKind()).toBe('jobDetail');
  });
});

describe('buildManualJob', () => {
  it('手动粘贴文本按行切分、压缩空白并剔除空行，source 固定为 manual', () => {
    const job = buildManualJob('  负责测试  \n\n第二行\t职责 ');
    expect(job.source).toBe('manual');
    expect(job.jd).toEqual(['负责测试', '第二行 职责']);
    expect(job.id).toMatch(/^[0-9a-f]{8}$/);
  });

  it('相同文本生成稳定 id', () => {
    expect(buildManualJob('同样的一段 JD').id).toBe(buildManualJob('同样的一段 JD').id);
  });
});
