/**
 * OpenAI 适配器单测：SSE 流式增量、URL 拼接、鉴权头、错误码映射、abort。
 * 全程不访问真实网络（fetch 被 stub）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiSettings } from '../../shared/types';
import { OpenAIClient } from '../llm/openai';

/** 构造一份合法配置。 */
function settings(over: Partial<ApiSettings> = {}): ApiSettings {
  return {
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    key: 'sk-test-1234567890',
    model: 'gpt-4o-mini',
    temperature: 0.3,
    maxTokens: 64,
    timeoutSec: 30,
    stream: true,
    maskPhone: true,
    verified: false,
    verifiedAt: 0,
    ...over,
  };
}

/** 用给定片段构造 SSE 响应体。 */
function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

/** 假流式响应。 */
function streamRes(body: ReadableStream<Uint8Array>, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    body,
    text: async () => '',
  } as unknown as Response;
}

/** 假 JSON 响应。 */
function jsonRes(value: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: null,
    text: async () => JSON.stringify(value),
  } as unknown as Response;
}

/** 默认请求体。 */
function req(over: Record<string, unknown> = {}): {
  messages: Array<{ role: 'user'; content: string }>;
  temperature: number;
  maxTokens: number;
  stream: boolean;
} {
  return {
    messages: [{ role: 'user', content: 'hi' }],
    temperature: 0.3,
    maxTokens: 64,
    stream: true,
    ...over,
  };
}

/** 收集全部增量。 */
async function collect(it: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const chunk of it) out.push(chunk);
  return out;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('OpenAIClient', () => {
  it('流式 yield 三段增量且拼接正确，URL 与鉴权头符合约定', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      streamRes(
        sseBody([
          'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"呀"}}]}\n\ndata: [DONE]\n\n',
        ]),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new OpenAIClient(settings({ baseUrl: 'https://api.openai.com/v1/' }), 'native');
    const parts = await collect(client.chat(req(), new AbortController().signal));

    expect(parts).toEqual(['你', '好', '呀']);
    expect(parts.join('')).toBe('你好呀');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test-1234567890');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('URL 拼接：尾斜杠去重、已含 /chat/completions 时不重复拼接', async () => {
    const cases: Array<[string, string]> = [
      ['https://api.openai.com/v1/', 'https://api.openai.com/v1/chat/completions'],
      ['https://api.deepseek.com/v1', 'https://api.deepseek.com/v1/chat/completions'],
      ['https://relay.example.com/v1/chat/completions', 'https://relay.example.com/v1/chat/completions'],
    ];
    for (const [baseUrl, want] of cases) {
      const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
        jsonRes({ choices: [{ message: { content: 'ok' } }] }),
      );
      vi.stubGlobal('fetch', fetchMock);
      const client = new OpenAIClient(settings({ baseUrl }), 'none');
      const parts = await collect(client.chat(req({ stream: false }), new AbortController().signal));
      expect(parts.join('')).toBe('ok');
      expect(fetchMock.mock.calls[0][0]).toBe(want);
    }
  });

  it('非 2xx 状态码映射为对应错误码', async () => {
    const cases: Array<[number, string]> = [
      [401, 'INVALID_KEY'],
      [429, 'RATE_LIMIT'],
      [500, 'NETWORK'],
    ];
    for (const [status, code] of cases) {
      vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ error: 'bad' }, status)));
      const client = new OpenAIClient(settings(), 'none');
      await expect(collect(client.chat(req(), new AbortController().signal))).rejects.toMatchObject({
        code,
      });
    }
  });

  it('signal.abort() 后 chat() 抛 ABORTED', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => streamRes(sseBody(['data: {"choices":[{"delta":{"content":"a"}}]}\n\n']))),
    );
    const client = new OpenAIClient(settings(), 'none');
    const controller = new AbortController();
    controller.abort();
    await expect(collect(client.chat(req(), controller.signal))).rejects.toMatchObject({
      code: 'ABORTED',
    });
  });
});
