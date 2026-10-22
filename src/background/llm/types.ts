/**
 * LLM 适配层类型契约（Task 3）。
 * 说明：本文件集中声明适配层对外契约；工厂函数 createClient 与 URL 工具见 ./index.ts。
 */
import type { ApiSettings, PdfAttachment } from '../../shared/types';

/** 单条对话消息。 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 一次请求所需的参数（不含 Key 与 baseUrl，二者由适配器持有的配置提供）。 */
export interface LLMRequestBody {
  messages: LLMMessage[];
  temperature: number;
  maxTokens: number;
  stream: boolean;
  attachment?: PdfAttachment;
}

/** 统一的模型客户端接口。 */
export interface LLMClient {
  readonly kind: 'openai' | 'anthropic';
  /** 流式对话：逐段 yield 文本增量；被 abort 时抛 AppError('ABORTED') */
  chat(req: LLMRequestBody, signal: AbortSignal): AsyncIterable<string>;
  /** 最小连通性测试：返回耗时毫秒 */
  test(signal: AbortSignal): Promise<number>;
  capabilities(): { pdf: 'native' | 'none'; stream: boolean };
}

/** 工厂函数签名（实现位于 ./index.ts，按其 ProviderPreset.kind 选择适配器）。 */
export type CreateClient = (settings: ApiSettings) => LLMClient;
