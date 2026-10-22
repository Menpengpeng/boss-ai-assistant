/**
 * Prompt 执行器单测：JSON 重试、证据校验写回、PDF 不支持前置拒绝、NO_KEY / NO_PERMISSION 门控。
 * LLM 客户端、简历加载与历史落库均被替身取代，不访问真实网络与 IndexedDB。
 */
import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiSettings, JobInfo, PdfAttachment } from '../../shared/types';
import type { LLMPayload } from '../../shared/protocol';
import type { ResumeContext } from '../resume';
import { runTaskWithLLM } from '../runner';

// vitest 的 node 环境不暴露 globalThis.crypto，注入 Node WebCrypto 供缓存 Key 使用
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

/** 供各用例替换的替身（vi.hoisted 保证在模块工厂执行前已初始化）。 */
const hoisted = vi.hoisted(() => ({
  resume: null as unknown,
  client: null as unknown,
  addAnalysis: vi.fn(async () => undefined),
}));

vi.mock('../resume', () => ({
  loadResumeContext: async () => hoisted.resume,
  blobToBase64: async () => 'QUJD',
}));

vi.mock('../llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../llm')>();
  return { ...actual, createClient: () => hoisted.client };
});

vi.mock('../../shared/idb', () => ({
  addAnalysis: hoisted.addAnalysis,
}));

/** 内存版 chrome.storage.local + 权限开关。 */
const memory: Record<string, unknown> = {};
let granted = true;
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
  permissions: { contains: async () => granted },
};

/** 假 LLM 客户端：依次吐出给定回复，并统计 chat 调用次数。 */
interface FakeClient {
  kind: 'openai';
  chatCalls: number;
  chat(req: unknown, signal: AbortSignal): AsyncIterable<string>;
  test(signal: AbortSignal): Promise<number>;
  capabilities(): { pdf: 'native' | 'none'; stream: boolean };
}

function fakeClient(replies: string[], pdf: 'native' | 'none' = 'native'): FakeClient {
  const client: FakeClient = {
    kind: 'openai',
    chatCalls: 0,
    async *chat(): AsyncIterable<string> {
      const reply = replies[Math.min(client.chatCalls, replies.length - 1)] ?? '';
      client.chatCalls += 1;
      if (reply) yield reply;
    },
    async test(): Promise<number> {
      return 1;
    },
    capabilities: () => ({ pdf, stream: true }),
  };
  return client;
}

/** 配置。 */
function api(over: Partial<ApiSettings> = {}): ApiSettings {
  return {
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
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

/** 岗位信息。 */
function makeJob(): JobInfo {
  return {
    id: 'j1',
    title: '前端工程师',
    company: '某公司',
    salary: '10-20K',
    city: '上海',
    experience: '3-5年',
    education: '本科',
    tags: ['双休'],
    jd: ['要求：抗压能力强，能接受加班'],
    hrName: 'HR',
    url: 'https://www.zhipin.com/job_detail/x.html',
    source: 'detail',
  };
}

/** 合法岗位分析 JSON。 */
const VALID_JSON = JSON.stringify({
  summary: '负责前端开发',
  duties: ['负责业务前端开发'],
  skills: ['Vue'],
  nice: [],
  red: [],
  strengths: [],
  gaps: [],
  advice: [],
});

/** 用于证据校验的岗位分析 JSON（1 条可回溯、1 条不可回溯）。 */
const EVIDENCE_JSON = JSON.stringify({
  summary: '负责前端开发',
  duties: ['负责业务前端开发'],
  skills: [],
  nice: [],
  red: [
    { level: '高', type: '加班暗示', conclusion: '要求抗压', evidence: '抗压能力强', src: 'JD' },
    { level: '低', type: '编造项', conclusion: '不存在', evidence: '这段原文根本不存在', src: 'JD' },
  ],
  strengths: [],
  gaps: [],
  advice: [],
});

/** PDF 简历上下文替身。 */
const PDF_CONTEXT: ResumeContext = {
  version: 1,
  kind: 'pdf',
  maskName: true,
  text: '',
  attachment: {
    kind: 'pdf',
    mime: 'application/pdf',
    base64: 'QUJD',
    size: 3,
    sha256: 'x',
    filename: 'resume.pdf',
  } as PdfAttachment,
};

beforeEach(() => {
  for (const k of Object.keys(memory)) delete memory[k];
  granted = true;
  hoisted.resume = null;
  hoisted.client = null;
  hoisted.addAnalysis.mockClear();
});

describe('runTaskWithLLM', () => {
  it('JSON 首次非法时重试一次，第二次合法则返回', async () => {
    const client = fakeClient(['完全不是 JSON', VALID_JSON]);
    hoisted.client = client;
    const payload = { job: makeJob() } as LLMPayload;

    const res = await runTaskWithLLM({
      task: 'jobAnalysis',
      payload,
      settings: api(),
      signal: new AbortController().signal,
    });

    expect(client.chatCalls).toBe(2);
    expect(res.fromCache).toBe(false);
    expect(res.value).toMatchObject({ summary: '负责前端开发' });
    expect(hoisted.addAnalysis).toHaveBeenCalledTimes(1);
  });

  it('两次都非法时抛 BAD_JSON', async () => {
    const client = fakeClient(['不是 JSON', '仍然不是 JSON']);
    hoisted.client = client;
    await expect(
      runTaskWithLLM({
        task: 'jobAnalysis',
        payload: { job: makeJob() } as LLMPayload,
        settings: api(),
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'BAD_JSON' });
    expect(client.chatCalls).toBe(2);
  });

  it('证据校验丢弃无法在原文定位的风险条目并写回结果', async () => {
    const client = fakeClient([EVIDENCE_JSON]);
    hoisted.client = client;

    const res = await runTaskWithLLM({
      task: 'jobAnalysis',
      payload: { job: makeJob() } as LLMPayload,
      settings: api(),
      signal: new AbortController().signal,
    });

    expect(res.dropped).toBe(1);
    const value = res.value as { red: unknown[] };
    expect(value.red).toHaveLength(1);
  });

  it('PDF 附件 + 服务商不支持 PDF 时抛 UNSUPPORTED_ATTACHMENT 且未发起任何 chat 调用', async () => {
    hoisted.resume = PDF_CONTEXT;
    const client = fakeClient(['ok'], 'none');
    hoisted.client = client;

    await expect(
      runTaskWithLLM({
        task: 'match',
        payload: { job: makeJob() } as LLMPayload,
        settings: api(),
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_ATTACHMENT' });
    expect(client.chatCalls).toBe(0);
  });

  it('Key 为空时抛 NO_KEY 且未发起任何调用', async () => {
    const client = fakeClient(['ok']);
    hoisted.client = client;
    await expect(
      runTaskWithLLM({
        task: 'jobAnalysis',
        payload: { job: makeJob() } as LLMPayload,
        settings: api({ key: '' }),
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'NO_KEY' });
    expect(client.chatCalls).toBe(0);
  });

  it('域名未授权时抛 NO_PERMISSION 且未发起任何调用', async () => {
    granted = false;
    const client = fakeClient(['ok']);
    hoisted.client = client;
    await expect(
      runTaskWithLLM({
        task: 'jobAnalysis',
        payload: { job: makeJob() } as LLMPayload,
        settings: api(),
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'NO_PERMISSION' });
    expect(client.chatCalls).toBe(0);
  });
});
