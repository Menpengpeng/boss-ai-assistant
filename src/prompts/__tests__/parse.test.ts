import { describe, expect, it } from 'vitest';
import {
  chatRiskPrompt,
  greetingPrompt,
  jobAnalysisPrompt,
  matchPrompt,
  quickReviewPrompt,
} from '../index';

/** 合法的岗位分析 JSON 文本。 */
const jobAnalysisJson = JSON.stringify({
  summary: '前端开发岗位，偏业务交付。',
  duties: ['负责前端页面开发'],
  skills: ['React'],
  red: [],
  strengths: [],
  gaps: [],
  advice: [],
});

describe('json 任务 parseResult', () => {
  it('纯 JSON → 成功', () => {
    const r = jobAnalysisPrompt.parseResult(jobAnalysisJson);
    expect(r.ok).toBe(true);
  });

  it('```json 围栏 → 成功', () => {
    const r = jobAnalysisPrompt.parseResult('```json\n' + jobAnalysisJson + '\n```');
    expect(r.ok).toBe(true);
  });

  it('前后带解释文字 → extractJson 容忍，成功', () => {
    const r = jobAnalysisPrompt.parseResult('好的，分析结果如下：' + jobAnalysisJson + ' 以上。');
    expect(r.ok).toBe(true);
  });

  it('完全非 JSON → 失败', () => {
    const r = jobAnalysisPrompt.parseResult('这是一段完全不含 JSON 的说明文字。');
    expect(r.ok).toBe(false);
  });

  it('合法 JSON 但结构不合法 → 失败（交给上层重试）', () => {
    const r = jobAnalysisPrompt.parseResult('{"foo":1}');
    expect(r.ok).toBe(false);
  });

  it('match 缺少 score → 失败', () => {
    const r = matchPrompt.parseResult(JSON.stringify({ strengths: ['a'] }));
    expect(r.ok).toBe(false);
  });

  it('quickReview 缺少 score → 失败', () => {
    const r = quickReviewPrompt.parseResult(JSON.stringify({ verdict: '信息不足' }));
    expect(r.ok).toBe(false);
  });

  it('chatRisk 缺 risks 数组 → 失败；有 risks 时归一化并保留非空证据项', () => {
    expect(chatRiskPrompt.parseResult('{}').ok).toBe(false);
    const r = chatRiskPrompt.parseResult(
      JSON.stringify({ risks: [{ level: '高', type: '转移微信', conclusion: 'c', evidence: '加我微信' }, { evidence: '' }] }),
    );
    expect(r.ok).toBe(true);
    const value = r.ok ? (r.value as { risks: unknown[] }) : { risks: [] };
    expect(value.risks).toHaveLength(1);
  });
});

describe('greeting 文本任务 parseResult', () => {
  it('去掉「打招呼语：」前缀，只保留正文', () => {
    const r = greetingPrompt.parseResult('打招呼语：你好，看到贵司在招前端，想了解下团队技术栈？');
    expect(r.ok).toBe(true);
    expect(String(r.ok ? r.value : '')).toContain('你好');
    expect(String(r.ok ? r.value : '')).not.toContain('打招呼语');
  });

  it('去掉代码围栏与包裹引号', () => {
    const r = greetingPrompt.parseResult('```\n"您好，我有三年 React 经验，想聊聊这个岗位。"\n```');
    expect(r.ok).toBe(true);
    expect(String(r.ok ? r.value : '')).toContain('三年 React 经验');
  });

  it('空文本 → 失败', () => {
    expect(greetingPrompt.parseResult('   ').ok).toBe(false);
  });
});
