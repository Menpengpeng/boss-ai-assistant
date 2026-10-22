import { describe, expect, it } from 'vitest';
import { BG_PORT_NAME, isBgResponse, makeRequestId } from '../protocol';
import type { BgRequest, BgResponse } from '../protocol';

describe('isBgResponse', () => {
  it('合法成功响应', () => {
    expect(isBgResponse({ ok: true, data: 1 })).toBe(true);
    expect(isBgResponse({ ok: true, data: null })).toBe(true);
  });

  it('合法失败响应', () => {
    expect(isBgResponse({ ok: false, error: { code: 'NO_KEY', message: '未配置' } })).toBe(true);
  });

  it('非法输入一律判定为 false', () => {
    expect(isBgResponse({ ok: true })).toBe(false);
    expect(isBgResponse({ ok: false, error: {} })).toBe(false);
    expect(isBgResponse({ ok: false, error: { code: 'NO_KEY' } })).toBe(false);
    expect(isBgResponse({ ok: 'yes', data: 1 })).toBe(false);
    expect(isBgResponse(null)).toBe(false);
    expect(isBgResponse(undefined)).toBe(false);
    expect(isBgResponse('ok')).toBe(false);
  });

  it('可作为类型守卫使用', () => {
    const value: unknown = { ok: true, data: { x: 1 } } as BgResponse<{ x: number }>;
    if (isBgResponse(value)) {
      expect(value.ok).toBe(true);
    } else {
      throw new Error('守卫判断错误');
    }
  });
});

describe('makeRequestId', () => {
  it('每次生成都不同且非空', () => {
    const a = makeRequestId();
    const b = makeRequestId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(0);
    expect(a.startsWith('rq_')).toBe(true);
  });
});

describe('BG_PORT_NAME', () => {
  it('与约定值一致', () => {
    expect(BG_PORT_NAME).toBe('boss-ai-llm');
  });
});

describe('BgRequest 判别联合', () => {
  it('请求都带 type 与 payload 字段', () => {
    const req: BgRequest = { type: 'cache:get', payload: { key: 'k1' } };
    expect(req.type).toBe('cache:get');
    expect(req.payload).toEqual({ key: 'k1' });
  });
});
