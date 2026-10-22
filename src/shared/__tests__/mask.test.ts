import { describe, expect, it } from 'vitest';
import { maskText, maskNameOnly, unmaskText } from '../mask';

const RAW = [
  '张伟',
  '手机：13812345678',
  '邮箱：zhangwei@example.com',
  '微信：zhangwei888',
  '身份证：340104199203071234',
].join('\n');

describe('maskText 基础脱敏', () => {
  it('手机号 / 邮箱 / 微信号 / 身份证号被替换，且结果中不残留原文', () => {
    const { masked, map } = maskText(RAW);

    expect(masked).not.toContain('13812345678');
    expect(masked).not.toContain('zhangwei@example.com');
    expect(masked).not.toContain('zhangwei888');
    expect(masked).not.toContain('340104199203071234');

    expect(masked).toContain('[手机号1]');
    expect(masked).toContain('[邮箱1]');
    expect(masked).toContain('[微信号1]');
    expect(masked).toContain('[身份证号1]');

    expect(map['[手机号1]']).toBe('13812345678');
    expect(map['[邮箱1]']).toBe('zhangwei@example.com');
    expect(map['[身份证号1]']).toBe('340104199203071234');
  });

  it('身份证号不会被手机号规则切碎', () => {
    const { masked } = maskText('证件号 340104199203071234 结束');
    expect(masked).toBe('证件号 [身份证号1] 结束');
  });

  it('同一原文多次出现映射为同一个占位符', () => {
    const { masked, map } = maskText('13800138000 与 13800138000 一样');
    expect(masked).toBe('[手机号1] 与 [手机号1] 一样');
    expect(Object.keys(map)).toEqual(['[手机号1]']);
    expect(map['[手机号1]']).toBe('13800138000');
  });

  it('不同原文按首次出现顺序递增编号', () => {
    const { masked } = maskText('13800138000 / 13900139000');
    expect(masked).toBe('[手机号1] / [手机号2]');
  });
});

describe('maskText 姓名开关', () => {
  it('开启时姓名被脱敏', () => {
    const { masked, map } = maskText('张伟的手机是 13800138000', {
      name: '张伟',
      maskName: true,
    });
    expect(masked).not.toContain('张伟');
    expect(masked).toContain('[姓名1]');
    expect(map['[姓名1]']).toBe('张伟');
  });

  it('关闭时姓名保留原文', () => {
    const { masked } = maskText('张伟的手机是 13800138000', {
      name: '张伟',
      maskName: false,
    });
    expect(masked).toContain('张伟');
    expect(masked).toContain('[手机号1]');
  });
});

describe('maskNameOnly', () => {
  it('复用外部 map 并保持编号一致', () => {
    const map: Record<string, string> = {};
    expect(maskNameOnly('张伟你好，张伟', '张伟', map)).toBe('[姓名1]你好，[姓名1]');
    expect(map['[姓名1]']).toBe('张伟');
  });
});

describe('unmaskText', () => {
  it('能把占位符还原为原文', () => {
    const { masked, map } = maskText(RAW);
    expect(unmaskText(masked, map)).toBe(RAW);
  });

  it('按长度倒序替换，避免前缀抢占', () => {
    const map = { '[手机号1]': '13800138000', '[手机号10]': '13900139000' };
    expect(unmaskText('A=[手机号10] B=[手机号1]', map)).toBe('A=13900139000 B=13800138000');
  });
});
