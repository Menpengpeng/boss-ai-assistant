// @vitest-environment jsdom
// 流式客户端单测：delta→done / error / disconnect 三条路径 + abort 行为。
import { describe, expect, it, vi } from 'vitest';
import type { JobInfo } from '../../../shared/types';

type MsgListener = (msg: unknown) => void;

/** 假 Port：记录 postMessage，可手动派发消息与断开。 */
class FakePort {
  name = '';
  sent: unknown[] = [];
  private msgListeners: MsgListener[] = [];
  private disconnectListeners: Array<() => void> = [];
  onMessage = {
    addListener: (fn: MsgListener): void => {
      this.msgListeners.push(fn);
    },
  };
  onDisconnect = {
    addListener: (fn: () => void): void => {
      this.disconnectListeners.push(fn);
    },
  };
  postMessage(msg: unknown): void {
    this.sent.push(msg);
  }
  disconnect(): void {
    this.disconnectListeners.forEach((fn) => fn());
  }
  emit(msg: unknown): void {
    this.msgListeners.forEach((fn) => fn(msg));
  }
}

let lastPort: FakePort | null = null;
(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: {
    connect: vi.fn(() => {
      lastPort = new FakePort();
      return lastPort;
    }),
    sendMessage: vi.fn(),
  },
  storage: {
    local: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
    onChanged: { addListener: () => undefined, removeListener: () => undefined },
  },
};

import { abortAllTasks, runTask } from '../llm-client';

const JOB: JobInfo = {
  id: 'j1',
  title: '软件测试工程师',
  company: '某公司',
  salary: '20-40K',
  city: '合肥',
  experience: '5-10年',
  education: '本科',
  tags: [],
  jd: ['负责性能测试方案设计'],
  hrName: '王先生',
  url: 'https://www.zhipin.com/job_detail/x.html',
  source: 'detail',
};

/** 取最近一次 start 消息的 requestId。 */
function startId(port: FakePort): string {
  const start = port.sent[0] as { type: string; requestId: string };
  expect(start.type).toBe('start');
  return start.requestId;
}

describe('llm-client 流式路径', () => {
  it('delta → done：onDelta 按序回调，done resolve 全文', async () => {
    abortAllTasks();
    const deltas: string[] = [];
    const onDone = vi.fn();
    const handle = runTask('jobAnalysis', { job: JOB }, { onDelta: (t) => deltas.push(t), onDone });
    const port = lastPort as FakePort;
    const requestId = startId(port);

    port.emit({ type: 'delta', requestId, text: '你好' });
    port.emit({ type: 'delta', requestId, text: '世界' });
    port.emit({ type: 'done', requestId, text: '你好世界' });

    await expect(handle.done).resolves.toBe('你好世界');
    expect(deltas).toEqual(['你好', '世界']);
    expect(onDone).toHaveBeenCalledWith('你好世界');
  });

  it('error：done reject 为 AppError(code)', async () => {
    abortAllTasks();
    const onError = vi.fn();
    const handle = runTask('match', { job: JOB }, { onError });
    const port = lastPort as FakePort;
    const requestId = startId(port);

    const caught = handle.done.catch((e: unknown) => e);
    port.emit({ type: 'error', requestId, code: 'RATE_LIMIT', message: '请求过于频繁' });

    const err = (await caught) as { code?: string; message?: string };
    expect(err.code).toBe('RATE_LIMIT');
    expect(err.message).toBe('请求过于频繁');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('disconnect：在途任务以 NETWORK 失败结束，不永久 pending', async () => {
    abortAllTasks();
    const handle = runTask('greeting', { job: JOB });
    const port = lastPort as FakePort;
    startId(port);

    const caught = handle.done.catch((e: unknown) => e);
    port.disconnect();

    const err = (await caught) as { code?: string };
    expect(err.code).toBe('NETWORK');
  });

  it('abort() 向 Port 发送 abort 消息并让 done reject 为 ABORTED', async () => {
    abortAllTasks();
    const handle = runTask('interview', { job: JOB });
    const port = lastPort as FakePort;
    const requestId = startId(port);

    const caught = handle.done.catch((e: unknown) => e);
    handle.abort();

    expect(port.sent[1]).toEqual({ type: 'abort', requestId });
    const err = (await caught) as { code?: string };
    expect(err.code).toBe('ABORTED');
  });

  it('端口断开后再发起任务会重新建立连接', async () => {
    abortAllTasks();
    const before = lastPort;
    const handle = runTask('company', { job: JOB });
    expect(lastPort).not.toBe(before);
    const port = lastPort as FakePort;
    const caught = handle.done.catch((e: unknown) => e);
    port.disconnect();
    await caught;
    expect((chrome.runtime.connect as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThan(0);
  });
});
