// @vitest-environment jsdom
// 对比标签组纯函数单测：摘要文本、最高风险等级、匹配度文案。
import { describe, expect, it } from 'vitest';
import type { CompareItem, JobInfo, RiskItem } from '../../../shared/types';
import {
  compareRiskText,
  compareScoreText,
  compareSummaryText,
  highestRiskLevel,
} from '../tabs/compare';

/** 构造一条风险条目。 */
function risk(level: RiskItem['level']): RiskItem {
  return { level, type: '类型', conclusion: '结论', evidence: '原文', src: 'JD' };
}

/** 构造一个岗位信息。 */
function job(over: Partial<JobInfo> = {}): JobInfo {
  return {
    id: 'j1',
    title: '前端工程师',
    company: '示例公司',
    salary: '20-30K',
    city: '',
    experience: '',
    education: '',
    tags: [],
    jd: [],
    hrName: '',
    url: '',
    source: 'list',
    ...over,
  };
}

/** 构造一条对比项。 */
function item(over: Partial<CompareItem> = {}): CompareItem {
  return { jobId: 'j1', job: job(), score: 82, red: [], addedAt: 1, ...over };
}

describe('compare 纯函数', () => {
  it('highestRiskLevel 取最高等级，空数组返回 null', () => {
    expect(highestRiskLevel([])).toBeNull();
    expect(highestRiskLevel([risk('低'), risk('高'), risk('中')])).toBe('高');
    expect(highestRiskLevel([risk('低'), risk('中')])).toBe('中');
  });

  it('compareRiskText 同时给出条数与等级文字', () => {
    expect(compareRiskText([])).toBe('无明显风险');
    expect(compareRiskText([risk('中'), risk('低')])).toBe('2 条 · 最高中');
  });

  it('compareScoreText：null 显示未提供', () => {
    expect(compareScoreText(null)).toBe('未提供');
    expect(compareScoreText(88)).toBe('88');
  });

  it('compareSummaryText 生成表头 + 每行 5 列', () => {
    const text = compareSummaryText([item()]);
    const lines = text.split('\n');
    expect(lines[0]).toBe('岗位｜薪资｜公司｜匹配度｜风险');
    expect(lines[1]).toBe('前端工程师｜20-30K｜示例公司｜82｜无明显风险');
  });

  it('compareSummaryText 空列表返回空串', () => {
    expect(compareSummaryText([])).toBe('');
  });
});
