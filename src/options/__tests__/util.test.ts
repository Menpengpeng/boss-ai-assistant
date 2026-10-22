import { describe, expect, it } from 'vitest';
import { beforeAll, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import type { AnalysisRecord } from '../../shared/types';
import {
  buildCsv,
  buildMarkdown,
  csvField,
  filterHistory,
  formatScore,
  formatTime,
  isPdfHeader,
  kindLabel,
  maskKeyDisplay,
  needsOriginGrant,
  sha256Hex,
  toHex,
} from '../util';

// 测试环境（node）未默认暴露 crypto，用 vi.stubGlobal 注入 WebCrypto 以覆盖 sha256Hex
beforeAll(() => {
  vi.stubGlobal('crypto', webcrypto);
});

function rec(partial: Partial<AnalysisRecord>): AnalysisRecord {
  return {
    id: 'r1',
    at: 1_700_000_000_000,
    kind: 'analysis',
    jobId: 'j1',
    jobTitle: '前端工程师',
    company: '示例公司',
    model: 'deepseek-chat',
    score: null,
    riskCount: 0,
    content: '',
    ...partial,
  };
}

describe('maskKeyDisplay', () => {
  it('长度 > 8 时保留前 4 + 后 4', () => {
    expect(maskKeyDisplay('sk-1234567890abcdef')).toBe('sk-1***cdef');
  });

  it('长度 <= 8 时全部打码', () => {
    expect(maskKeyDisplay('sk-12345')).toBe('********');
    expect(maskKeyDisplay('sk-1234')).toBe('*******');
  });

  it('空值返回空串', () => {
    expect(maskKeyDisplay('')).toBe('');
  });
});

describe('isPdfHeader', () => {
  it('识别 %PDF 文件头', () => {
    expect(isPdfHeader(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe(true);
  });

  it('非 PDF 文件头返回 false', () => {
    expect(isPdfHeader(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(false);
    expect(isPdfHeader(new Uint8Array([0x25, 0x50]))).toBe(false);
  });
});

describe('sha256Hex', () => {
  it('计算 abc 的标准 SHA-256', async () => {
    const bytes = new TextEncoder().encode('abc');
    expect(await sha256Hex(bytes)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('toHex 补零', () => {
    expect(toHex(new Uint8Array([0, 15, 255]))).toBe('000fff');
  });
});

describe('needsOriginGrant', () => {
  it('内置域名无需授权', () => {
    expect(needsOriginGrant('https://www.zhipin.com/web/geek/job').needed).toBe(false);
  });

  it('自定义域名需要授权并返回 origin', () => {
    const r = needsOriginGrant('https://api.example.com/v1');
    expect(r.needed).toBe(true);
    expect(r.origin).toBe('https://api.example.com');
  });

  it('非法地址返回空 origin', () => {
    expect(needsOriginGrant('not-a-url').origin).toBe('');
  });
});

describe('csvField / buildCsv', () => {
  it('含逗号 / 引号 / 换行的字段被正确转义', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
    expect(csvField('plain')).toBe('plain');
  });

  it('表头与行数正确，分数 null 显示未提供', () => {
    const csv = buildCsv([rec({}), rec({ id: 'r2', score: 82, riskCount: 3 })]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('时间,岗位,公司,类型,匹配度,风险数,模型');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('未提供');
    expect(lines[2]).toContain(',82,3,deepseek-chat');
  });
});

describe('buildMarkdown', () => {
  it('生成含表头的 Markdown 表格', () => {
    const md = buildMarkdown([rec({ jobTitle: '前端|工程师' })]);
    expect(md).toContain('# BOSS 求职 AI 助手 · 分析历史');
    expect(md).toContain('| 时间 | 岗位 | 公司 | 类型 | 匹配度 | 风险数 | 模型 |');
    expect(md).toContain('前端\\|工程师');
  });
});

describe('filterHistory', () => {
  const list = [
    rec({ id: 'a', kind: 'analysis', jobTitle: '前端工程师', company: 'A 公司' }),
    rec({ id: 'b', kind: 'match', jobTitle: '后端工程师', company: 'B 公司' }),
  ];

  it('按类型筛选', () => {
    expect(filterHistory(list, 'match', '').map((r) => r.id)).toEqual(['b']);
  });

  it('按关键字匹配岗位或公司（大小写不敏感）', () => {
    expect(filterHistory(list, 'all', 'b 公司').map((r) => r.id)).toEqual(['b']);
    expect(filterHistory(list, 'all', '前端').map((r) => r.id)).toEqual(['a']);
  });
});

describe('展示工具', () => {
  it('kindLabel 与 formatScore', () => {
    expect(kindLabel('quickReview')).toBe('快评');
    expect(kindLabel('chat')).toBe('聊天');
    expect(formatScore(null)).toBe('未提供');
    expect(formatScore(0)).toBe('0');
  });

  it('formatTime 对非法值返回未提供', () => {
    expect(formatTime(Number.NaN)).toBe('未提供');
    expect(formatTime(1_700_000_000_000)).not.toBe('未提供');
  });
});
