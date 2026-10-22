import { describe, expect, it } from 'vitest';
import {
  guardChatInsight,
  guardCompany,
  guardInterview,
  guardJobAnalysis,
  guardMatch,
  guardQuickReview,
  normalizeRiskList,
} from '../guards';

/** 合法的岗位分析输出样例（duties 含重复项、red 含空证据项）。 */
function validJobAnalysis() {
  return {
    summary: '政府关系类岗位：政策研究与对外沟通。',
    duties: ['政策跟踪', '公文写作', '政策跟踪'],
    skills: ['公文写作'],
    nice: [],
    red: [
      { level: '高', type: '转移微信', conclusion: '要求加微信私下沟通', evidence: '加我微信' },
      { level: '中', type: '加班暗示', conclusion: '暗示加班', evidence: '   ' },
    ],
    strengths: ['文字功底'],
    gaps: ['政府资源'],
    advice: ['整理作品集'],
  };
}

describe('guardJobAnalysis', () => {
  it('合法输入：归一化列表并丢弃空证据风险项', () => {
    const r = guardJobAnalysis(validJobAnalysis());
    expect(r).not.toBeNull();
    expect(r!.duties).toEqual(['政策跟踪', '公文写作']);
    expect(r!.skills).toEqual(['公文写作']);
    expect(r!.red).toHaveLength(1);
    expect(r!.red[0]).toMatchObject({ level: '高', type: '转移微信', evidence: '加我微信' });
  });

  it('缺少 summary 或职责/技能全空时返回 null', () => {
    expect(guardJobAnalysis({ duties: ['a'] })).toBeNull();
    expect(guardJobAnalysis({ summary: '   ', duties: ['a'] })).toBeNull();
    expect(guardJobAnalysis({ summary: '概括', duties: [], skills: [] })).toBeNull();
  });

  it('空对象 / null / 类型错误返回 null', () => {
    expect(guardJobAnalysis({})).toBeNull();
    expect(guardJobAnalysis(null)).toBeNull();
    expect(guardJobAnalysis('字符串不是对象')).toBeNull();
    expect(guardJobAnalysis([])).toBeNull();
  });
});

describe('guardMatch', () => {
  it('要求 score 存在，并按 0..100 收敛', () => {
    expect(guardMatch({})).toBeNull();
    expect(guardMatch({ score: 120, strengths: ['a'] })!.score).toBe(100);
    expect(guardMatch({ score: -5 })!.score).toBe(0);
    expect(guardMatch({ score: 'abc' })!.score).toBe(0);
    expect(guardMatch({ score: 68 })!.score).toBe(68);
  });
});

describe('guardChatInsight', () => {
  it('replies.text 超过 60 字时被截断', () => {
    const r = guardChatInsight({
      intent: '确认薪资',
      stage: '谈薪',
      pending: '未提供',
      replies: [{ style: '简洁专业', text: '好'.repeat(100) }],
    });
    expect(r).not.toBeNull();
    expect(r!.replies[0].text.length).toBeLessThanOrEqual(60);
  });

  it('evidence 为空的风险条目被丢弃', () => {
    const r = guardChatInsight({
      replies: [],
      risks: [
        { level: '高', type: '索要身份证', conclusion: '高风险', evidence: '' },
        { level: '高', type: '索要身份证', conclusion: '高风险', evidence: '发我身份证' },
      ],
    });
    expect(r!.risks).toHaveLength(1);
  });

  it('null 返回 null', () => {
    expect(guardChatInsight(null)).toBeNull();
  });
});

describe('normalizeRiskList', () => {
  it('非法 level 回落到「低」，非法 src 回落到 fallback', () => {
    const list = normalizeRiskList([{ level: '极高', type: 't', conclusion: 'c', evidence: '原句' }], 'JD');
    expect(list).toHaveLength(1);
    expect(list[0].level).toBe('低');
    expect(list[0].src).toBe('JD');
  });

  it('证据为空的条目直接丢弃，非对象条目忽略', () => {
    const list = normalizeRiskList([null, 'x', { evidence: '' }], '聊天');
    expect(list).toEqual([]);
  });
});

describe('guardCompany', () => {
  it('note 固定为「基于页面信息，非权威核实」', () => {
    const r = guardCompany({
      points: [{ label: '业务方向', value: '出行' }],
      risks: [],
      note: '模型乱写的备注',
    });
    expect(r).not.toBeNull();
    expect(r!.note).toBe('基于页面信息，非权威核实');
    expect(r!.points[0]).toEqual({ label: '业务方向', value: '出行' });
  });

  it('null / 非对象返回 null', () => {
    expect(guardCompany(null)).toBeNull();
    expect(guardCompany(1)).toBeNull();
  });
});

describe('guardInterview', () => {
  it('超过 8 条时截断到 8 条', () => {
    const questions = Array.from({ length: 10 }, (_, i) => ({ q: `问题${i}`, idea: `思路${i}` }));
    const r = guardInterview({ questions });
    expect(r).not.toBeNull();
    expect(r!.questions).toHaveLength(8);
  });

  it('题量不足 5 条时仍返回（交由调用方决定）', () => {
    const r = guardInterview({ questions: [{ q: '只有一个问题', idea: '' }] });
    expect(r).not.toBeNull();
    expect(r!.questions).toHaveLength(1);
  });

  it('空对象返回空题目数组，null 返回 null', () => {
    expect(guardInterview({})!.questions).toEqual([]);
    expect(guardInterview(null)).toBeNull();
  });
});

describe('guardQuickReview', () => {
  it('score 越界收敛、非法 riskLevel 回落为「低」', () => {
    const r = guardQuickReview({ score: 120, verdict: '还可以', riskLevel: '很高', riskCount: -3 });
    expect(r).not.toBeNull();
    expect(r!.score).toBe(100);
    expect(r!.riskLevel).toBe('低');
    expect(r!.riskCount).toBe(0);
    expect(guardQuickReview({ score: 'abc' })!.score).toBe(0);
  });

  it('缺少 score 返回 null', () => {
    expect(guardQuickReview({ verdict: '信息不足' })).toBeNull();
    expect(guardQuickReview(null)).toBeNull();
  });
});
