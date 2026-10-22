/**
 * 聊天回复建议 Prompt（F6 + F8）。
 * 输出对话意图/阶段/待回复事项、三种风格候选回复，以及敏感信号 risks。
 */
import { LIMITS } from '../shared/constants';
import type { ChatPayload } from '../shared/protocol';
import type { LLMPayload } from '../shared/protocol';
import type { ChatContext } from '../shared/types';
import { COMMON_RULES, jsonSchemaHint, parseJsonResult, textOrMissing } from './common';
import { guardChatInsight } from './guards';
import type { PromptDef } from './types';

/** 输出结构说明。 */
const SCHEMA = `{
  "intent": "对方意图（不超过 20 字）",
  "stage": "当前阶段（如 初次接触 / 初步沟通 / 面试安排 / 谈薪）",
  "pending": "待回复或待确认的事项；无则写「未提供」",
  "replies": [
    { "style": "简洁专业", "text": "不超过 60 字，可直接发送" },
    { "style": "热情积极", "text": "不超过 60 字，可直接发送" },
    { "style": "委婉谨慎", "text": "不超过 60 字，可直接发送" }
  ],
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
  '你是一位求职沟通助手，负责阅读候选人与 HR 的聊天记录，判断对方意图与当前阶段，并给出可直接发送的回复建议。',
  'replies 必须固定输出三种风格，顺序为：简洁专业、热情积极、委婉谨慎；每条不超过 60 字，口语化，可直接复制发送。',
  'risks 用于标记敏感信号（转移微信/QQ、索要身份证或银行卡、收费培训、押金/内推费、反复追问薪资并压价等）；索要私人联系方式或涉及转账收费的必须判为「高」，evidence 必须原样引用 HR 的原话。若未发现敏感信号，risks 输出空数组。',
  COMMON_RULES,
  jsonSchemaHint(SCHEMA),
].join('\n\n');

/** 取最近 20 条消息并格式化为文本。 */
function formatMessages(context: ChatContext): string {
  const msgs = Array.isArray(context?.messages) ? context.messages : [];
  return msgs
    .slice(-LIMITS.chatTake)
    .map((m) => {
      const who = m?.role === 'hr' ? (context?.hrName ?? '').trim() || 'HR' : '我';
      return `${who}：${String(m?.text ?? '').trim()}`;
    })
    .join('\n');
}

/** 聊天记录文本池（证据校验用）。 */
function chatText(context: ChatContext): string {
  const msgs = Array.isArray(context?.messages) ? context.messages : [];
  return msgs.map((m) => String(m?.text ?? '').trim()).join('\n');
}

/** 聊天回复建议 Prompt（F6 + F8）。 */
export const chatReplyPrompt: PromptDef = {
  task: 'chatReply',
  output: 'json',
  system: SYSTEM,
  buildUser(payload: LLMPayload): string {
    const { context } = payload as ChatPayload;
    return [
      '【会话所属岗位】',
      `岗位标题：${textOrMissing(context?.jobTitle)}`,
      `公司名称：${textOrMissing(context?.company)}`,
      `HR 称呼：${textOrMissing(context?.hrName)}`,
      '',
      `【最近 ${LIMITS.chatTake} 条聊天记录】`,
      formatMessages(context) || '未提供',
      '',
      '请分析对话、给出三种风格回复并标记敏感信号，输出 JSON。',
    ].join('\n');
  },
  parseResult(raw: string) {
    return parseJsonResult(raw, guardChatInsight, '对话洞察结果结构不符合要求');
  },
  evidencePools(payload: LLMPayload) {
    const { context } = payload as ChatPayload;
    return { '聊天': chatText(context) };
  },
};
