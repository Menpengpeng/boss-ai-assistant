/**
 * Prompt 通用约束与拼装工具（Task 4.2）。
 * COMMON_RULES 是所有任务 system 的公共约束来源，保证各任务口径一致。
 */
import { LIMITS } from '../shared/constants';
import type { LLMPayload } from '../shared/protocol';
import type { JobInfo } from '../shared/types';
import { extractJson, truncate } from '../shared/validate';
import type { PromptPayloadExtras } from './types';

/** 缺失信息的统一占位文案。 */
const MISSING = '未提供';

/**
 * 八条通用约束（中文）。
 * 所有任务的 system 必须原样包含本常量，测试会校验关键词是否出现。
 */
export const COMMON_RULES = [
  '通用约束（必须严格遵守）：',
  '1. 只能依据用户提供的文本作答，不得使用你的先验知识补充公司或岗位的事实信息；',
  '2. 输入中缺失的信息一律写「未提供」，不得编造；',
  '3. 风险条目的 evidence 必须是从输入文本中原样复制的一段连续子串，不得改写、不得翻译、不得添加省略号；',
  '4. 涉及公司的结论必须标注「基于页面信息，非权威核实」；',
  '5. 回复类文案每条不超过 60 字，口语化；',
  '6. 不得编造简历中不存在的经历、学历、证书或项目；',
  '7. 敏感信号等级判定：索要身份证/银行卡/证件、要求转账或任何形式的收费、索要私人联系方式（微信/QQ/手机号）必须判为「高」；',
  '8. 只输出要求的格式：JSON 任务只输出一个 JSON 对象，不要 Markdown 围栏，不要任何解释文字。',
].join('\n');

/** 统一拼接「严格按此 JSON 结构输出：<schema>」。 */
export function jsonSchemaHint(schema: string): string {
  return `严格按此 JSON 结构输出：${schema}`;
}

/** 单行文本：去空白，为空时返回「未提供」。 */
export function textOrMissing(v: unknown): string {
  const s = String(v ?? '').trim();
  return s || MISSING;
}

/** 读取 payload 上的简历文本（本地扩展字段），没有则返回空串。 */
export function readResumeText(payload: LLMPayload): string {
  const ext = payload as LLMPayload & PromptPayloadExtras;
  const raw = ext.resumeText ?? ext.maskedResume ?? '';
  return typeof raw === 'string' ? raw.trim() : '';
}

/** 取最终 JD 文本：手动粘贴优先，超长按 LIMITS.maxJdChars 截断；无内容返回空串。 */
export function resolveJdText(job: JobInfo, manualJd?: string): string {
  const manual = (manualJd ?? '').trim();
  if (manual) return truncate(manual, LIMITS.maxJdChars);
  const lines = Array.isArray(job?.jd)
    ? job.jd.map((s) => String(s ?? '').trim()).filter(Boolean)
    : [];
  return truncate(lines.join('\n'), LIMITS.maxJdChars);
}

/** 岗位标签拼接为一行。 */
export function formatTags(job: JobInfo): string {
  return Array.isArray(job?.tags)
    ? job.tags.map((s) => String(s ?? '').trim()).filter(Boolean).join('、')
    : '';
}

/** 岗位基础信息块：标题/公司/薪资/城市/经验学历/标签。 */
export function formatJobHeader(job: JobInfo): string {
  return [
    `岗位标题：${textOrMissing(job?.title)}`,
    `公司名称：${textOrMissing(job?.company)}`,
    `薪资：${textOrMissing(job?.salary)}`,
    `城市：${textOrMissing(job?.city)}`,
    `经验要求：${textOrMissing(job?.experience)}`,
    `学历要求：${textOrMissing(job?.education)}`,
    `岗位标签：${textOrMissing(formatTags(job))}`,
  ].join('\n');
}

/** 解析 JSON 输出并交给守卫归一化；解析失败或结构不合法时返回 { ok:false }。 */
export function parseJsonResult(
  raw: string,
  guard: (v: unknown) => unknown | null,
  reason: string,
): { ok: true; value: unknown } | { ok: false; reason: string } {
  const data = extractJson<unknown>(raw);
  if (data === null) return { ok: false, reason: '无法从模型输出中解析出合法 JSON' };
  const value = guard(data);
  if (value === null) return { ok: false, reason };
  return { ok: true, value };
}
