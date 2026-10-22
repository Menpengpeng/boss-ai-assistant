/**
 * Prompt 层统一出口（Task 4）。
 * 背景层通过本文件获取各任务的 PromptDef、按 task 索引的 PROMPTS 与工具函数。
 */
import { AppError } from '../shared/errors';
import type { LLMTask } from '../shared/types';
import { chatReplyPrompt } from './chatReply';
import { chatRiskPrompt } from './chatRisk';
import { companyPrompt } from './company';
import { greetingPrompt } from './greeting';
import { interviewPrompt } from './interview';
import { jobAnalysisPrompt } from './jobAnalysis';
import { matchPrompt } from './match';
import { quickReviewPrompt } from './quickReview';
import type { PromptDef } from './types';

export { PROMPT_VERSION, JSON_RETRY_SUFFIX } from './version';
export type { PromptDef, PromptOutput } from './types';
export { COMMON_RULES, jsonSchemaHint } from './common';
export {
  jobAnalysisPrompt,
  matchPrompt,
  greetingPrompt,
  chatReplyPrompt,
  chatRiskPrompt,
  companyPrompt,
  interviewPrompt,
  quickReviewPrompt,
};

/** 按 task 索引的 Prompt 表（覆盖全部 8 类任务）。 */
export const PROMPTS: Record<LLMTask, PromptDef> = {
  jobAnalysis: jobAnalysisPrompt,
  match: matchPrompt,
  greeting: greetingPrompt,
  chatReply: chatReplyPrompt,
  chatRisk: chatRiskPrompt,
  company: companyPrompt,
  interview: interviewPrompt,
  quickReview: quickReviewPrompt,
};

/** 取指定任务的 PromptDef；未知 task 抛 AppError('UNKNOWN')。 */
export function getPrompt(task: LLMTask): PromptDef {
  const prompt = PROMPTS[task];
  if (!prompt) {
    throw new AppError('UNKNOWN', undefined, `未知任务：${String(task)}`);
  }
  return prompt;
}

/** 该任务的输出是否为 JSON。 */
export function isJsonTask(task: LLMTask): boolean {
  return getPrompt(task).output === 'json';
}
