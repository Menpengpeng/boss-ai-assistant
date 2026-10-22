/**
 * 结果缓存单测：往返一致、Key 随 resumeVersion/model 变化、超过 CACHE_MAX 淘汰最旧。
 * 通过内存假 chrome.storage.local 完成，不访问真实扩展环境。
 */
import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { JobInfo } from '../../shared/types';
import { CACHE_MAX, jdOf, readCache, writeCache } from '../cache';

// vitest 的 node 环境不暴露 globalThis.crypto，注入 Node WebCrypto 供 sha256 使用
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

/** 内存版 chrome.storage.local。 */
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
};

/** 构造岗位信息。 */
function makeJob(id: string, jd: string): JobInfo {
  return {
    id,
    title: `岗位${id}`,
    company: '某公司',
    salary: '10-20K',
    city: '上海',
    experience: '3-5年',
    education: '本科',
    tags: ['双休'],
    jd: [jd],
    hrName: 'HR',
    url: 'https://www.zhipin.com/job_detail/x.html',
    source: 'detail',
  };
}

beforeEach(() => {
  for (const k of Object.keys(memory)) delete memory[k];
});

describe('jdOf', () => {
  it('把 JD 各行以换行拼接', () => {
    const job = makeJob('j1', 'a');
    job.jd = ['a', 'b'];
    expect(jdOf(job)).toBe('a\nb');
  });
});

describe('readCache / writeCache', () => {
  it('写入后可原样读回', async () => {
    const job = makeJob('j1', '要求：抗压能力强');
    await writeCache('jobAnalysis', job, 1, 'gpt-4o-mini', { score: 80, red: [] });
    const got = await readCache<{ score: number }>('jobAnalysis', job, 1, 'gpt-4o-mini');
    expect(got).toEqual({ score: 80, red: [] });
  });

  it('resumeVersion 或 model 变化时读不到', async () => {
    const job = makeJob('j1', 'jd');
    await writeCache('jobAnalysis', job, 1, 'm1', { v: 1 });
    expect(await readCache('jobAnalysis', job, 2, 'm1')).toBeNull();
    expect(await readCache('jobAnalysis', job, 1, 'm2')).toBeNull();
    expect(await readCache('jobAnalysis', job, 1, 'm1')).toEqual({ v: 1 });
  });

  it('超过 CACHE_MAX 时淘汰最旧条目', async () => {
    const total = CACHE_MAX + 5;
    for (let i = 0; i < total; i += 1) {
      const job = makeJob('j' + i, 'jd-' + i);
      await writeCache('jobAnalysis', job, 1, 'm1', { i });
    }
    const keys = Object.keys(memory).filter((k) => k.startsWith('boss_ai_cache_'));
    expect(keys.length).toBe(CACHE_MAX);
  });
});
