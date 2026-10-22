/**
 * Anthropic 适配器单测：端点/鉴权头、SSE content_block_delta、PDF document 块、capabilities。
 * 全程不访问真实网络（fetch 被 stub）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiSettings, PdfAttachment } from '../../shared/types';
import { AnthropicClient } from '../llm/anthropic';

/** 构造一份合法配置。 */
function settings(over: Partial<ApiSettings> = {}): ApiSettings {
  return {
    provider: 'claude',
    baseUrl: 'https://api.anthropic.com/v1',
    key: 'sk-ant-test-1234567890',
    model: 'claude-sonnet-4-5',
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

/** 默认请求体（带 system）。 */
function req(over: Record<string, unknown> = {}): {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature: number;
  maxTokens: number;
  stream: boolean;
} {
  return {
    messages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ],
    temperature: 0.3,
    maxTokens: 64,
    stream: true,
    ...over,
  };
}

const PDF: PdfAttachment = {
  kind: 'pdf',
  mime: 'application/pdf',
  base64: 'JVBERi0xLjQK',
  size: 100,
  sha256: 'abcd',
  filename: 'resume.pdf',
};

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

describe('AnthropicClient', () => {
  it('端点与鉴权头符合约定，SSE content_block_delta 正确取 delta.text', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      streamRes(
        sseBody([
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"你"}}\n\n',
          'data: {"type":"content_block_delta","delta":{"text":"好"}}\n\n',
          'data: {"type":"message_stop"}\n\n',
        ]),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new AnthropicClient(settings());
    const parts = await collect(client.chat(req(), new AbortController().signal));
    expect(parts).toEqual(['你', '好']);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-test-1234567890');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');

    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.system).toBe('sys');
    const messages = body.messages as Array<{ role: string; content: Array<{ type: string; text?: string }> }>;
    expect(messages).toHaveLength(1);
    expect(messages[0].content[0]).toEqual({ type: 'text', text: 'hi' });
  });

  it('带 PDF 附件时请求体包含 document 块与 base64 数据', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonRes({ content: [{ type: 'text', text: 'ok' }] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new AnthropicClient(settings());
    const parts = await collect(
      client.chat(
        { ...req({ stream: false }), attachment: PDF },
        new AbortController().signal,
      ),
    );
    expect(parts.join('')).toBe('ok');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      messages: Array<{ role: string; content: Array<Record<string, unknown>> }>;
    };
    const userBlocks = body.messages[0].content;
    const doc = userBlocks.find((b) => b.type === 'document') as {
      source: { type: string; media_type: string; data: string };
    };
    expect(doc).toBeTruthy();
    expect(doc.source.type).toBe('base64');
    expect(doc.source.media_type).toBe('application/pdf');
    expect(doc.source.data).toBe('JVBERi0xLjQK');
  });

  it('capabilities().pdf 为 native', () => {
    expect(new AnthropicClient(settings()).capabilities().pdf).toBe('native');
  });
});
