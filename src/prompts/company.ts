/**
 * 公司分析 Prompt（F10）。
 * 基于页面信息（可合并用户粘贴的外部文本）输出要点；note 固定为「基于页面信息，非权威核实」。
 */
import type { CompanyPayload } from '../shared/protocol';
import type { LLMPayload } from '../shared/protocol';

import { COMMON_RULES, formatJobHeader, formatTags, jsonSchemaHint, parseJsonResult, resolveJdText } from './common';
import { guardCompany } from './guards';
import type { PromptDef } from './types';

/** 输出结构说明。 */
const SCHEMA = `{
  "points": [
    { "label": "要点名称（如 业务方向 / 发展阶段 / 规模）", "value": "要点内容，不超过 100 字" }
  ],
  "risks": [
    {
      "level": "高|中|低",
      "type": "风险类型",
      "conclusion": "不超过 40 字的结论",
      "evidence": "输入文本中原样复制的片段",
      "src": "JD|薪资|标签"
    }
  ],
  "note": "基于页面信息，非权威核实"
}`;

const SYSTEM = [
  '你是一位求职顾问，负责根据招聘页面信息与用户粘贴的外部文本，整理目标公司的综合情况，帮助求职者判断公司是否值得进一步了解。',
  '只能依据页面信息与用户提供的外部文本作答；页面未提供的公司规模、融资、财务等信息一律写「未提供」，不得凭先验知识补充。',
  'note 字段必须固定输出「基于页面信息，非权威核实」。',
  COMMON_RULES,
  jsonSchemaHint(SCHEMA),
].join('\n\n');

/** 公司分析 Prompt（F10）。 */
export const companyPrompt: PromptDef = {
  task: 'company',
  output: 'json',
  system: SYSTEM,
  buildUser(payload: LLMPayload): string {
    const { job, extraText } = payload as CompanyPayload;
    const jd = resolveJdText(job);
    const ext = (extraText ?? '').trim();
    return [
      '【岗位 / 公司页面信息】',
      formatJobHeader(job),
      '',
      '【页面 JD / 公司描述片段】',
      jd || '未提供',
      '',
      '【用户粘贴的外部文本】',
      ext || '未提供外部文本，本次仅基于页面信息分析',
      '',
      '请综合输出公司分析要点，并按要求输出 JSON。',
    ].join('\n');
  },
  parseResult(raw: string) {
    return parseJsonResult(raw, guardCompany, '公司分析结果结构不符合要求');
  },
  evidencePools(payload: LLMPayload) {
    const { job, extraText } = payload as CompanyPayload;
    return {
      JD: resolveJdText(job),
      '薪资': job?.salary ?? '',
      '标签': formatTags(job),
      '聊天': (extraText ?? '').trim(),
    };
  },
};
