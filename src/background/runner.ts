/**
 * Prompt 执行器（Task 5）：门控 → 简历 → 缓存 → 流式请求 → JSON 重试 → 证据校验 → 历史落库。
 *
 * 隐私与门控落点：
 * 1. assertOriginAllowed：仅向用户已授权的域名发请求（未授权直接 NO_PERMISSION）；
 * 2. if (!settings.key)：未配置 Key 时不发任何请求（NO_KEY）；
 * 3. 文本简历只使用脱敏文本（loadResumeContext 保证），content 落库的也是脱敏文本。
 */
import { PROMPT_VERSION } from '../prompts';
import { JSON_RETRY_SUFFIX, getPrompt } from '../prompts';
import { AppError } from '../shared/errors';
import { addAnalysis } from '../shared/idb';
import { logError, logWarn } from '../shared/log';
import { makeRequestId } from '../shared/protocol';
import type { LLMPayload } from '../shared/protocol';
import type {
  AnalysisRecord,
  ApiSettings,
  ChatContext,
  EvidenceSrc,
  HistoryKind,
  JobInfo,
  LLMTask,
  RiskItem,
} from '../shared/types';
import { isPlainObject, validateEvidence } from '../shared/validate';
import { readCache, writeCache } from './cache';
import { createClient } from './llm';
import type { LLMClient, LLMMessage, LLMRequestBody } from './llm';
import { assertOriginAllowed } from './permissions';
import { loadResumeContext } from './resume';
import type { ResumeContext } from './resume';

/** 需要简历输入的任务（避免其它任务无谓读取 IndexedDB）。 */
const RESUME_TASKS: LLMTask[] = ['match', 'greeting', 'interview', 'chatReply'];

/** 任务 → 历史记录类型。 */
const KIND_MAP: Record<LLMTask, HistoryKind> = {
  jobAnalysis: 'analysis',
  match: 'match',
  greeting: 'greeting',
  chatReply: 'chat',
  chatRisk: 'chat',
  company: 'company',
  interview: 'interview',
  quickReview: 'quickReview',
};

/** 执行器入参。 */
export interface RunnerOptions {
  task: LLMTask;
  payload: LLMPayload;
  settings: ApiSettings;
  signal: AbortSignal;
  onDelta?: (t: string) => void;
  /** 为 true 时跳过缓存读取（「重新生成」场景，可选扩展字段）。 */
  force?: boolean;
}

/** 执行结果。 */
export interface RunnerResult {
  text: string;
  value: unknown;
  dropped: number;
  model: string;
  fromCache: boolean;
}

/** 取 payload 中的岗位信息。 */
function jobOf(payload: LLMPayload): JobInfo | null {
  const job = (payload as { job?: unknown }).job;
  return job && typeof job === 'object' ? (job as JobInfo) : null;
}

/** 取 payload 中的会话上下文（chat 任务）。 */
function contextOf(payload: LLMPayload): ChatContext | null {
  const ctx = (payload as { context?: unknown }).context;
  return ctx && typeof ctx === 'object' ? (ctx as ChatContext) : null;
}

/** 一次性收集流式输出（重试时使用非流式请求）。 */
async function collect(
  client: LLMClient,
  body: LLMRequestBody,
  signal: AbortSignal,
): Promise<string> {
  let out = '';
  for await (const chunk of client.chat(body, signal)) out += chunk;
  return out;
}

/** 对结果里的 red / risks 做证据子串校验，并把校验后的数组真正写回。 */
function validateRiskArrays(
  value: Record<string, unknown>,
  pools: Partial<Record<EvidenceSrc, string>>,
): { value: Record<string, unknown>; dropped: number } {
  const out: Record<string, unknown> = { ...value };
  let dropped = 0;
  for (const key of ['red', 'risks']) {
    const arr = out[key];
    if (!Array.isArray(arr)) continue;
    const { ok, drop } = validateEvidence(arr as RiskItem[], (item) => pools[item?.src] ?? '');
    dropped += drop.length;
    out[key] = ok;
  }
  return { value: out, dropped };
}

/** 风险条数：优先取校验后的 red / risks 数组长度，其次取 riskCount 字段。 */
function riskCountOf(value: unknown): number {
  if (!isPlainObject(value)) return 0;
  if (Array.isArray(value.red)) return value.red.length;
  if (Array.isArray(value.risks)) return value.risks.length;
  if (typeof value.riskCount === 'number') return value.riskCount;
  return 0;
}

