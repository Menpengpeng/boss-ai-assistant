import { describe, expect, it } from 'vitest';
import {
  AppError,
  ERROR_TIPS,
  errorResponse,
  isAbortError,
  normalizeHttpStatus,
  toAppError,
} from '../errors';

describe('normalizeHttpStatus', () => {
  it('各分支映射正确', () => {
    expect(normalizeHttpStatus(401)).toBe('INVALID_KEY');
    expect(normalizeHttpStatus(403)).toBe('INVALID_KEY');
    expect(normalizeHttpStatus(404)).toBe('NETWORK');
    expect(normalizeHttpStatus(408)).toBe('TIMEOUT');
    expect(normalizeHttpStatus(429)).toBe('RATE_LIMIT');
    expect(normalizeHttpStatus(500)).toBe('NETWORK');
    expect(normalizeHttpStatus(503)).toBe('NETWORK');
    expect(normalizeHttpStatus(418)).toBe('UNKNOWN');
    expect(normalizeHttpStatus(200)).toBe('UNKNOWN');
  });
});

describe('errorResponse 不泄漏 API Key', () => {
  it('detail 中的疑似密钥被替换为 ***', () => {
    const secret = 'sk-abcdefghijklmnopqrstuvwxyz012345';
    const err = new AppError('INVALID_KEY', undefined, `请求头 Authorization: Bearer ${secret}`);
    const res = errorResponse(err);
    expect(res.code).toBe('INVALID_KEY');
    expect(res.message).not.toContain(secret);
    expect(res.message).not.toContain('sk-');
    expect(res.message).toContain('***');
  });

  it('detail 被截断到 200 字符以内', () => {
    const err = new AppError('UNKNOWN', undefined, 'x'.repeat(500));
    const res = errorResponse(err);
    expect(res.message.length).toBeLessThanOrEqual(200 + ERROR_TIPS.UNKNOWN.title.length + 1);
  });

  it('无 detail 时使用错误码对应文案', () => {
    expect(errorResponse(new AppError('NO_KEY')).message).toBe(ERROR_TIPS.NO_KEY.title);
  });
});

describe('toAppError', () => {
  it('DOMException AbortError → ABORTED', () => {
    const aborted = toAppError(new DOMException('aborted', 'AbortError'));
    expect(aborted.code).toBe('ABORTED');
    expect(isAbortError(new DOMException('aborted', 'AbortError'))).toBe(true);
  });

  it('TypeError fetch failed → NETWORK', () => {
    expect(toAppError(new TypeError('fetch failed')).code).toBe('NETWORK');
  });

  it('AppError 原样返回', () => {
    const err = new AppError('RATE_LIMIT');
    expect(toAppError(err)).toBe(err);
  });

  it('其它异常 → UNKNOWN', () => {
    expect(toAppError(new Error('boom')).code).toBe('UNKNOWN');
    expect(toAppError('boom').code).toBe('UNKNOWN');
  });
});

describe('ERROR_TIPS 完整性', () => {
  it('每个错误码都有文案与按钮动作', () => {
    for (const tip of Object.values(ERROR_TIPS)) {
      expect(tip.title.length).toBeGreaterThan(0);
      expect(tip.body.length).toBeGreaterThan(0);
      expect(typeof tip.action).toBe('string');
    }
    expect(ERROR_TIPS.NOT_LOGGED_IN.title).toContain('请先登录');
  });
});
