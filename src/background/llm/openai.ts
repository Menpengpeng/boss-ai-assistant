/**
 * OpenAI 兼容适配器（openai / deepseek / qwen / kimi / zhipu / custom）。
 * - 端点：POST {baseUrl}/chat/completions
 * - 鉴权：Authorization: Bearer <key>（Key 只进请求头，绝不写日志/错误信息）
 * - PDF：preset.pdf === 'native' 时以 file 附件形式插入最后一条 user 消息
 */
import { AppError, normalizeHttpStatus, toAppError } from '../../shared/errors';
import type { ApiSettings, PdfAttachment } from '../../shared/types';
import { readSseDataLines, resolveEndpoint } from './index';
import type { LLMClient, LLMMessage, LLMRequestBody } from './types';

/** 安全读取响应文本（失败时返回空串，避免掩盖原始错误）。 */
async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

/** 取最后一条 user 消息的下标；不存在返回 -1。 */
function lastUserIndex(messages: LLMMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') return i;
  }
  return -1;
}

/** 解析单条 SSE 载荷中的增量文本。 */
function parseDelta(payload: string): string {
  try {
    const json = JSON.parse(payload) as {
      choices?: Array<{ delta?: { content?: unknown } }>;
    };
    const content = json?.choices?.[0]?.delta?.content;
    return typeof content === 'string' ? content : '';
  } catch {
    return '';
  }
}

/** 解析非流式响应中的完整文本。 */
function parseFull(payload: string): string {
  try {
    const json = JSON.parse(payload) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = json?.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : '';
  } catch {
    return '';
  }
}

export class OpenAIClient implements LLMClient {
  readonly kind = 'openai' as const;

  private readonly settings: ApiSettings;

  private readonly pdf: 'native' | 'none';

  constructor(settings: ApiSettings, pdf: 'native' | 'none' = 'none') {
    this.settings = settings;
    this.pdf = pdf;
  }

  capabilities(): { pdf: 'native' | 'none'; stream: boolean } {
    return { pdf: this.pdf, stream: true };
  }

  private endpoint(): string {
    return resolveEndpoint(this.settings.baseUrl, '/chat/completions');
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.settings.key}`,
    };
  }

  /** 组装 messages；带附件且支持 PDF 时改写最后一条 user 消息为内容数组。 */
  private buildMessages(messages: LLMMessage[], attachment?: PdfAttachment): unknown[] {
    const list: Array<{ role: string; content: unknown }> = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    if (!attachment) return list;
    const idx = lastUserIndex(messages);
    if (idx < 0) return list;
    list[idx].content = [
      { type: 'text', text: messages[idx].content },
      {
        type: 'file',
        file: {
          filename: attachment.filename,
          file_data: `data:application/pdf;base64,${attachment.base64}`,
        },
      },
    ];
    return list;
  }

  private buildBody(req: LLMRequestBody): Record<string, unknown> {
    return {
      model: this.settings.model,
      messages: this.buildMessages(req.messages, req.attachment),
      temperature: req.temperature,
      max_tokens: req.maxTokens,
      stream: req.stream,
    };
  }

  /** 发起请求并统一归一化网络/HTTP 错误。 */
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
      // 必须保留 HTTP 状态码：部分服务商/中转在 4xx 时返回空响应体，
      // 只把响应体当 detail 会导致用户只看到「出现未知错误」，无法定位。
      throw new AppError(normalizeHttpStatus(res.status), undefined, `HTTP ${res.status}：${body}`);
    }
    return res;
  }

  async *chat(req: LLMRequestBody, signal: AbortSignal): AsyncIterable<string> {
    if (req.attachment && this.pdf === 'none') {
      throw new AppError('UNSUPPORTED_ATTACHMENT');
    }
    if (signal.aborted) throw new AppError('ABORTED');
    const res = await this.send(req, signal);

    if (!req.stream) {
      const text = parseFull(await safeText(res));
      if (text) yield text;
      return;
    }

    for await (const payload of readSseDataLines(res, signal)) {
      if (payload === '[DONE]') return;
      const text = parseDelta(payload);
      if (text) yield text;
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