/** 匹配度 / 快评分数；其它任务为 null。 */
function scoreOf(task: LLMTask, value: unknown): number | null {
  if ((task === 'match' || task === 'quickReview') && isPlainObject(value)) {
    const score = value.score;
    return typeof score === 'number' && Number.isFinite(score) ? score : null;
  }
  return null;
}

/** 写分析历史（失败不影响本次结果返回）。 */
async function saveHistory(
  task: LLMTask,
  payload: LLMPayload,
  model: string,
  value: unknown,
  content: string,
): Promise<void> {
  const job = jobOf(payload);
  const ctx = job ? null : contextOf(payload);
  const rec: AnalysisRecord = {
    id: makeRequestId(),
    at: Date.now(),
    kind: KIND_MAP[task],
    jobId: job?.id ?? ctx?.jobId ?? '',
    jobTitle: job?.title ?? ctx?.jobTitle ?? '',
    company: job?.company ?? ctx?.company ?? '',
    model,
    score: scoreOf(task, value),
    riskCount: riskCountOf(value),
    content,
  };
  try {
    await addAnalysis(rec);
  } catch (e) {
    void logError('写入分析历史失败', {
      task,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

/** 执行一次带 LLM 的任务。 */
export async function runTaskWithLLM(o: RunnerOptions): Promise<RunnerResult> {
  const { task, settings, signal } = o;

  await assertOriginAllowed(settings.baseUrl);
  if (!settings.key) throw new AppError('NO_KEY');

  const def = getPrompt(task);
  const isJson = def.output === 'json';

  // 仅需要简历的任务才读取简历
  const resumeCtx: ResumeContext | null = RESUME_TASKS.includes(task)
    ? await loadResumeContext()
    : null;
  const payload: LLMPayload =
    resumeCtx && resumeCtx.kind === 'text' && resumeCtx.text
      ? ({ ...o.payload, resumeText: resumeCtx.text } as unknown as LLMPayload)
      : o.payload;

  const job = jobOf(payload);
  const model = settings.model;
  const resumeVersion = resumeCtx?.version ?? 0;

  // 缓存：仅 json 任务且带 job 时启用
  if (isJson && job && !o.force) {
    const cached = await readCache<unknown>(task, job, resumeVersion, model);
    if (cached != null) {
      const text = typeof cached === 'string' ? cached : JSON.stringify(cached);
      return { text, value: cached, dropped: 0, model, fromCache: true };
    }
  }

  const client = createClient(settings);
  const attachment = resumeCtx?.attachment ?? null;
  // 服务商不支持 PDF 时必须在发起请求前直接拒绝
  if (attachment && client.capabilities().pdf === 'none') {
    throw new AppError('UNSUPPORTED_ATTACHMENT');
  }

  const messages: LLMMessage[] = [
    { role: 'system', content: def.system },
    { role: 'user', content: def.buildUser(payload) },
  ];
  const baseBody: LLMRequestBody = {
    messages,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    stream: settings.stream,
  };
  if (attachment) baseBody.attachment = attachment;

  let full = '';
  for await (const chunk of client.chat(baseBody, signal)) {
    full += chunk;
    if (chunk) o.onDelta?.(chunk);
  }

  let value: unknown;
  if (isJson) {
    let parsed = def.parseResult(full);
    if (!parsed.ok) {
      // 追加约束消息后重试一次（不流式，onDelta 不再回调）
      const retryMessages: LLMMessage[] = [
        ...messages,
        { role: 'user', content: JSON_RETRY_SUFFIX },
      ];
      const retryText = await collect(client, { ...baseBody, stream: false, messages: retryMessages }, signal);
      parsed = def.parseResult(retryText);
      if (!parsed.ok) {
        void logWarn('模型输出无法解析为 JSON', { task, promptVersion: PROMPT_VERSION });
        throw new AppError('BAD_JSON', undefined, parsed.reason);
      }
      full = retryText;
    }
    value = parsed.value;
  } else {
    value = full.trim();
  }

  // 证据子串校验（必须写回 value）
  let dropped = 0;
  if (def.evidencePools && isPlainObject(value)) {
    const validated = validateRiskArrays(value, def.evidencePools(payload));
    value = validated.value;
    dropped = validated.dropped;
    if (dropped > 0) {
      void logWarn('丢弃无法在原文定位的风险条目', { dropped });
    }
  }

  await saveHistory(task, payload, model, value, full);

  if (isJson && job) {
    await writeCache(task, job, resumeVersion, model, value);
  }

  return {
    text: isJson ? full : String(value),
    value,
    dropped,
    model,
    fromCache: false,
  };
}
