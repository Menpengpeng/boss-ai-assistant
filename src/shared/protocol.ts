/**
 * Content / Options ↔ Background 的消息协议。
 * - 一次性请求：chrome.runtime.sendMessage(BgRequest) → BgResponse
 * - 流式请求：chrome.runtime.connect({ name: BG_PORT_NAME }) + StreamClientMsg / StreamServerMsg
 * 所有请求统一携带 payload 字段（判别联合），不散落顶层字段。
 */
import type { ErrorCode } from './errors';
import type {
  AnalysisRecord,
  AppSettings,
  ChatContext,
  DeepPartial,
  JobInfo,
  LLMTask,
} from './types';

/** 流式 Port 的名称。 */
export const BG_PORT_NAME = 'boss-ai-llm';

/** Background → Content：二次查询当前标签页登录态（F0 门控，见 background/auth.ts）。 */
export const AUTH_QUERY = 'ba:auth-query';

// ---------------------------------------------------------------------------
// 各类任务的具体 payload
// ---------------------------------------------------------------------------

export interface JobPayload {
  job: JobInfo;
  manualJd?: string;
}

export interface MatchPayload {
  job: JobInfo;
  manualJd?: string;
}

export interface GreetingPayload {
  job: JobInfo;
  manualJd?: string;
}

export interface ChatPayload {
  context: ChatContext;
}

export interface CompanyPayload {
  job: JobInfo;
  extraText?: string;
}

export interface InterviewPayload {
  job: JobInfo;
  manualJd?: string;
}

export interface QuickReviewPayload {
  job: JobInfo;
}

/** 所有任务 payload 的联合类型。 */
export type LLMPayload =
  | JobPayload
  | MatchPayload
  | GreetingPayload
  | ChatPayload
  | CompanyPayload
  | InterviewPayload
  | QuickReviewPayload;

// ---------------------------------------------------------------------------
// 流式协议
// ---------------------------------------------------------------------------

/** 客户端 → Background：开始一次流式请求。 */
export interface StreamStart {
  type: 'start';
  requestId: string;
  task: LLMTask;
  payload: LLMPayload;
  /** 为 true 时跳过缓存（「重新生成」用）。 */
  force?: boolean;
}

/** 客户端 → Background：中止指定请求。 */
export interface StreamAbort {
  type: 'abort';
  requestId: string;
}

export type StreamClientMsg = StreamStart | StreamAbort;

export type StreamServerMsg =
  | { type: 'delta'; requestId: string; text: string }
  | { type: 'done'; requestId: string; text: string }
  | { type: 'error'; requestId: string; code: ErrorCode; message: string };

// ---------------------------------------------------------------------------
// 一次性请求
// ---------------------------------------------------------------------------

/** 空 payload 占位类型。 */
export type EmptyPayload = Record<string, never>;

export type BgRequest =
  | { type: 'settings:get'; payload: EmptyPayload }
  | { type: 'settings:set'; payload: { patch: DeepPartial<AppSettings> } }
  | { type: 'llm:test'; payload: EmptyPayload }
  | { type: 'ui:openOptions'; payload: { hash?: string } }
  | { type: 'auth:check'; payload: EmptyPayload }
  | { type: 'perm:ensure'; payload: { baseUrl?: string } }
  | { type: 'cache:get'; payload: { key: string } }
  | { type: 'cache:set'; payload: { key: string; value: unknown } }
  | { type: 'cache:clear'; payload: EmptyPayload }
  | { type: 'history:list'; payload: { limit?: number } }
  | { type: 'history:add'; payload: { record: AnalysisRecord } }
  | { type: 'history:clear'; payload: EmptyPayload }
  | { type: 'resume:snapshot'; payload: EmptyPayload }
  | { type: 'data:clearAll'; payload: EmptyPayload }
  | { type: 'logs:list'; payload: EmptyPayload }
  | { type: 'logs:clear'; payload: EmptyPayload };

/** 一次性请求的 type 取值集合。 */
export type BgRequestType = BgRequest['type'];

/** 统一响应信封。 */
export type BgResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string } };

/** 生成请求 ID（无依赖、同步）。 */
export function makeRequestId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `rq_${Date.now().toString(36)}_${rand}`;
}

/** 轻量守卫：判断任意值是否为合法 BgResponse。 */
export function isBgResponse(v: unknown): v is BgResponse {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  if (obj.ok === true) return 'data' in obj;
  if (obj.ok === false) {
    const err = obj.error;
    if (!err || typeof err !== 'object') return false;
    const e = err as Record<string, unknown>;
    return typeof e.code === 'string' && typeof e.message === 'string';
  }
  return false;
}
