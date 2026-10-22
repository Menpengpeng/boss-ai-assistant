/**
 * LLM 适配层出口（Task 3）。
 * - createClient：按 settings.provider 对应 ProviderPreset.kind 选择适配器；
 * - resolveEndpoint / originOf：URL 拼接与源提取（供适配器与权限层复用）；
 * - readSseDataLines：SSE（text/event-stream）按行读取 data: 载荷（两个适配器共用）。
 */
import { AppError } from '../../shared/errors';
import { PROVIDERS } from '../../shared/constants';
import type { ApiSettings } from '../../shared/types';
import { AnthropicClient } from './anthropic';
import { OpenAIClient } from './openai';
import type { LLMClient } from './types';

export type { LLMClient, LLMMessage, LLMRequestBody } from './types';
export { AnthropicClient } from './anthropic';
export { OpenAIClient } from './openai';

/** 按服务商预设创建客户端；未知 provider 时按 OpenAI 兼容协议处理。 */
export function createClient(settings: ApiSettings): LLMClient {
  const preset = PROVIDERS.find((p) => p.id === settings.provider);
  const kind = preset?.kind ?? 'openai';
  if (kind === 'anthropic') return new AnthropicClient(settings);
  return new OpenAIClient(settings, preset?.pdf ?? 'none');
}

/**
 * 拼接端点：去除 baseUrl 结尾的 `/`；baseUrl 已以目标 path 结尾时不重复拼接。
 * 例：resolveEndpoint('https://a.com/v1/', '/chat/completions') → 'https://a.com/v1/chat/completions'
 */
export function resolveEndpoint(baseUrl: string, path: string): string {
  const base = String(baseUrl ?? '').trim().replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  if (!base) return suffix;
  if (base.endsWith(suffix)) return base;
  return base + suffix;
}

/** 取 URL 的源（scheme + host + port）；非法时返回空串。 */
export function originOf(url: string): string {
  const raw = String(url ?? '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).origin;
  } catch {
    return '';
  }
}

/**
 * 逐行读取 SSE 响应体，yield 每个 `data:` 行的载荷（已去掉前缀与首尾空白）。
 * 被 abort 时抛 AppError('ABORTED')；同时通过 cancel 主动结束底层流，避免悬挂读取。
 */
export async function* readSseDataLines(
  res: Response,
  signal: AbortSignal,
): AsyncIterable<string> {
  const body = res.body;
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const onAbort = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort, { once: true });

  let buffer = '';
  try {
    for (;;) {
      if (signal.aborted) throw new AppError('ABORTED');
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, '').trim();
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
        if (!line || !line.startsWith('data:')) continue;
        yield line.slice(5).trim();
      }
    }
    if (signal.aborted) throw new AppError('ABORTED');
  } finally {
    signal.removeEventListener('abort', onAbort);
    try {
      reader.releaseLock();
    } catch {
      /* 读取器已释放时忽略 */
    }
  }
}
