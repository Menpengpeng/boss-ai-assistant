import { describe, expect, it } from 'vitest';
import {
  asRiskLevel,
  asString,
  asStringArray,
  clampScore,
  extractJson,
  isPlainObject,
  isScoreBadge,
  normalizeWhitespace,
  pageTextFor,
  truncate,
  validateEvidence,
} from '../validate';
import type { JobInfo, RiskItem } from '../types';

describe('extractJson', () => {
  it('解析纯 JSON 对象', () => {
    expect(extractJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it('解析 ```json 围栏', () => {
    expect(extractJson<{ a: number }>('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('解析前后带解释文字的 JSON', () => {
    const raw = '好的，分析结果如下：{"a":1,"b":"x"} 以上。';
    expect(extractJson<{ a: number; b: string }>(raw)).toEqual({ a: 1, b: 'x' });
  });

  it('解析数组', () => {
    expect(extractJson<number[]>('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('无法解析时返回 null', () => {
    expect(extractJson('完全没有 JSON')).toBeNull();
    expect(extractJson('{坏的 json}')).toBeNull();
    expect(extractJson('')).toBeNull();
  });

  it('剥离推理模型 <think> 思考块（块内含花括号草稿）', () => {
    const raw = '<think>用户要 JSON，我先打个草稿 {"draft":true,"score":80} 嗯就这样</think>\n{"a":1}';
    expect(extractJson<{ a: number }>(raw)).toEqual({ a: 1 });
  });

  it('截断未闭合的 <think> 块整体丢弃', () => {
    expect(extractJson('<think>思考中，先分析一下 {"half":')).toBeNull();
  });

  it('输出多个 JSON 对象时取第一个（后续解释文字不再打穿跨度）', () => {
    const raw = '{"a":1}\n\n补充说明：另一个对象 {"b":2} 仅供参考';
    expect(extractJson<{ a: number }>(raw)).toEqual({ a: 1 });
  });

  it('修复尾逗号', () => {
    expect(extractJson<{ a: number }>('{"a":1,}')).toEqual({ a: 1 });
    expect(extractJson<number[]>('[1,2,3,]')).toEqual([1, 2, 3]);
  });

  it('修复字符串值内的裸换行与制表符', () => {
    const raw = '{"summary":"职责一\n职责二\t职责三","score":1}';
    const parsed = extractJson<{ summary: string }>(raw);
    expect(parsed).toEqual({ summary: '职责一\n职责二\t职责三', score: 1 });
  });

  it('解释文字里出现的引号和花括号不干扰配对扫描', () => {
    const raw = '我说"{ 这个不是 JSON"然后输出 {"a":1}';
    expect(extractJson<{ a: number }>(raw)).toEqual({ a: 1 });
  });

  it('围栏 + 前后解释文字', () => {
    const raw = '结果如下：\n```json\n{"a":1}\n```\n以上是结果。';
    expect(extractJson<{ a: number }>(raw)).toEqual({ a: 1 });
  });
});

describe('字段归一化', () => {
  it('isPlainObject', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject('x')).toBe(false);
  });

  it('asString', () => {
    expect(asString('a')).toBe('a');
    expect(asString(1)).toBe('1');
    expect(asString(null)).toBe('');
    expect(asString(null, 'f')).toBe('f');
  });

  it('asStringArray', () => {
    expect(asStringArray(['a', 1, null])).toEqual(['a', '1']);
    expect(asStringArray('x')).toEqual(['x']);
    expect(asStringArray(123)).toEqual([]);
  });

  it('normalizeWhitespace', () => {
    expect(normalizeWhitespace('a\n  b\tc ')).toBe('a b c');
  });

  it('truncate 保证不超过上限', () => {
    expect(truncate('abcdef', 10)).toBe('abcdef');
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abcdef', 0)).toBe('');
  });
});

describe('clampScore', () => {
  it('边界与非法值', () => {
    expect(clampScore(-1)).toBe(0);
    expect(clampScore(101)).toBe(100);
    expect(clampScore('abc')).toBe(0);
    expect(clampScore(55.6)).toBe(56);
    expect(clampScore('72')).toBe(72);
  });
});

describe('asRiskLevel', () => {
  it('合法值原样返回，非法值回退「低」', () => {
    expect(asRiskLevel('高')).toBe('高');
    expect(asRiskLevel('中')).toBe('中');
    expect(asRiskLevel('低')).toBe('低');
    expect(asRiskLevel('HIGH')).toBe('低');
    expect(asRiskLevel(null)).toBe('低');
  });
});

describe('pageTextFor', () => {
  const job = {
    id: 'j1',
    title: 't',
    company: 'c',
    salary: '20-40K',
    city: '合肥',
    experience: '5-10年',
    education: '本科',
    tags: ['React', 'TS'],
    jd: ['职责一', '职责二'],
    hrName: '刘女士',
    url: 'https://www.zhipin.com/job_detail/x',
    source: 'detail',
  } as JobInfo;

  it('按证据来源取文本池', () => {
    expect(pageTextFor(job, 'JD')).toBe('职责一\n职责二');
    expect(pageTextFor(job, '薪资')).toBe('20-40K');
    expect(pageTextFor(job, '标签')).toBe('React TS');
    expect(pageTextFor(job, '聊天', 'HR 原话')).toBe('HR 原话');
  });
});

describe('validateEvidence', () => {
  const pool = '职责一：负责核心系统开发\n\n   搭建自动化测试框架';
  const text = (_item: RiskItem): string => pool;

  it('丢弃不存在子串、保留存在子串（含空白差异场景）', () => {
    const okItem: RiskItem = {
      level: '中',
      type: '高强度',
      conclusion: '工作强度偏高',
      evidence: '负责核心系统开发',
      src: 'JD',
    };
    const whitespaceItem: RiskItem = {
      level: '低',
      type: '空白差异',
      conclusion: '换行与多空格应被容忍',
      evidence: '负责核心系统开发\n   搭建自动化测试框架',
      src: 'JD',
    };
    const badItem: RiskItem = {
      level: '高',
      type: '幻觉',
      conclusion: '原文中不存在',
      evidence: '要求身高 180 以上',
      src: 'JD',
    };
    const emptyItem: RiskItem = {
      level: '低',
      type: '空证据',
      conclusion: '无证据',
      evidence: '',
      src: 'JD',
    };

    const { ok, drop } = validateEvidence([okItem, whitespaceItem, badItem, emptyItem], text);
    expect(ok).toEqual([okItem, whitespaceItem]);
    expect(drop).toEqual([badItem, emptyItem]);
  });
});

describe('isScoreBadge', () => {
  it('合法徽标通过，非法返回 false', () => {
    expect(isScoreBadge({ score: 80, verdict: '较匹配', riskLevel: '低', riskCount: 1 })).toBe(true);
    expect(isScoreBadge({ score: '80', verdict: 'x', riskLevel: '低', riskCount: 1 })).toBe(false);
    expect(isScoreBadge({ score: 80, verdict: 'x', riskLevel: '极高', riskCount: 1 })).toBe(false);
    expect(isScoreBadge(null)).toBe(false);
  });
});
