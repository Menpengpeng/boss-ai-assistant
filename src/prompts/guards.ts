/**
 * 各 JSON 任务的运行时守卫与归一化（Task 4.1）。
 * 职责：把模型输出强制收敛为 shared/types 的结构，缺失字段给安全默认值，绝不抛异常；
 * 结构合法性不足下限时返回 null，交由上层重试或报错。
 */
import { LIMITS } from '../shared/constants';
import type {
  ChatInsight,
  CompanyPoint,
  CompanyResult,
  EvidenceSrc,
  InterviewQuestion,
  InterviewResult,
  JobAnalysis,
  MatchResult,
  QuickReview,
  ReplySuggestion,
  RiskItem,
} from '../shared/types';
import {
  asRiskLevel,
  asString,
  asStringArray,
  clampScore,
  isPlainObject,
  normalizeWhitespace,
  truncate,
} from '../shared/validate';

/** 公司结论固定标注文案。 */
export const COMPANY_NOTE = '基于页面信息，非权威核实';

/** 列表类字段单项最大长度。 */
const LIST_ITEM_MAX = 200;
/** 风险条目标题/结论最大长度。 */
const RISK_TEXT_MAX = 40;

/** 归一化单行文本：压缩空白并截断。 */
function line(v: unknown, max = LIST_ITEM_MAX): string {
  return truncate(normalizeWhitespace(asString(v)), max);
}

/** 归一化字符串数组：剔除空串、压缩空白、去重、每项不超过 200 字。 */
function strList(v: unknown): string[] {
  const out: string[] = [];
  for (const item of asStringArray(v)) {
    const s = truncate(normalizeWhitespace(item), LIST_ITEM_MAX);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** 归一化证据来源；非法值回落到 fallback。 */
function asEvidenceSrc(v: unknown, fallback: EvidenceSrc): EvidenceSrc {
  return v === 'JD' || v === '薪资' || v === '标签' || v === '聊天' ? v : fallback;
}

/** 判断 score 字段是否存在（数值，或非空字符串）。 */
function hasScore(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') return v.trim() !== '';
  return false;
}

/**
 * 归一化风险条目列表。
 * evidence 去空白后为空、或条目非对象时直接丢弃（证据必须可回溯到原文）。
 */
export function normalizeRiskList(v: unknown, srcFallback: EvidenceSrc): RiskItem[] {
  const arr = Array.isArray(v) ? v : [];
  const out: RiskItem[] = [];
  for (const raw of arr) {
    if (!isPlainObject(raw)) continue;
    const evidence = asString(raw.evidence).trim();
    if (!evidence) continue;
    out.push({
      level: asRiskLevel(raw.level),
      type: line(raw.type, RISK_TEXT_MAX),
      conclusion: line(raw.conclusion, RISK_TEXT_MAX),
      evidence,
      src: asEvidenceSrc(raw.src, srcFallback),
    });
  }
  return out;
}

/** 归一化三种风格回复：style/text 均为文本，text 截断到 60 字。 */
function normalizeReplies(v: unknown): ReplySuggestion[] {
  const arr = Array.isArray(v) ? v : [];
  const out: ReplySuggestion[] = [];
  for (const raw of arr) {
    if (!isPlainObject(raw)) continue;
    const style = line(raw.style, 20);
    const text = truncate(normalizeWhitespace(asString(raw.text)), LIMITS.maxReplyChars);
    if (!style && !text) continue;
    out.push({ style, text });
  }
  return out;
}

/** 岗位分析守卫（F3）：要求 summary 非空，且 duties + skills 至少 1 项。 */
export function guardJobAnalysis(v: unknown): JobAnalysis | null {
  if (!isPlainObject(v)) return null;
  const summary = line(v.summary, LIST_ITEM_MAX);
  const duties = strList(v.duties);
  const skills = strList(v.skills);
  if (!summary) return null;
  if (duties.length + skills.length === 0) return null;
  return {
    summary,
    duties,
    skills,
    nice: strList(v.nice),
    red: normalizeRiskList(v.red, 'JD'),
    strengths: strList(v.strengths),
    gaps: strList(v.gaps),
    advice: strList(v.advice),
  };
}

/** 匹配度守卫（F4）：要求 score 字段存在。 */
export function guardMatch(v: unknown): MatchResult | null {
  if (!isPlainObject(v)) return null;
  if (!hasScore(v.score)) return null;
  return {
    score: clampScore(v.score),
    strengths: strList(v.strengths),
    gaps: strList(v.gaps),
    advice: strList(v.advice),
  };
}

/** 对话洞察守卫（F6 + F8）。 */
export function guardChatInsight(v: unknown): ChatInsight | null {
  if (!isPlainObject(v)) return null;
  return {
    intent: line(v.intent, 60),
    stage: line(v.stage, 20),
    pending: line(v.pending, 100),
    replies: normalizeReplies(v.replies),
    risks: normalizeRiskList(v.risks, '聊天'),
  };
}

/** 公司分析守卫（F10）；note 固定为「基于页面信息，非权威核实」。 */
export function guardCompany(v: unknown): CompanyResult | null {
  if (!isPlainObject(v)) return null;
  const points: CompanyPoint[] = [];
  const rawPoints = Array.isArray(v.points) ? v.points : [];
  for (const raw of rawPoints) {
    if (!isPlainObject(raw)) continue;
    const label = line(raw.label, RISK_TEXT_MAX);
    const value = line(raw.value, LIST_ITEM_MAX);
    if (!label && !value) continue;
    points.push({ label, value });
  }
  return {
    points,
    risks: normalizeRiskList(v.risks, 'JD'),
    note: COMPANY_NOTE,
  };
}

/**
 * 面试题守卫（F11）。
 * 题量不足 5 条时仍返回（由调用方决定是否提示/重试）；超过 8 条时截断到 8 条。
 */
export function guardInterview(v: unknown): InterviewResult | null {
  if (!isPlainObject(v)) return null;
  const rawQuestions = Array.isArray(v.questions) ? v.questions : [];
  const questions: InterviewQuestion[] = [];
  for (const raw of rawQuestions) {
    if (!isPlainObject(raw)) continue;
    const q = line(raw.q, LIST_ITEM_MAX);
    if (!q) continue;
    questions.push({ q, idea: line(raw.idea, LIST_ITEM_MAX) });
    if (questions.length >= 8) break;
  }
  return { questions };
}

/** 列表快评守卫（F7）：要求 score 字段存在。 */
export function guardQuickReview(v: unknown): QuickReview | null {
  if (!isPlainObject(v)) return null;
  if (!hasScore(v.score)) return null;
  const rawCount = typeof v.riskCount === 'number' ? v.riskCount : Number(v.riskCount);
  return {
    score: clampScore(v.score),
    verdict: line(v.verdict, 20),
    riskLevel: asRiskLevel(v.riskLevel),
    riskCount: Number.isFinite(rawCount) ? Math.max(0, Math.round(rawCount)) : 0,
  };
}
