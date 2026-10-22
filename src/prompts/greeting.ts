/**
 * 打招呼语 Prompt（F5）。
 * 输出纯文本：不超过 60 字的口语化开场白。
 */
import { LIMITS } from '../shared/constants';
import type { GreetingPayload } from '../shared/protocol';
import type { LLMPayload } from '../shared/protocol';

import { truncate } from '../shared/validate';
import { COMMON_RULES, formatJobHeader, readResumeText, resolveJdText } from './common';
import type { PromptDef } from './types';

const SYSTEM = [
  '你是一位求职沟通助手，负责为候选人撰写发给 HR 的首次打招呼语。',
  '要求：不超过 60 字；口语化、自然，像真人开口；提及与 JD 最相关的一个匹配点；不夸大、不编造；不使用 emoji；不使用「我是某某，毕业于某某」这类模板套话。',
  '只输出这一句打招呼语本身，不要任何前缀、引号、解释或 Markdown 代码围栏。',
  COMMON_RULES,
].join('\n\n');

/** 解析纯文本打招呼语：去掉代码围栏、前缀与包裹引号，只取首个非空行。 */
function parseGreeting(raw: string): { ok: true; value: string } | { ok: false; reason: string } {
  let text = String(raw ?? '').trim();
  text = text.replace(/```[a-zA-Z]*\s*([\s\S]*?)```/g, '$1').trim();
  text = text.replace(/^(打招呼语|开场白|话术|greeting|greet)\s*[:：\-–]?\s*/i, '').trim();
  text = text.replace(/^["'“”‘’「『]+/, '').replace(/["'“”‘’」』]+$/, '').trim();
  const firstLine = (text.split('\n').find((l) => l.trim()) ?? '').trim();
  const value = truncate(firstLine, LIMITS.maxReplyChars);
  if (!value) return { ok: false, reason: '打招呼语为空或无法识别' };
  return { ok: true, value };
}

/** 打招呼语 Prompt（F5）。 */
export const greetingPrompt: PromptDef = {
  task: 'greeting',
  output: 'text',
  maxChars: LIMITS.maxReplyChars,
  system: SYSTEM,
  buildUser(payload: LLMPayload): string {
    const { job, manualJd } = payload as GreetingPayload;
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
      `请生成一句不超过 ${LIMITS.maxReplyChars} 字的打招呼语。`,
    ].join('\n');
  },
  parseResult(raw: string) {
    return parseGreeting(raw);
  },
};
