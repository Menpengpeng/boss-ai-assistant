/**
 * Prompt 层类型契约（Task 4）。
 * 本文件只包含类型声明，编译后被完全擦除，不含任何运行时代码。
 */
import type { LLMPayload } from '../shared/protocol';
import type { EvidenceSrc, LLMTask, RiskItem } from '../shared/types';

/** Prompt 输出形态：json 结构化 / text 纯文本。 */
export type PromptOutput = 'json' | 'text';

/** 风险条目集合类型别名（red / risks 字段复用）。 */
export type PromptRiskList = RiskItem[];

/** 单个任务的 Prompt 定义。 */
export interface PromptDef {
  task: LLMTask;
  output: PromptOutput;
  /** 系统提示词（含角色、通用约束） */
  system: string;
  /** 拼装用户提示词 */
  buildUser(payload: LLMPayload): string;
  /** 解析模型原始输出；json 任务内部用 extractJson；失败返回 { ok:false, reason } */
  parseResult(raw: string): { ok: true; value: unknown } | { ok: false; reason: string };
  /** 若提供：对结果里的 red/risks 做证据子串校验，返回各来源的原文文本池 */
  evidencePools?(payload: LLMPayload): Partial<Record<EvidenceSrc, string>>;
  /** 文本类任务的最大字数（用于超长截断/校验，例如打招呼语 60） */
  maxChars?: number;
}

/**
 * payload 的本地扩展字段：简历文本由 background 在调用前注入（不属于 protocol.ts 的正式协议）。
 * 读取时统一写成 (payload as LLMPayload & PromptPayloadExtras)。
 */
export interface PromptPayloadExtras {
  /** 简历文本（已按需脱敏）。 */
  resumeText?: string;
  /** 脱敏后的简历文本（备用字段名）。 */
  maskedResume?: string;
}
