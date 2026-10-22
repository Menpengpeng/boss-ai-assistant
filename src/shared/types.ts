/**
 * 共享类型契约层：后续各任务（解析器 / 适配器 / Prompt / UI）统一从这里引用类型。
 * 本文件只包含类型声明，编译后被完全擦除，不含任何运行时代码。
 * 约定：所有文件必须保持 UTF-8 with BOM，注释使用中文。
 */

/** 登录态：仅由页面 DOM 推断。 */
export type AuthState = 'logged_in' | 'logged_out' | 'unknown';

/** 风险等级：必须同时用文字展示，不能只靠颜色区分。 */
export type RiskLevel = '高' | '中' | '低';

/** 风险条目的原文依据来源。 */
export type EvidenceSrc = 'JD' | '薪资' | '标签' | '聊天';

/** 需要调用模型的八类任务。 */
export type LLMTask =
  | 'jobAnalysis'
  | 'match'
  | 'greeting'
  | 'chatReply'
  | 'chatRisk'
  | 'company'
  | 'interview'
  | 'quickReview';

/** 页面类型。 */
export type PageKind = 'jobDetail' | 'jobList' | 'chat' | 'other';

/** 岗位信息（详情页解析结果 / 手动粘贴时构造）。 */
export interface JobInfo {
  id: string;
  title: string;
  company: string;
  salary: string;
  city: string;
  experience: string;
  education: string;
  tags: string[];
  jd: string[];
  hrName: string;
  url: string;
  source: 'detail' | 'list' | 'manual';
}

/** 列表页卡片（轻量）。 */
export interface JobCard {
  id: string;
  index: number;
  title: string;
  company: string;
  salary: string;
  tags: string[];
  url: string;
}

/** 聊天消息（仅区分 HR 与本人）。 */
export interface ChatMessage {
  role: 'hr' | 'me';
  text: string;
  time: string;
}

/** 当前会话上下文。 */
export interface ChatContext {
  jobId: string;
  jobTitle: string;
  company: string;
  hrName: string;
  messages: ChatMessage[];
}

/** 风险信号条目：evidence 必须是原文子串。 */
export interface RiskItem {
  level: RiskLevel;
  type: string;
  conclusion: string;
  evidence: string;
  src: EvidenceSrc;
}

/** 岗位分析结果（F3）。 */
export interface JobAnalysis {
  summary: string;
  duties: string[];
  skills: string[];
  nice: string[];
  red: RiskItem[];
  strengths: string[];
  gaps: string[];
  advice: string[];
}

/** 匹配度结果（F4）。 */
export interface MatchResult {
  score: number;
  strengths: string[];
  gaps: string[];
  advice: string[];
}

/** 一条回复建议（F6）。 */
export interface ReplySuggestion {
  style: string;
  text: string;
}

/** 对话洞察结果（F6 + F8）。 */
export interface ChatInsight {
  intent: string;
  stage: string;
  pending: string;
  replies: ReplySuggestion[];
  risks: RiskItem[];
}

/** 公司分析要点（F10）。 */
export interface CompanyPoint {
  label: string;
  value: string;
}

/** 公司分析结果（F10）。 */
export interface CompanyResult {
  points: CompanyPoint[];
  risks: RiskItem[];
  note: string;
}

/** 面试题（F11）。 */
export interface InterviewQuestion {
  q: string;
  idea: string;
}

/** 面试题预测结果（F11）。 */
export interface InterviewResult {
  questions: InterviewQuestion[];
}

/** 列表快评结果（F7）。 */
export interface QuickReview {
  score: number;
  verdict: string;
  riskLevel: RiskLevel;
  riskCount: number;
}

// 简历

/** 简历来源类型。 */
export type ResumeKind = 'pdf' | 'text';

/** 简历元信息（不含正文/文件，用于列表展示）。 */
export interface ResumeMeta {
  kind: ResumeKind;
  name: string;
  version: number;
  updatedAt: number;
  size: number;
  sha256: string;
  maskName: boolean;
}

/** 简历完整记录（含 Blob 或文本）。 */
export interface ResumeRecord extends ResumeMeta {
  blob?: Blob;
  rawText?: string;
  maskedText?: string;
  map?: Record<string, string>;
}

/** 发送给模型时使用的简历快照。 */
export interface ResumeSnapshot {
  version: number;
  kind: ResumeKind;
  name: string;
  maskName: boolean;
  text?: string;
  blob?: Blob;
}

// 附件

/** PDF 原生附件（转 base64 后随请求发送）。 */
export interface PdfAttachment {
  kind: 'pdf';
  mime: 'application/pdf';
  base64: string;
  size: number;
  sha256: string;
  filename: string;
}

// 配置

/** API 配置（Key 仅存本地）。 */
export interface ApiSettings {
  provider: string;
  baseUrl: string;
  key: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutSec: number;
  stream: boolean;
  maskPhone: boolean;
  verified: boolean;
  verifiedAt: number;
}

/** 应用整体配置。 */
export interface AppSettings {
  api: ApiSettings;
  chatConsent: boolean;
  activeResumeVersion: number;
  theme: 'auto' | 'light' | 'dark';
}

/** 历史记录类型。 */
export type HistoryKind =
  | 'analysis'
  | 'match'
  | 'greeting'
  | 'company'
  | 'interview'
  | 'quickReview'
  | 'chat';

/** 一条历史记录（F12）。 */
export interface AnalysisRecord {
  id: string;
  at: number;
  kind: HistoryKind;
  jobId: string;
  jobTitle: string;
  company: string;
  model: string;
  score: number | null;
  riskCount: number;
  content: string;
}

/** 本地日志条目。 */
export interface LogEntry {
  at: number;
  level: 'info' | 'warn' | 'error';
  msg: string;
}

/** 对比表条目（F9）。 */
export interface CompareItem {
  jobId: string;
  job: JobInfo;
  score: number | null;
  red: RiskItem[];
  addedAt: number;
}

/** 收藏条目（F9）。 */
export interface FavoriteItem {
  jobId: string;
  job: JobInfo;
  at: number;
}

/** 服务商预设（F1）。 */
export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  kind: 'openai' | 'anthropic';
  pdf: 'native' | 'none';
}

/**
 * 递归可选类型：用于 setSettings 的局部更新。
 * 归属说明：定义在 types.ts（纯类型，编译期擦除，任何层 import 都不会带来运行时代码）。
 */
export type DeepPartial<T> = T extends (infer U)[]
  ? DeepPartial<U>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;
