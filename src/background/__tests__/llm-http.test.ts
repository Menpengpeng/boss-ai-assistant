/**
 * 集成测试（Task 12.2）：适配层对「本地 mock 服务端」的真实网络路径。
 *
 * 与 openai.test.ts / anthropic.test.ts（stub globalThis.fetch）不同，本文件用 node:http 起一个
 * 真实的本地 HTTP 服务，走完 fetch → 连接 → SSE 分块读取 → 错误码归一化的完整链路，
 * 覆盖：流式增量拼接、Anthropic 专属请求头与 PDF document 块、401/429/500 归一化、
 * 超时 → TIMEOUT、abort → ABORTED（不悬挂）、runner 的 JSON 重试（真实 HTTP）。
 */
import { webcrypto } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiSettings, JobInfo, PdfAttachment } from '../../shared/types';
import type { LLMPayload } from '../../shared/protocol';
import { AnthropicClient } from '../llm/anthropic';
import { OpenAIClient } from '../llm/openai';

// vitest 的 node 环境不暴露 globalThis.crypto，注入 Node WebCrypto 供缓存 Key 使用
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

/** 供各用例替换的替身（vi.hoisted 保证在模块工厂执行前已初始化）。 */
const hoisted = vi.hoisted(() => ({
  addAnalysis: vi.fn(async () => undefined),
}));

// runner 走真实 HTTP，但简历读取与历史落库仍用替身（避免触碰 IndexedDB）
vi.mock('../resume', () => ({
  loadResumeContext: async () => null,
  blobToBase64: async () => 'QUJD',
}));
vi.mock('../../shared/idb', () => ({
  addAnalysis: hoisted.addAnalysis,
}));

/** 内存版 chrome.storage.local + 权限开关。 */
const memory: Record<string, unknown> = {};
(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: {
    local: {
      get: async (key: string | null) => (key === null ? { ...memory } : { [key]: memory[key] }),
      set: async (items: Record<string, unknown>) => {
        Object.assign(memory, items);
      },
      remove: async (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete memory[k];
      },
    },
  },
  permissions: { contains: async () => true },
};

/** 服务端记录：最近一次请求的 URL / 头 / 解析后的请求体。 */
interface Captured {
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown>;
  count: number;
}

/** 合法的岗位分析 JSON（满足 jobAnalysis 的 schema 校验，用于「重试后成功」场景）。 */
const VALID_ANALYSIS_JSON = JSON.stringify({
  summary: '重试成功',
  duties: ['负责业务前端开发'],
  skills: ['Vue'],
  nice: [],
  red: [],
  strengths: [],
  gaps: [],
  advice: [],
});

const captured: Captured = { url: '', headers: {}, body: {}, count: 0 };

/** 读取请求体并按 JSON 解析（解析失败返回空对象）。 */
function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8');
    });
    req.on('end', () => {
      try {
        const parsed: unknown = JSON.parse(raw);
        resolve(parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {});
      } catch {
        resolve({});
      }
    });
  });
}

/** 延时。 */
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 逐块写出 SSE（块之间留出间隔，验证真实增量读取路径）。 */
async function writeSse(res: ServerResponse, chunks: string[]): Promise<void> {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  for (const chunk of chunks) {
    res.write(chunk);
    await delay(5);
  }
  res.end();
}

/** 返回 JSON 响应。 */
function writeJson(res: ServerResponse, value: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(value));
}

/** OpenAI 兼容 SSE 载荷封装。 */
function oaDelta(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
}

/** Anthropic SSE 载荷封装。 */
function claudeDelta(text: string): string {
  return `data: ${JSON.stringify({ type: 'content_block_delta', delta: { text } })}\n\n`;
}

