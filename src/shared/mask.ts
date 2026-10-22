/**
 * 本地脱敏（F2）：手机号 / 邮箱 / 微信号 / 身份证号 + 姓名（可选）。
 * 规则与原型 MASKS 对齐；同一原文多次出现映射为同一占位符；
 * 脱敏结果中绝不残留原文（占位符形如 [手机号1] / [邮箱1] / [姓名1]）。
 */

/** 一条脱敏规则。 */
export interface MaskRule {
  label: string;
  re: RegExp;
}

/**
 * 脱敏规则表。
 * 注意：身份证号必须最先执行 —— 18 位号码中间可能包含形如「1[3-9]\d{9}」的片段，
 * 若先跑手机号规则会把身份证号切碎，从而残留原文。规则正则本身与原型 MASKS 保持一致。
 */
export const MASK_RULES: MaskRule[] = [
  { label: '身份证号', re: /\d{17}[\dXx]/g },
  { label: '手机号', re: /1[3-9]\d{9}/g },
  { label: '邮箱', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { label: '微信号', re: /(?:微信|wx|vx|weixin)[号：:\s]*([A-Za-z0-9_-]{5,20})/gi },
];

/** 正则元字符转义（姓名按字面量匹配）。 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 从已有 map 中找出某个标签下该原文对应的占位符；不存在则新建并写入 map。 */
function placeholderOf(
  label: string,
  value: string,
  map: Record<string, string>,
): string {
  for (const [ph, origin] of Object.entries(map)) {
    if (origin === value && ph.startsWith(`[${label}`)) return ph;
  }
  let n = 1;
  while (map[`[${label}${n}]`]) n += 1;
  const ph = `[${label}${n}]`;
  map[ph] = value;
  return ph;
}

/**
 * 对文本脱敏。
 * @param text 原文
 * @param opts name 姓名（可选）、maskName 是否脱敏姓名（默认否）
 * @returns masked 脱敏文本；map 占位符 → 原文
 */
export function maskText(
  text: string,
  opts: { name?: string; maskName?: boolean } = {},
): { masked: string; map: Record<string, string> } {
  const map: Record<string, string> = {};
  let out = text ?? '';

  if (opts.maskName && opts.name) {
    const re = new RegExp(escapeRegExp(opts.name), 'g');
    out = out.replace(re, () => placeholderOf('姓名', opts.name as string, map));
  }

  for (const rule of MASK_RULES) {
    out = out.replace(rule.re, (match) => placeholderOf(rule.label, match, map));
  }

  return { masked: out, map };
}

/** 只脱敏姓名（复用外部 map，保证编号一致）。 */
export function maskNameOnly(
  text: string,
  name: string,
  map: Record<string, string>,
): string {
  if (!name) return text ?? '';
  const ph = placeholderOf('姓名', name, map);
  return (text ?? '').replace(new RegExp(escapeRegExp(name), 'g'), ph);
}

/** 反向还原：把占位符替换回原文（按长度倒序，避免 [手机号1] 抢先匹配 [手机号10]）。 */
export function unmaskText(text: string, map: Record<string, string>): string {
  let out = text ?? '';
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    out = out.split(key).join(map[key]);
  }
  return out;
}
