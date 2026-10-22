/**
 * 模型输出解析与校验工具（Task 2.6）。
 * - extractJson：容忍 ```json 围栏、前后解释文字、推理模型 <think> 思考块、
 *   多个 JSON 对象、尾逗号、字符串内裸换行等真实模型输出形态
 * - 各类字段归一化（字符串/字符串数组/分数/风险等级）
 * - 证据子串校验：evidence 必须是原文片段，否则丢弃
 */
import type { EvidenceSrc, JobInfo, QuickReview, RiskItem, RiskLevel } from './types';

/** 是否为普通对象（排除 null / 数组）。 */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 压缩空白：换行、制表符、多空格统一为单个空格并 trim。 */
export function normalizeWhitespace(s: string): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** 截断为不超过 max 个字符（超出时以省略号结尾，保证结果长度 ≤ max）。 */
export function truncate(s: string, max: number): string {
  const text = String(s ?? '');
  if (max <= 0) return '';
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

/**
 * 从模型返回文本中提取 JSON（容忍真实模型的常见输出形态）。
 * 依次处理：
 * 1. 剥离推理模型的思考块 <think>…</think>（块内常含花括号，会干扰定位）；
 * 2. 优先取 ```json 围栏内容（未闭合的截断围栏则回退全文扫描）；
 * 3. 字符串感知的配对扫描：逐个提取「括号平衡」的候选片段再解析，
 *    避免「首个 { 到最后一个 }」的跨度被解释文字/多个对象/思考块打穿；
 * 4. 候选解析失败时做最小修复（尾逗号、字符串内裸换行/制表符）后重试。
 */
export function extractJson<T = unknown>(raw: string): T | null {
  if (!raw) return null;
  // 去 BOM / 零宽字符等不可见噪声
  const text = String(raw)
    .replace(/[\uFEFF\u200B\u200C\u200D]/g, '')
    // 思考块整体移除：截断未闭合的 <think> 之后不会再有正文，一并移除
    .replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, ' ')
    .trim();

  // 围栏内容优先（正则要求闭合；截断的围栏走全文扫描）
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1] !== undefined && fence[1].trim()) {
    const hit = scanFirstJson(fence[1]);
    if (hit !== null) return hit as T;
  }
  return scanFirstJson(text) as T | null;
}

/** 修复候选片段里最常见的两类 JSON 瑕疵：尾逗号、字符串值内的裸控制字符。 */
function repairCandidate(payload: string): string {
  let s = payload.replace(/,(\s*[}\]])/g, '$1');
  let out = '';
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (inStr) {
      if (esc) {
        out += ch;
        esc = false;
      } else if (ch === '\\') {
        out += ch;
        esc = true;
      } else if (ch === '"') {
        inStr = false;
        out += ch;
      } else if (ch === '\n') {
        out += '\\n';
      } else if (ch === '\r') {
        out += '\\r';
      } else if (ch === '\t') {
        out += '\\t';
      } else {
        out += ch;
      }
      continue;
    }
    if (ch === '"') inStr = true;
    out += ch;
  }
  return out;
}

/**
 * 从文本中找到第一个可成功解析的「括号平衡」JSON 片段。
 * 字符串感知：花括号/方括号出现在字符串字面量内时不会参与配对，
 * 因此解释文字里随口出现的引号或花括号不会让扫描错位。
 */
function scanFirstJson(text: string): unknown | null {
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const open = text[i];
    if (open !== '{' && open !== '[') continue;

    let depth = 0;
    let inStr = false;
    let quote = '';
    for (let j = i; j < n; j++) {
      const ch = text[j];
      if (inStr) {
        if (ch === '\\') {
          j++; // 跳过转义字符
        } else if (ch === quote) {
          inStr = false;
        }
        continue;
      }
      if (ch === '"' || ch === "'") {
        inStr = true;
        quote = ch;
        continue;
      }
      if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(i, j + 1);
          try {
            return JSON.parse(candidate);
          } catch {
            try {
              return JSON.parse(repairCandidate(candidate));
            } catch {
              break; // 该片段无法修复，换下一个起始位置（可命中其内部嵌套对象）
            }
          }
        }
      }
    }
  }
  return null;
}

/** 归一化为字符串；非法返回 fallback。 */
export function asString(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback;
}

/** 归一化为字符串数组；非数组返回 []。 */
export function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v
      .map((item) => {
        if (typeof item === 'string') return item;
        if (typeof item === 'number' || typeof item === 'boolean') return String(item);
        return '';
      })
      .filter((item) => item !== '');
  }
  if (typeof v === 'string' && v.trim()) return [v.trim()];
  return [];
}

/** 归一化分数：非法/越界 → 0，合法则四舍五入到 0..100 整数。 */
export function clampScore(n: unknown): number {
  const num = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num)));
}

/** 归一化风险等级；非法 → '低'。 */
export function asRiskLevel(v: unknown): RiskLevel {
  return v === '高' || v === '中' || v === '低' ? v : '低';
}

/** 依证据来源取原文文本池（用于子串校验）。 */
export function pageTextFor(job: JobInfo, src: EvidenceSrc, extra?: string): string {
  switch (src) {
    case 'JD':
      return Array.isArray(job?.jd) ? job.jd.join('\n') : '';
    case '薪资':
      return job?.salary ?? '';
    case '标签':
      return Array.isArray(job?.tags) ? job.tags.join(' ') : '';
    case '聊天':
      return extra ?? '';
    default:
      return '';
  }
}

/**
 * 证据子串校验：
 * evidence 为空、或（压缩空白后）不是对应文本池的子串 → 进 drop。
 */
export function validateEvidence(
  items: RiskItem[],
  textOf: (item: RiskItem) => string,
): { ok: RiskItem[]; drop: RiskItem[] } {
  const ok: RiskItem[] = [];
  const drop: RiskItem[] = [];
  for (const item of items ?? []) {
    const evidence = normalizeWhitespace(item?.evidence ?? '');
    const pool = normalizeWhitespace(textOf(item) ?? '');
    if (!evidence || !pool || !pool.includes(evidence)) {
      drop.push(item);
    } else {
      ok.push(item);
    }
  }
  return { ok, drop };
}

/** 轻量守卫：判断任意值是否形如 QuickReview。 */
export function isScoreBadge(s: unknown): s is QuickReview {
  if (!isPlainObject(s)) return false;
  const score = s.score;
  const verdict = s.verdict;
  const riskLevel = s.riskLevel;
  const riskCount = s.riskCount;
  if (typeof score !== 'number' || !Number.isFinite(score)) return false;
  if (typeof verdict !== 'string') return false;
  if (riskLevel !== '高' && riskLevel !== '中' && riskLevel !== '低') return false;
  if (typeof riskCount !== 'number' || !Number.isFinite(riskCount)) return false;
  return true;
}
