/**
 * Prompt 层版本与重试后缀（Task 4）。
 * PROMPT_VERSION 会写入产出物与历史记录，便于回溯 Prompt 口径。
 */
export const PROMPT_VERSION = '1.0.0';

/** JSON 任务重试时追加到用户提示词末尾的约束文案。 */
export const JSON_RETRY_SUFFIX =
  '\n\n注意：上一次输出不是合法 JSON。请只输出 JSON，不要任何解释文字、不要 Markdown 代码围栏。';
