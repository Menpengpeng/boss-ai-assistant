// @vitest-environment jsdom
// 评分分档单测：≥70 绿 / 50–69 琥珀 / <50 红。
import { describe, expect, it } from 'vitest';
import { scoreTone } from '../components/ScoreRing';

describe('scoreTone', () => {
  it('边界值 100 / 70 / 69 / 50 / 49 / 0 分支正确', () => {
    expect(scoreTone(100)).toBe('ok');
    expect(scoreTone(70)).toBe('ok');
    expect(scoreTone(69)).toBe('warn');
    expect(scoreTone(50)).toBe('warn');
    expect(scoreTone(49)).toBe('err');
    expect(scoreTone(0)).toBe('err');
  });

  it('中间值分档稳定', () => {
    expect(scoreTone(85)).toBe('ok');
    expect(scoreTone(60)).toBe('warn');
    expect(scoreTone(20)).toBe('err');
  });
});
