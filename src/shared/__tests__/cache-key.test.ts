﻿import { describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { cacheKey, hash32, sha256Hex } from '../cache-key';

// 说明：vitest 的 node 测试环境不暴露 globalThis.crypto（jsdom 环境也没有 crypto.subtle），
// 因此仅在测试环境注入 Node 的 WebCrypto。扩展真实运行时（service worker / 页面）自带 crypto。
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

describe('hash32', () => {
  it('对相同输入稳定，且为 8 位十六进制', () => {
    expect(hash32('abc')).toBe(hash32('abc'));
    expect(hash32('abc')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('对空串也有稳定结果', () => {
    expect(hash32('')).toBe('811c9dc5');
  });

  it('对不同输入产生不同结果', () => {
    expect(hash32('abc')).not.toBe(hash32('abd'));
  });
});

describe('sha256Hex', () => {
  it('与已知向量一致', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('支持 Uint8Array 输入', async () => {
    const bytes = new TextEncoder().encode('abc');
    expect(await sha256Hex(bytes)).toBe(await sha256Hex('abc'));
  });
});

describe('cacheKey', () => {
  const base = {
    task: 'jobAnalysis',
    jd: '负责核心系统开发',
    resumeVersion: 1,
    model: 'deepseek-chat',
    promptVersion: 'p1.0',
  };

  it('相同输入得到相同 Key，长度 32', async () => {
    const a = await cacheKey(base);
    const b = await cacheKey({ ...base });
    expect(a).toBe(b);
    expect(a).toHaveLength(32);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it('jd / model / resumeVersion / promptVersion / task 任一变化都得到不同 Key', async () => {
    const original = await cacheKey(base);
    expect(await cacheKey({ ...base, jd: '另一段 JD' })).not.toBe(original);
    expect(await cacheKey({ ...base, model: 'glm-4-flash' })).not.toBe(original);
    expect(await cacheKey({ ...base, resumeVersion: 2 })).not.toBe(original);
    expect(await cacheKey({ ...base, promptVersion: 'p1.1' })).not.toBe(original);
    expect(await cacheKey({ ...base, task: 'match' })).not.toBe(original);
  });
});
