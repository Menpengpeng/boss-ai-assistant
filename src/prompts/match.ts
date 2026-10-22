/**
 * 简历匹配度 Prompt（F4）。
 * 输出 0–100 匹配度与优势、缺失技能、建议补充点。
 */
import type { MatchPayload } from '../shared/protocol';
import type { LLMPayload } from '../shared/protocol';

import {
  COMMON_RULES,
  formatJobHeader,
  jsonSchemaHint,
  parseJsonResult,
  readResumeText,
  resolveJdText,
} from './common';
import { guardMatch } from './guards';
import type { PromptDef } from './types';

/** 输出结构说明。 */
const SCHEMA = `{
  "score": 0,
  "strengths": ["候选人相对该岗位的优势，依据简历"],
  "gaps": ["缺失技能或经历"],
  "advice": ["建议补充点 / 面试准备方向"]
}`;

const SYSTEM = [
  '你是一位资深求职顾问，负责评估候选人简历与目标岗位的匹配度。',
  'score 为 0–100 的整数，表示简历与岗位要求的整体匹配程度；strengths / gaps / advice 均需给出具体、可执行的条目。',
  '只能依据提供的简历与 JD 判断，不得补充双方未写明的经历、学历、证书或项目。',
  COMMON_RULES,
  jsonSchemaHint(SCHEMA),
].join('\n\n');

/** 匹配度 Prompt（F4）。 */
export const matchPrompt: PromptDef = {
  task: 'match',
  output: 'json',
  system: SYSTEM,
  buildUser(payload: LLMPayload): string {
    const { job, manualJd } = payload as MatchPayload;
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
      '请给出匹配度评分与分析，输出 JSON。',
    ].join('\n');
  },
  parseResult(raw: string) {
    return parseJsonResult(raw, guardMatch, '匹配度结果缺少 score 字段');
  },
};
