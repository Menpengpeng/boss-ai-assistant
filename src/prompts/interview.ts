/**
 * 面试题预测 Prompt（F11）。
 * 按 JD 与简历生成 5–8 道面试题与回答思路。
 */
import type { InterviewPayload } from '../shared/protocol';
import type { LLMPayload } from '../shared/protocol';

import { COMMON_RULES, formatJobHeader, jsonSchemaHint, parseJsonResult, readResumeText, resolveJdText } from './common';
import { guardInterview } from './guards';
import type { PromptDef } from './types';

/** 输出结构说明。 */
const SCHEMA = `{
  "questions": [
    { "q": "面试题目", "idea": "回答思路，不超过 80 字" }
  ]
}`;

const SYSTEM = [
  '你是一位面试辅导专家，负责根据 JD 与候选人简历预测面试官可能提出的问题，并给出回答思路。',
  '必须输出 5–8 道题，围绕 JD 的核心职责与技能要求展开，难度可由浅入深；idea 为简洁可执行的回答思路（如 STAR 结构要点）。',
  '不得编造简历中不存在的经历、学历、证书或项目；未提供简历时，题目可侧重岗位通用能力。',
  COMMON_RULES,
  jsonSchemaHint(SCHEMA),
].join('\n\n');

/** 面试题预测 Prompt（F11）。 */
export const interviewPrompt: PromptDef = {
  task: 'interview',
  output: 'json',
  system: SYSTEM,
  buildUser(payload: LLMPayload): string {
    const { job, manualJd } = payload as InterviewPayload;
    const jd = resolveJdText(job, manualJd);
    const resume = readResumeText(payload);
    return [
      '【岗位信息】',
      formatJobHeader(job),
      '',
      '【JD 正文】',
      jd || '未提供',
      '',
      '【候选人简历】',
      resume || '未提供简历',
      '',
      '请预测 5–8 道面试题并给出回答思路，输出 JSON。',
    ].join('\n');
  },
  parseResult(raw: string) {
    return parseJsonResult(raw, guardInterview, '面试题结果结构不符合要求');
  },
};
