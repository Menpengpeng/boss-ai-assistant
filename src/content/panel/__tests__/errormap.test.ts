// @vitest-environment jsdom
// 错误码映射单测：ErrorCard 必须能从 ERROR_TIPS 取到中文标题与按钮文案。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ERROR_TIPS } from '../../../shared/errors';
import type { ErrorCode } from '../../../shared/errors';
import { ErrorCard } from '../components/ErrorCard';

const codes = Object.keys(ERROR_TIPS) as ErrorCode[];

describe('ErrorCard ↔ ERROR_TIPS 映射', () => {
  it('错误码不少于 12 个', () => {
    expect(codes.length).toBeGreaterThanOrEqual(12);
  });

  it('逐个错误码都能渲染出中文标题（有操作时含按钮文案）', () => {
    for (const code of codes) {
      const tip = ERROR_TIPS[code];
      expect(tip.title.length).toBeGreaterThan(0);
      expect(/[\u4e00-\u9fa5]/.test(tip.title)).toBe(true);

      const html = renderToStaticMarkup(createElement(ErrorCard, { code }));
      expect(html).toContain(code);
      expect(html).toContain(tip.title);

      if (tip.action === 'none') {
        expect(html).not.toContain('ba-btn');
      } else {
        expect(tip.actionLabel.length).toBeGreaterThan(0);
        expect(html).toContain(tip.actionLabel);
      }
    }
  });

  it('自定义 message 优先于默认正文', () => {
    const html = renderToStaticMarkup(
      createElement(ErrorCard, { code: 'NETWORK' as ErrorCode, message: '自定义提示' }),
    );
    expect(html).toContain('自定义提示');
  });
});
