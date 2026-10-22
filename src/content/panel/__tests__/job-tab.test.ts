// @vitest-environment jsdom
// 职位页标签组纯函数单测：错误动作映射 / 文本导出 / 公司证据池 / 评分取值。
import { describe, expect, it } from 'vitest';
import type { ErrorAction } from '../../../shared/errors';
import type { JobAnalysis, JobInfo } from '../../../shared/types';
import type { CompanyPageInfo } from '../../../content/parsers';
import { actions } from '../store';
import type { PanelHost, PanelState } from '../types';
import {
  analysisToText,
  companyPageTextOf,
  companyToText,
  mapErrorAction,
  matchLabel,
  pickScore,
} from '../tabs/job';

/** 构造一个详情页岗位。 */
function jobStub(): JobInfo {
  return {
    id: 'j1',
    title: '前端工程师',
    company: '示例科技',
    salary: '20-30K',
    city: '上海',
    experience: '3-5年',
    education: '本科',
    tags: ['React'],
    jd: ['负责前端开发'],
    hrName: '张女士',
    url: 'https://www.zhipin.com/job_detail/1.html',
    source: 'detail',
  };
}

describe('mapErrorAction：ERROR_TIPS 动作 → 统一动作', () => {
  const calls: string[] = [];
  const host = {
    openOptions: (hash?: string) => calls.push(`openOptions:${hash ?? ''}`),
    requestLogin: () => calls.push('requestLogin'),
  } as unknown as PanelHost;
  const retry = (): void => {
    calls.push('retry');
  };
  const paste = (): void => {
    calls.push('paste');
  };

  const cases: [ErrorAction, string][] = [
    ['opts-api', 'openOptions:api'],
    ['grant', 'openOptions:api'],
    ['opts-resume', 'openOptions:resume'],
    ['login', 'requestLogin'],
    ['retry', 'retry'],
    ['paste', 'paste'],
  ];

  it('逐个动作只触发对应回调', () => {
    for (const [action, expected] of cases) {
      calls.length = 0;
      mapErrorAction(action, host, { retry, paste });
      expect(calls).toEqual([expected]);
    }
  });

  it("'none' 不触发任何动作", () => {
    calls.length = 0;
    mapErrorAction('none', host, { retry, paste });
    expect(calls).toEqual([]);
  });
});

describe('analysisToText：纯文本版导出', () => {
  const data: JobAnalysis = {
    summary: '偏前端的全栈岗位',
    duties: ['负责前端开发'],
    skills: ['React'],
    nice: [],
    red: [],
    strengths: [],
    gaps: [],
    advice: [],
  };

  it('包含各区块，空字段显示「未提供」', () => {
    const text = analysisToText(jobStub(), data);
    expect(text).toContain('岗位：前端工程师');
    expect(text).toContain('一句话概括：偏前端的全栈岗位');
    expect(text).toContain('核心职责：\n- 负责前端开发');
    expect(text).toContain('技能要求：\n- React');
    expect(text).toContain('加分项：\n未提供');
    expect(text).toContain('风险信号：\n未提供');
  });
});

describe('公司证据池与文本导出', () => {
  const co: CompanyPageInfo = {
    name: '示例科技',
    intro: '专注工具软件',
    size: '100-499人',
    industry: '互联网',
    financing: 'A轮',
  };

  it('companyPageTextOf：null 返回空串，否则拼接页面字段', () => {
    expect(companyPageTextOf(null)).toBe('');
    const pool = companyPageTextOf(co);
    expect(pool).toContain('示例科技');
    expect(pool).toContain('A轮');
    expect(pool).toContain('专注工具软件');
  });

  it('companyToText：点数编号 + 固定非权威核实标注', () => {
    const out = companyToText({
      points: [{ label: '业务方向', value: '工具软件' }],
      risks: [],
      note: '',
    });
    expect(out).toContain('1. 业务方向：工具软件');
    expect(out).toContain('基于页面信息，非权威核实');
  });
});

describe('评分取值与分档文案', () => {
  it('matchLabel 分档：≥70 较高 / 50-69 一般 / <50 偏低', () => {
    expect(matchLabel(70)).toBe('匹配度较高');
    expect(matchLabel(69)).toBe('匹配度一般');
    expect(matchLabel(49)).toBe('匹配度偏低');
  });

  it('pickScore：对比表优先，其次匹配度结果，都没有为 null', () => {
    const job = jobStub();
    const base: PanelState = actions.createInitialState();
    expect(pickScore(base, job)).toBeNull();

    const withMatch: PanelState = {
      ...base,
      slots: {
        ...base.slots,
        match: {
          status: 'success',
          data: { score: 55, strengths: [], gaps: [], advice: [] },
          error: null,
          stream: '',
          dropped: 0,
        },
      },
    };
    expect(pickScore(withMatch, job)).toBe(55);

    const withCompare: PanelState = {
      ...base,
      compare: [{ jobId: job.id, job, score: 88, red: [], addedAt: 0 }],
    };
    expect(pickScore(withCompare, job)).toBe(88);
  });
});