/** 请求路由：按路径前缀返回不同行为。 */
async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? '';
  const body = await readBody(req);
  captured.url = url;
  captured.headers = req.headers;
  captured.body = body;
  captured.count += 1;

  // 1) OpenAI 兼容流式：三段增量 + [DONE]
  if (url.startsWith('/openai/')) {
    await writeSse(res, [oaDelta('你'), oaDelta('好'), oaDelta('呀'), 'data: [DONE]\n\n']);
    return;
  }
  // 2) OpenAI 兼容非流式（完整 JSON）
  if (url.startsWith('/oa-full/')) {
    writeJson(res, { choices: [{ message: { content: '完整文本' } }] });
    return;
  }
  // 3) Anthropic 流式：content_block_delta + message_stop
  if (url.startsWith('/claude/')) {
    await writeSse(res, [claudeDelta('你'), claudeDelta('好'), 'data: {"type":"message_stop"}\n\n']);
    return;
  }
  // 4) 状态码归一化：/status/<code>/...
  const statusMatch = /^\/status\/(\d+)\//.exec(url);
  if (statusMatch) {
    writeJson(res, { error: 'mock' }, Number(statusMatch[1]));
    return;
  }
  // 4.1) 空响应体的 400：模拟部分服务商/中转的行为，此时 detail 只能靠状态码定位
  if (url.startsWith('/empty400/')) {
    res.writeHead(400);
    res.end();
    return;
  }
  // 5) 慢响应（用于超时 → TIMEOUT）
  if (url.startsWith('/slow/')) {
    await delay(1500);
    writeJson(res, { choices: [{ message: { content: 'ok' } }] });
    return;
  }
  // 6) 永不响应（用于 abort → ABORTED，不能永久悬挂）
  if (url.startsWith('/hang/')) {
    req.on('close', () => {
      /* 客户端断开后无需处理 */
    });
    return;
  }
  // 7) runner 重试用：第一次非法 JSON、第二次合法
  if (url.startsWith('/retrybad/')) {
    if (body.stream === true) {
      await writeSse(res, [oaDelta('完全不是 JSON'), 'data: [DONE]\n\n']);
    } else {
      writeJson(res, { choices: [{ message: { content: VALID_ANALYSIS_JSON } }] });
    }
    return;
  }
  // 8) runner 重试用：两次都非法
  if (url.startsWith('/alwaysbad/')) {
    if (body.stream === true) {
      await writeSse(res, [oaDelta('不是 JSON'), 'data: [DONE]\n\n']);
    } else {
      writeJson(res, { choices: [{ message: { content: '仍然不是 JSON' } }] });
    }
    return;
  }
  writeJson(res, { error: 'not found' }, 404);
}

let server: Server;
let base = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    route(req, res).catch(() => {
      try {
        res.end();
      } catch {
        /* 连接已关闭 */
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  for (const k of Object.keys(memory)) delete memory[k];
  captured.count = 0;
  hoisted.addAnalysis.mockClear();
});

/** 配置（baseUrl 指向本地 mock 服务端）。 */
function api(path: string, over: Partial<ApiSettings> = {}): ApiSettings {
  return {
    provider: 'openai',
    baseUrl: `${base}${path}`,
    key: 'sk-test-1234567890',
    model: 'm1',
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

/** 给 Promise 加超时，避免「请求悬挂」把用例卡死（挂起即视为缺陷）。 */
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    delay(ms).then(() => {
      throw new Error(`请求在 ${ms}ms 内未结束（疑似悬挂）`);
    }),
  ]);
}

const PDF: PdfAttachment = {
  kind: 'pdf',
  mime: 'application/pdf',
  base64: 'JVBERi0xLjQK',
  size: 100,
  sha256: 'abcd',
  filename: 'resume.pdf',
};

describe('OpenAI 适配器 · 本地 mock SSE 服务端', () => {
  it('流式：逐块增量拼接为完整文本（真实 HTTP + SSE）', async () => {
    const client = new OpenAIClient(api('/openai/v1'), 'native');
    const parts = await collect(client.chat(req(), new AbortController().signal));
    expect(parts).toEqual(['你', '好', '呀']);
    expect(parts.join('')).toBe('你好呀');
    expect(captured.url).toBe('/openai/v1/chat/completions');
    expect(captured.body.stream).toBe(true);
  });

  it('非流式：一次返回完整文本', async () => {
    const client = new OpenAIClient(api('/oa-full/v1'), 'none');
    const parts = await collect(client.chat(req({ stream: false }), new AbortController().signal));
    expect(parts.join('')).toBe('完整文本');
  });
});

