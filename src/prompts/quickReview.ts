/**
 * 列表页 AI 快评 Prompt（F7）。
 * 只依据列表卡片可见信息（标题/公司/薪资/标签）输出分数徽标所需的 QuickReview。
 */
import type { QuickReviewPayload } from '../shared/protocol';
import type { LLMPayload } from '../shared/protocol';

import { COMMON_RULES, formatTags, jsonSchemaHint, parseJsonResult, textOrMissing } from './common';
import { guardQuickReview } from './guards';
import type { PromptDef } from './types';

/** 输出结构说明。 */
const SCHEMA = `{
  "score": 0,
  "verdict": "不超过 20 字的一句话结论；信息不足时写「信息不足」",
  "riskLevel": "高|中|低",
  "riskCount": 0
}`;

const SYSTEM = [
  '你是一位求职顾问，负责对招聘列表页的岗位卡片做快速评估，输出综合吸引力评分与一句话结论。',
  '只能依据卡片可见信息（岗位标题、公司名称、薪资、城市、标签）判断，不得使用先验知识补充公司或岗位事实。',
  'score 为 0–100 的整数，表示该岗位的综合吸引力；verdict 不超过 20 字，信息不足时写「信息不足」；riskCount 为识别到的风险条数。',
  COMMON_RULES,
  jsonSchemaHint(SCHEMA),
].join('\n\n');

/** 列表快评 Prompt（F7）。 */
export const quickReviewPrompt: PromptDef = {
  task: 'quickReview',
  output: 'json',
  system: SYSTEM,
  buildUser(payload: LLMPayload): string {
    const { job } = payload as QuickReviewPayload;
    return [
      '【列表卡片可见信息】',
      `岗位标题：${textOrMissing(job?.title)}`,
      `公司名称：${textOrMissing(job?.company)}`,
      `薪资：${textOrMissing(job?.salary)}`,
      `城市：${textOrMissing(job?.city)}`,
      `岗位标签：${textOrMissing(formatTags(job))}`,
      '',
      '请给出综合吸引力评分与一句话结论，输出 JSON。',
    ].join('\n');
  },
  parseResult(raw: string) {
    return parseJsonResult(raw, guardQuickReview, '快评结果缺少 score 字段或结构不符合要求');
  },
};
