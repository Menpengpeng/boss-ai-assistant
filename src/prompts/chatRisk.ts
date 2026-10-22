/**
 * 敏感信号单独复查 Prompt（F8）。
 * 只做风险识别：输出 { risks: RiskItem[] }，用于「单独复查敏感信号」入口。
 */
import type { ChatPayload } from '../shared/protocol';
import type { LLMPayload } from '../shared/protocol';

import { extractJson, isPlainObject } from '../shared/validate';
import { COMMON_RULES, jsonSchemaHint, textOrMissing } from './common';
import { normalizeRiskList } from './guards';
import type { PromptDef } from './types';

/** 输出结构说明。 */
const SCHEMA = `{
  "risks": [
    {
      "level": "高|中|低",
      "type": "敏感信号类型（如 转移微信 / 索要身份证 / 收费培训 / 押金内推费 / 反复追问薪资）",
      "conclusion": "不超过 40 字的结论",
      "evidence": "HR 原话片段，原样复制",
      "src": "聊天"
    }
  ]
}`;

const SYSTEM = [
  '你是一位风控助手，只负责从候选人与 HR 的聊天记录中识别敏感信号，不提供回复建议。',
  '重点识别：转移平台（微信/QQ）、索要身份证或银行卡、收费培训、押金/保证金、内推费、反复追问薪资并压价、诱导线下见面等。',
  '索要私人联系方式或涉及转账、任何形式收费的必须判为「高」；evidence 必须原样引用 HR 的原话片段。未发现信号时 risks 输出空数组。',
  COMMON_RULES,
  jsonSchemaHint(SCHEMA),
].join('\n\n');

/** 聊天记录文本池（证据校验用）。 */
function chatText(context: ChatPayload['context']): string {
  const msgs = Array.isArray(context?.messages) ? context.messages : [];
  return msgs.map((m) => String(m?.text ?? '').trim()).join('\n');
}

/** 敏感信号复查 Prompt（F8）。 */
export const chatRiskPrompt: PromptDef = {
  task: 'chatRisk',
  output: 'json',
  system: SYSTEM,
  buildUser(payload: LLMPayload): string {
    const { context } = payload as ChatPayload;
    return [
      '【会话所属岗位】',
      `岗位标题：${textOrMissing(context?.jobTitle)}`,
      `公司名称：${textOrMissing(context?.company)}`,
      '',
      '【聊天记录】',
      chatText(context) || '未提供',
      '',
      '请识别敏感信号并输出 JSON。',
    ].join('\n');
  },
  parseResult(raw: string) {
    const data = extractJson<Record<string, unknown>>(raw);
    if (!isPlainObject(data) || !Array.isArray(data.risks)) {
      return { ok: false, reason: '结果缺少 risks 数组' };
    }
    return { ok: true, value: { risks: normalizeRiskList(data.risks, '聊天') } };
  },
  evidencePools(payload: LLMPayload) {
    const { context } = payload as ChatPayload;
    return { '聊天': chatText(context) };
  },
};