describe('Anthropic 适配器 · 本地 mock SSE 服务端', () => {
  it('流式增量正确，且请求头含 anthropic-dangerous-direct-browser-access', async () => {
    const client = new AnthropicClient(api('/claude/v1', { provider: 'claude' }));
    const parts = await collect(
      client.chat(
        {
          ...req({
            messages: [
              { role: 'system', content: 'sys' },
              { role: 'user', content: 'hi' },
            ],
          }),
        },
        new AbortController().signal,
      ),
    );
    expect(parts).toEqual(['你', '好']);
    expect(captured.url).toBe('/claude/v1/messages');
    expect(captured.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(captured.headers['anthropic-version']).toBe('2023-06-01');
    expect(captured.headers['x-api-key']).toBe('sk-test-1234567890');
  });

  it('PDF 附件以 base64 document 内容块发送', async () => {
    const client = new AnthropicClient(api('/claude/v1', { provider: 'claude' }));
    await collect(
      client.chat(
        { ...req({ stream: false, attachment: PDF }) },
        new AbortController().signal,
      ),
    );
    const messages = captured.body.messages as Array<{ content: Array<Record<string, unknown>> }>;
    const doc = messages[0].content.find((b) => b.type === 'document') as {
      source: { type: string; media_type: string; data: string };
    };
    expect(doc).toBeTruthy();
    expect(doc.source).toEqual({
      type: 'base64',
      media_type: 'application/pdf',
      data: 'JVBERi0xLjQK',
    });
  });
});

describe('错误码归一化 · 真实 HTTP', () => {
  const cases: Array<[number, string]> = [
    [400, 'BAD_REQUEST'],
    [422, 'BAD_REQUEST'],
    [401, 'INVALID_KEY'],
    [429, 'RATE_LIMIT'],
    [500, 'NETWORK'],
  ];

  for (const [status, code] of cases) {
    it(`HTTP ${status} → ${code}`, async () => {
      const client = new OpenAIClient(api(`/status/${status}/v1`), 'none');
      await expect(
        collect(client.chat(req({ stream: false }), new AbortController().signal)),
      ).rejects.toMatchObject({ code });
    });
  }

  it('错误 detail 必带 HTTP 状态码（响应体为空时仍可定位）', async () => {
    // mock 服务端对 400 返回空响应体，模拟部分服务商/中转的行为
    const client = new OpenAIClient(api('/empty400/v1'), 'none');
    await expect(
      collect(client.chat(req({ stream: false }), new AbortController().signal)),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', detail: expect.stringContaining('HTTP 400') });
  });

  it('请求延迟超过配置超时 → TIMEOUT（llm:test 路径的真实超时中断）', async () => {
    await chrome.storage.local.set({
      boss_ai_settings: { api: { ...api('/slow/v1'), timeoutSec: 1, key: 'sk-test-1234567890' } },
    });
    const { registerMessageHandler } = await import('../handlers');
    let listener:
      | ((msg: unknown, sender: unknown, send: (res: unknown) => void) => unknown)
      | null = null;
    (globalThis as unknown as { chrome: { runtime: unknown } }).chrome.runtime = {
      onMessage: {
        addListener: (
          fn: (msg: unknown, sender: unknown, send: (res: unknown) => void) => unknown,
        ) => {
          listener = fn;
        },
      },
      onConnect: { addListener: () => undefined },
    };
    registerMessageHandler();
    const res = await withDeadline(
      new Promise<{ ok: boolean; error?: { code: string } }>((resolve) => {
        if (!listener) throw new Error('消息监听器未注册');
        listener({ type: 'llm:test', payload: {} }, {}, (r) => resolve(r as never));
      }),
      5000,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('TIMEOUT');
  });

  it('AbortController.abort() → ABORTED，且不会永久悬挂', async () => {
    const client = new OpenAIClient(api('/hang/v1'), 'none');
    const controller = new AbortController();
    const pending = collect(client.chat(req(), controller.signal));
    setTimeout(() => controller.abort(), 100);
    await expect(withDeadline(pending, 3000)).rejects.toMatchObject({ code: 'ABORTED' });
  });
});

/** 岗位信息。 */
function makeJob(tag: string): JobInfo {
  return {
    id: `j-${tag}`,
    title: '前端工程师',
    company: '某公司',
    salary: '10-20K',
    city: '上海',
    experience: '3-5年',
    education: '本科',
    tags: [],
    jd: [`职责：${tag}`],
    hrName: 'HR',
    url: '',
    source: 'detail',
  };
}

describe('runner JSON 重试 · 真实 HTTP', () => {
  it('首次返回非法 JSON、第二次合法 → 仅重试 1 次并成功', async () => {
    const { runTaskWithLLM } = await import('../runner');
    const res = await runTaskWithLLM({
      task: 'jobAnalysis',
      payload: { job: makeJob('retry') } as LLMPayload,
      settings: api('/retrybad/v1'),
      signal: new AbortController().signal,
    });
    expect(captured.count).toBe(2);
    expect(res.fromCache).toBe(false);
    expect(res.value).toMatchObject({ summary: '重试成功' });
  });

  it('两次都非法 → 抛 BAD_JSON 且总共只请求 2 次', async () => {
    const { runTaskWithLLM } = await import('../runner');
    await expect(
      runTaskWithLLM({
        task: 'jobAnalysis',
        payload: { job: makeJob('alwaysbad') } as LLMPayload,
        settings: api('/alwaysbad/v1'),
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'BAD_JSON' });
    expect(captured.count).toBe(2);
  });
});
