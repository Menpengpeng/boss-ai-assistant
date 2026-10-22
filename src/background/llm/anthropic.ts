/**
 * Anthropic（Claude）适配器。
 * - 端点：POST {baseUrl}/messages
 * - 鉴权：x-api-key + anthropic-version；浏览器直连需带 anthropic-dangerous-direct-browser-access
 * - system 抽到顶层 system 字段；其余消息映射为 content 数组
 * - PDF：content 数组追加 document（base64）块
 */
import { AppError, normalizeHttpStatus, toAppError } from '../../shared/errors';
import type { ApiSettings, PdfAttachment } from '../../shared/types';
import { readSseDataLines, resolveEndpoint } from './index';
import type { LLMClient, LLMMessage, LLMRequestBody } from './types';

/** Anthropic API 版本。 */
const ANTHROPIC_VERSION = '2023-06-01';

/** 安全读取响应文本。 */
async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

/** 解析非流式响应中的完整文本。 */
function parseFull(payload: string): string {
  try {
    const json = JSON.parse(payload) as { content?: Array<{ text?: unknown }> };
    return (json?.content ?? [])
      .map((block) => (typeof block?.text === 'string' ? block.text : ''))
      .join('');
  } catch {
    return '';
  }
}

/** 由 Anthropic 错误类型推断 HTTP 状态码，复用 normalizeHttpStatus 归一化。 */
function statusOfErrorType(type: unknown): number {
  switch (type) {
    case 'authentication_error':
      return 401;
    case 'permission_error':
      return 403;
    case 'rate_limit_error':
      return 429;
    case 'overloaded_error':
      return 529;
    default:
      return 500;
  }
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: unknown[];
}

export class AnthropicClient implements LLMClient {
  readonly kind = 'anthropic' as const;

  private readonly settings: ApiSettings;

  constructor(settings: ApiSettings) {
    this.settings = settings;
  }

  capabilities(): { pdf: 'native' | 'none'; stream: boolean } {
    return { pdf: 'native', stream: true };
  }

  private endpoint(): string {
    return resolveEndpoint(this.settings.baseUrl, '/messages');
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-api-key': this.settings.key,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    };
  }

  /** 组装 system 与 messages；带附件时给最后一条 user 消息追加 document 块。 */
  private buildBody(req: LLMRequestBody): Record<string, unknown> {
    const system = req.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');

    const messages: AnthropicMessage[] = req.messages
      .filter((m) => m.role !== 'system')
      .map((m: LLMMessage) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: [{ type: 'text', text: m.content }],
      }));

    if (req.attachment) {
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i].role === 'user') {
          const att: PdfAttachment = req.attachment;
          messages[i].content.push({
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: att.base64,
            },
          });
          break;
        }
      }
    }

    const body: Record<string, unknown> = {
      model: this.settings.model,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      stream: req.stream,
      messages,
    };
    if (system) body.system = system;
    return body;
  }

  private async send(req: LLMRequestBody, signal: AbortSignal): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(this.endpoint(), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(this.buildBody(req)),
        signal,
      });
    } catch (e) {
      throw toAppError(e);
    }
    if (!res.ok) {
      const body = await safeText(res);
      // 同 openai 适配器：保留 HTTP 状态码，避免空响应体导致错误无法定位
      throw new AppError(normalizeHttpStatus(res.status), undefined, `HTTP ${res.status}：${body}`);
    }
    return res;
  }

  async *chat(req: LLMRequestBody, signal: AbortSignal): AsyncIterable<string> {
    if (signal.aborted) throw new AppError('ABORTED');
    const res = await this.send(req, signal);

    if (!req.stream) {
      const text = parseFull(await safeText(res));
      if (text) yield text;
      return;
    }

    for await (const payload of readSseDataLines(res, signal)) {
      let json: {
        type?: unknown;
        delta?: { text?: unknown };
        error?: { type?: unknown; message?: unknown };
      };
      try {
        json = JSON.parse(payload) as typeof json;
      } catch {
        continue;
      }
      if (json.type === 'content_block_delta') {
        const text = json.delta?.text;
        if (typeof text === 'string' && text) yield text;
      } else if (json.type === 'message_stop') {
        return;
      } else if (json.type === 'error') {
        throw new AppError(
          normalizeHttpStatus(statusOfErrorType(json.error?.type)),
          undefined,
          typeof json.error?.message === 'string' ? json.error.message : '',
        );
      }
    }
  }

  async test(signal: AbortSignal): Promise<number> {
    const started = Date.now();
    const res = await this.send(
      {
        messages: [{ role: 'user', content: 'ping' }],
        temperature: 0,
        maxTokens: 1,
        stream: false,
      },
      signal,
    );
    await safeText(res);
    return Date.now() - started;
  }
}
