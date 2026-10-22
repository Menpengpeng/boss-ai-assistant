/**
 * 岗位分析 Prompt（F3）。
 * 角色：资深求职顾问；输出 JobAnalysis 结构化 JSON，每条风险附 JD 原文依据。
 */
import type { JobPayload } from '../shared/protocol';
import type { LLMPayload } from '../shared/protocol';

import {
  COMMON_RULES,
  formatJobHeader,
  formatTags,
  jsonSchemaHint,
  parseJsonResult,
  readResumeText,
  resolveJdText,
} from './common';
import { guardJobAnalysis } from './guards';
import type { PromptDef } from './types';

/** 输出结构说明。 */
const SCHEMA = `{
  "summary": "一句话概括岗位（不超过 60 字）",
  "duties": ["核心职责，逐条列出"],
  "skills": ["硬性技能要求，逐条列出"],
  "nice": ["加分项，无则空数组"],
  "red": [
    {
      "level": "高|中|低",
      "type": "风险类型（如 转移微信 / 收费培训 / 押金 / 加班暗示 / 职责边界模糊）",
      "conclusion": "不超过 40 字的中文结论",
      "evidence": "从输入文本中原样复制的片段",
      "src": "JD|薪资|标签"
    }
  ],
  "strengths": ["候选人优势，依据简历"],
  "gaps": ["候选人缺口，依据简历"],
  "advice": ["针对本岗位的改进建议"]
}`;

const SYSTEM = [
  '你是一位资深求职顾问，擅长从招聘 JD 拆解岗位、识别潜在风险，帮助求职者判断岗位是否值得投递。',
  '请按「核心职责 / 技能要求 / 加分项」三个维度拆解 JD，并识别风险信号。',
  '常见风险信号包括：职责边界模糊（如「完成领导交办的其他事务」）、要求远超薪资（薪资区间跨度过大）、加班暗示（如「抗压能力强」「弹性工作」「大小周」）、外包或派遣、非正式用工、性别或年龄限制、公司信息模糊。',
  'red 每条必须给出 level（高/中/低）、type、conclusion（不超过 40 字）、evidence（输入文本中原样复制的片段）、src（JD / 薪资 / 标签）；没有风险时 red 输出空数组，不要编造。',
  '岗位与公司信息一律依据输入文本；无法从输入确认的公司情况写「未提供」，涉及公司的结论请使用「基于页面信息，非权威核实」的口径。',
  '若未提供简历，strengths / gaps / advice 请说明「未提供简历，无法评估」，不要编造候选人的经历。',
  COMMON_RULES,
  jsonSchemaHint(SCHEMA),
].join('\n\n');

/** 岗位分析 Prompt（F3）。 */
export const jobAnalysisPrompt: PromptDef = {
  task: 'jobAnalysis',
  output: 'json',
  system: SYSTEM,
  buildUser(payload: LLMPayload): string {
    const { job, manualJd } = payload as JobPayload;
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
      '请分析该岗位并按要求输出 JSON。',
    ].join('\n');
  },
  parseResult(raw: string) {
    return parseJsonResult(raw, guardJobAnalysis, '岗位分析结果缺少必要字段（概括为空，或职责与技能均为空）');
  },
  evidencePools(payload: LLMPayload) {
    const { job, manualJd } = payload as JobPayload;
    return {
      JD: resolveJdText(job, manualJd),
      '薪资': job?.salary ?? '',
      '标签': formatTags(job),
    };
  },
};
