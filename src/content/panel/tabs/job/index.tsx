/**
 * 职位页标签组（F3 岗位分析 / F4 匹配度 / F5 打招呼语 / F11 面试题 / F10 公司）
 * 与底部固定操作栏（Task 8.1–8.6）。
 *
 * 契约与红线：
 * 1. 本文件只导出 jobStyles / JobPanel / JobFooter（路径与导出名为固定契约，不得变更）；
 * 2. 一级标签栏由 App.tsx 渲染，本文件不再渲染 Tabs；
 * 3. 所有模型请求必须由用户点击触发，绝不自动请求；
 * 4. 生成结果统一写入 state.slots（切标签不丢数据），仅纯 UI 态使用局部 state；
 * 5. 风险条目的 evidence 必须能在页面原文中定位，否则丢弃并提示丢弃条数；
 * 6. 公司结论固定标注「基于页面信息，非权威核实」，用户粘贴的外部文本不作为原文依据。
 */
import { useState } from 'react';
import { LIMITS } from '../../../../shared/constants';
import { AppError, ERROR_TIPS } from '../../../../shared/errors';
import type { ErrorAction } from '../../../../shared/errors';
import type { LLMPayload } from '../../../../shared/protocol';
import type {
  CompanyResult,
  InterviewResult,
  JobAnalysis,
  JobInfo,
  LLMTask,
  MatchResult,
  RiskItem,
} from '../../../../shared/types';
import { clampScore, extractJson, pageTextFor, validateEvidence } from '../../../../shared/validate';
import {
  COMPANY_NOTE,
  guardCompany,
  guardInterview,
  guardJobAnalysis,
  guardMatch,
} from '../../../../prompts/guards';
import { buildManualJob } from '../../../parsers';
import type { CompanyPageInfo } from '../../../parsers';
import { STATE_COPY } from '../../App';
import {
  Button,
  CopyButton,
  EmptyState,
  ErrorCard,
  KeyValue,
  RiskList,
  ScoreRing,
  Skeleton,
  TagList,
  scoreTone,
  toneVar,
} from '../../components';
import { runTask } from '../../llm-client';
import { ICONS } from '../../styles';
import { COMPARE_FULL_REASON, actions } from '../../store';
import type { PanelHost, PanelState, TabProps, TaskKey } from '../../types';

/** 该标签组的增量样式（注入 Shadow DOM），只补 baseStyles 未覆盖的规则。 */
export const jobStyles = `
/* —— 职位页标签组（F3/F4/F5/F10/F11） —— */
.ba-actions{display:flex;gap:8px;flex-wrap:wrap}
.ba-row-between{display:flex;align-items:center;justify-content:space-between;gap:8px}
.ba-ul{margin:0;padding-left:18px;line-height:1.9;font-size:var(--fs-13);word-break:break-word}
.ba-ring-wrap{display:flex;align-items:center;gap:16px}
.ba-score-lg{font-size:var(--fs-20);font-weight:700}
.ba-score-none{font-size:var(--fs-28);font-weight:700;color:var(--ink2);line-height:1}
.ba-stream{margin:0;white-space:pre-wrap;word-break:break-word;font-family:inherit;font-size:var(--fs-14);line-height:1.8;background:var(--surface2);border-radius:var(--r-btn);padding:10px 12px;min-height:78px}
.ba-count{font-size:var(--fs-12);color:var(--ink2)}
.ba-count.over{color:var(--err);font-weight:600}
.ba-intro{font-size:var(--fs-13);line-height:20px;color:var(--ink2);word-break:break-word}
.ba-qa{border:1px solid var(--line);border-radius:var(--r-card);padding:10px 12px;background:var(--surface);display:flex;flex-direction:column;gap:6px}
.ba-qa-q{font-size:var(--fs-14);font-weight:600;line-height:20px;word-break:break-word}
.ba-qa-a{background:var(--surface2);border-radius:var(--r-tag);padding:6px 10px;font-size:var(--fs-12);line-height:18px;color:var(--ink2);word-break:break-word}
`;

/** 各子标签对应的任务槽位（与 App 的 jobTab 一一对应）。 */
type JobTaskKey = Extract<TaskKey, 'analysis' | 'match' | 'greeting' | 'interview' | 'company'>;

/** 子区块收到的统一 props。 */
interface SectionProps {
  state: PanelState;
  host: PanelHost | null;
  job: JobInfo;
  manualJd: string;
  onPaste: () => void;
}

// ---------------------------------------------------------------------------
// 纯函数：评分 / 文案 / 文本导出 / 错误动作映射（可单测）
// ---------------------------------------------------------------------------

/** 评分分档文案（必须与数字同时展示，不能只靠颜色）。 */
export function matchLabel(score: number): string {
  const tone = scoreTone(score);
  if (tone === 'ok') return '匹配度较高';
  if (tone === 'warn') return '匹配度一般';
  return '匹配度偏低';
}

/** 取当前岗位的评分：优先对比表里的分数，其次匹配度结果；都没有返回 null。 */
export function pickScore(state: PanelState, job: JobInfo): number | null {
  const fromCompare = state.compare.find((it) => it.jobId === job.id)?.score;
  if (typeof fromCompare === 'number') return clampScore(fromCompare);
  const slot = state.slots.match;
  const match = slot.status === 'success' ? (slot.data as MatchResult | null) : null;
  if (match && typeof match.score === 'number') return clampScore(match.score);
  return null;
}

/** 取通过证据子串校验的风险条目（供「加入对比」使用）。 */
function analysisRed(state: PanelState): RiskItem[] {
  const slot = state.slots.analysis;
  const data = slot.status === 'success' ? (slot.data as JobAnalysis | null) : null;
  return data?.red ?? [];
}

/** 风险条目 → 徽标档位（最高等级）。 */
function riskTone(items: RiskItem[]): 'h' | 'm' | 'l' {
  if (items.some((r) => r.level === '高')) return 'h';
  if (items.some((r) => r.level === '中')) return 'm';
  return 'l';
}

/** 列表 → 纯文本行（空列表返回「未提供」）。 */
function bulletLines(list: string[]): string {
  return list.length ? list.map((s) => `- ${s}`).join('\n') : STATE_COPY.empty;
}

/** 风险条目 → 纯文本行。 */
function riskLines(items: RiskItem[]): string {
  return items.length
    ? items
        .map((r) => `- [${r.level}] ${r.type}：${r.conclusion}（依据：${r.evidence}／来源：${r.src}）`)
        .join('\n')
    : STATE_COPY.empty;
}

/** 岗位分析结果的纯文本版（供「复制分析」使用）。 */
export function analysisToText(job: JobInfo, data: JobAnalysis): string {
  const head = `岗位：${job.title || STATE_COPY.empty}｜公司：${job.company || STATE_COPY.empty}｜薪资：${job.salary || STATE_COPY.empty}`;
  return [
    head,
    `一句话概括：${data.summary || STATE_COPY.empty}`,
    `核心职责：\n${bulletLines(data.duties)}`,
    `技能要求：\n${bulletLines(data.skills)}`,
    `加分项：\n${bulletLines(data.nice)}`,
    `风险信号：\n${riskLines(data.red)}`,
  ].join('\n\n');
}

/** 公司分析结果的纯文本版（供「复制分析」使用）。 */
export function companyToText(data: CompanyResult): string {
  const points = data.points.length
    ? data.points.map((p, i) => `${i + 1}. ${p.label ? `${p.label}：` : ''}${p.value}`).join('\n')
    : STATE_COPY.empty;
  return [
    `综合分析要点：\n${points}`,
    `风险提示：\n${riskLines(data.risks)}`,
    data.note || COMPANY_NOTE,
  ].join('\n\n');
}

/** 公司页面信息 → 证据文本池（不含用户粘贴的外部文本）。 */
export function companyPageTextOf(company: CompanyPageInfo | null): string {
  if (!company) return '';
  return [company.name, company.industry, company.size, company.financing, company.intro]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join('\n');
}

/** ERROR_TIPS 的 action → 统一动作（供 ErrorCard.onAction 使用）。 */
export function mapErrorAction(
  action: ErrorAction,
  host: PanelHost | null,
  cbs: { retry: () => void; paste?: () => void },
): void {
  switch (action) {
    case 'opts-api':
    case 'grant':
      host?.openOptions('api');
      return;
    case 'opts-resume':
      host?.openOptions('resume');
      return;
    case 'login':
      host?.requestLogin();
      return;
    case 'retry':
      cbs.retry();
      return;
    case 'paste':
      cbs.paste?.();
      return;
    default:
      return; // 'none'：无需处理
  }
}

// ---------------------------------------------------------------------------
// 任务请求（四态统一由 state.slots 承载）
// ---------------------------------------------------------------------------

/** 统一的流式任务发起与失败写回；finish 抛出的 AppError 会走统一错误态。 */
function startTask(
  key: JobTaskKey,
  task: LLMTask,
  payload: LLMPayload,
  force: boolean,
  finish: (raw: string) => void,
): void {
  actions.setBusy(key);
  actions.setSlot(key, { status: 'loading', data: null, error: null, stream: '', dropped: 0 });
  const handle = runTask<string>(task, payload, {
    force,
    onDelta: (t) => actions.setSlot(key, { stream: actions.getSlot(key).stream + t }),
  });
  handle.done
    .then(finish)
    .catch((e: unknown) => {
      const err = e instanceof AppError ? e : new AppError('UNKNOWN', ERROR_TIPS.UNKNOWN.title);
      if (err.code === 'ABORTED') return; // 用户主动取消：不显示错误
      actions.setSlot(key, {
        status: 'error',
        error: { code: err.code, message: err.message },
        stream: '',
      });
      actions.setBusy(null);
    });
}

/** 岗位分析（F3）：风险条目必须能回溯到页面 JD 原文。 */
export function runAnalysis(job: JobInfo, manualJd: string, force = false): void {
  startTask('analysis', 'jobAnalysis', { job, manualJd: manualJd || undefined }, force, (raw) => {
    const parsed = guardJobAnalysis(extractJson(raw));
    if (!parsed) throw new AppError('BAD_JSON', ERROR_TIPS.BAD_JSON.title);
    const { ok, drop } = validateEvidence(parsed.red, (it) => pageTextFor(job, it.src));
    actions.setSlot('analysis', {
      status: 'success',
      data: { ...parsed, red: ok },
      dropped: drop.length,
      stream: '',
    });
    actions.setBusy(null);
  });
}

/** 匹配度（F4）。 */
export function runMatch(job: JobInfo, manualJd: string, force = false): void {
  startTask('match', 'match', { job, manualJd: manualJd || undefined }, force, (raw) => {
    const parsed = guardMatch(extractJson(raw));
    if (!parsed) throw new AppError('BAD_JSON', ERROR_TIPS.BAD_JSON.title);
    actions.setSlot('match', { status: 'success', data: parsed, dropped: 0, stream: '' });
    actions.setBusy(null);
  });
}

/** 打招呼语（F5）：纯文本任务，不做 JSON 解析。 */
export function runGreeting(job: JobInfo, manualJd: string, force = false): void {
  startTask('greeting', 'greeting', { job, manualJd: manualJd || undefined }, force, (raw) => {
    const text = (raw ?? '').trim();
    if (!text) throw new AppError('BAD_JSON', ERROR_TIPS.BAD_JSON.title);
    actions.setSlot('greeting', { status: 'success', data: text, dropped: 0, stream: '' });
    actions.setBusy(null);
  });
}

/** 面试题（F11）。 */
export function runInterview(job: JobInfo, manualJd: string, force = false): void {
  startTask('interview', 'interview', { job, manualJd: manualJd || undefined }, force, (raw) => {
    const parsed = guardInterview(extractJson(raw));
    if (!parsed) throw new AppError('BAD_JSON', ERROR_TIPS.BAD_JSON.title);
    actions.setSlot('interview', { status: 'success', data: parsed, dropped: 0, stream: '' });
    actions.setBusy(null);
  });
}

/** 公司分析（F10）：证据池只取页面原文（job + 页面公司信息），外部文本不作依据。 */
export function runCompany(
  job: JobInfo,
  extraText: string,
  company: CompanyPageInfo | null,
  force = false,
): void {
  const pageText = companyPageTextOf(company);
  startTask('company', 'company', { job, extraText: extraText.trim() || undefined }, force, (raw) => {
    const parsed = guardCompany(extractJson(raw));
    if (!parsed) throw new AppError('BAD_JSON', ERROR_TIPS.BAD_JSON.title);
    const { ok, drop } = validateEvidence(parsed.risks, (it) =>
      `${pageTextFor(job, it.src)}\n${pageText}`,
    );
    actions.setSlot('company', {
      status: 'success',
      data: { ...parsed, risks: ok },
      dropped: drop.length,
      stream: '',
    });
    actions.setBusy(null);
  });
}

/** 按子标签分发请求（手动粘贴 JD 后需要直接开跑当前标签）。 */
function runJobTab(key: JobTaskKey, job: JobInfo, manualJd: string, force: boolean): void {
  switch (key) {
    case 'match':
      runMatch(job, manualJd, force);
      return;
    case 'greeting':
      runGreeting(job, manualJd, force);
      return;
    case 'interview':
      runInterview(job, manualJd, force);
      return;
    case 'company':
      runCompany(job, '', null, force);
      return;
    case 'analysis':
    default:
      runAnalysis(job, manualJd, force);
  }
}

// ---------------------------------------------------------------------------
// 通用小组件
// ---------------------------------------------------------------------------

/** 主按钮 + 未配置 Key 时的「去配置」入口（主按钮置灰，另行提供去配置按钮）。 */
function ActionButtons(p: {
  label: string;
  icon?: string;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  apiReady: boolean;
  host: PanelHost | null;
}): JSX.Element {
  const disabled = Boolean(p.disabled || p.busy || !p.apiReady);
  return (
    <>
      <Button
        onClick={p.onClick}
        disabled={disabled}
        busy={p.busy}
        title={!p.apiReady ? '尚未配置 API Key' : undefined}
      >
        {p.busy ? null : <span dangerouslySetInnerHTML={{ __html: p.icon ?? ICONS.spark }} />}
        {p.busy ? STATE_COPY.loading : p.label}
      </Button>
      {!p.apiReady ? (
        <Button variant="ghost" onClick={() => p.host?.openOptions('api')}>
          去配置 API Key
        </Button>
      ) : null}
    </>
  );
}

/** 初始态说明（点击前不请求模型）。 */
function IdleHint(): JSX.Element {
  return <div className="ba-sub">{STATE_COPY.idle}</div>;
}

/** 手动粘贴 JD：job 为空或页面解析失败（PARSE_FAIL）时的兜底入口。 */
function PasteCard(p: {
  onSubmit: (text: string) => void;
  onCancel?: () => void;
  apiReady: boolean;
  host: PanelHost | null;
}): JSX.Element {
  const [text, setText] = useState('');
  const ok = text.trim().length > 0;
  return (
    <section className="ba-card">
      <div className="ba-card-title">页面解析失败 · 手动粘贴 JD</div>
      <div className="ba-sub">
        未取到 JD 正文，可手动粘贴后继续分析。已自动降级，不会影响页面本身。
      </div>
      <div className="ba-field">
        <label htmlFor="ba-manual-jd">JD 原文</label>
        <textarea
          id="ba-manual-jd"
          value={text}
          placeholder="粘贴职位描述原文…"
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <div className="ba-actions">
        <Button disabled={!ok || !p.apiReady} onClick={() => p.onSubmit(text)}>
          <span dangerouslySetInnerHTML={{ __html: ICONS.spark }} />
          分析粘贴内容
        </Button>
        {p.onCancel ? (
          <Button variant="ghost" onClick={p.onCancel}>
            取消
          </Button>
        ) : null}
        {!p.apiReady ? (
          <Button variant="ghost" onClick={() => p.host?.openOptions('api')}>
            去配置 API Key
          </Button>
        ) : null}
      </div>
      <div className="ba-hint">
        选择器统一维护在 selectors.ts 规则表，页面改版后更新规则表即可修复。
      </div>
    </section>
  );
}

/** 公司页面信息（F10：仅展示页面已解析到的字段，非权威核实）。 */
function CompanyInfoCard({ company }: { company: CompanyPageInfo | null }): JSX.Element {
  return (
    <section className="ba-card">
      <div className="ba-card-title ba-row-between">
        <span>公司信息（来自页面）</span>
        <span className="ba-badge mute">基于页面信息</span>
      </div>
      {company ? (
        <KeyValue
          items={[
            { k: '公司名称', v: company.name },
            { k: '行业', v: company.industry },
            { k: '规模', v: company.size },
            { k: '融资阶段', v: company.financing },
          ]}
        />
      ) : (
        <div className="ba-sub">未识别到公司信息</div>
      )}
      {company?.intro ? <div className="ba-intro">{company.intro}</div> : null}
      <div className="ba-note">{COMPANY_NOTE}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 五个子区块
// ---------------------------------------------------------------------------

/** F3 岗位分析。 */
function AnalysisSection({ state, host, job, manualJd, onPaste }: SectionProps): JSX.Element {
  const slot = state.slots.analysis;
  const data = slot.status === 'success' ? (slot.data as JobAnalysis | null) : null;
  const busy = slot.status === 'loading';
  const score = pickScore(state, job);
  const run = (force: boolean): void => runAnalysis(job, manualJd, force);
  const onAction = (a: ErrorAction): void =>
    mapErrorAction(a, host, { retry: () => run(true), paste: onPaste });

  return (
    <>
      <section className="ba-card">
        <div className="ba-card-title ba-row-between">
          <span>岗位分析</span>
          <span className={data ? 'ba-badge ai' : 'ba-badge mute'}>
            {data ? '已生成' : '待生成'}
          </span>
        </div>
        {busy ? <Skeleton lines={4} label={STATE_COPY.loading} /> : null}
        {slot.status === 'error' && slot.error ? (
          <ErrorCard code={slot.error.code} message={slot.error.message} onAction={onAction} />
        ) : null}
        {!data && !busy && slot.status !== 'error' ? <IdleHint /> : null}
        {data ? (
          <>
            <div className="ba-ring-wrap">
              {score === null ? (
                <span className="ba-score-none" role="img" aria-label="暂无评分">
                  —
                </span>
              ) : (
                <ScoreRing score={score} label={`评分 ${score} 分`} />
              )}
              <div className="ba-sub">
                {score === null ? '暂无评分（可在「匹配度」标签生成）' : matchLabel(score)}
              </div>
            </div>
            <div className="ba-sub">一句话概括</div>
            <div>{data.summary}</div>
          </>
        ) : null}
        <div className="ba-actions">
          <ActionButtons
            label={data ? '重新生成' : '分析此岗位'}
            icon={data ? ICONS.refresh : ICONS.spark}
            onClick={() => run(Boolean(data))}
            busy={busy}
            apiReady={state.apiReady}
            host={host}
          />
          {data && !busy ? <CopyButton text={analysisToText(job, data)} label="复制分析" /> : null}
        </div>
      </section>

      {data ? (
        <>
          <section className="ba-card">
            <div className="ba-card-title">核心职责</div>
            {data.duties.length ? (
              <ul className="ba-ul">
                {data.duties.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            ) : (
              <div className="ba-sub">{STATE_COPY.empty}</div>
            )}
          </section>

          <section className="ba-card">
            <div className="ba-card-title">技能要求</div>
            <TagList tags={data.skills} />
            <div className="ba-card-title">加分项</div>
            <TagList tags={data.nice} />
          </section>

          <section className="ba-card">
            <div className="ba-card-title ba-row-between">
              <span>风险信号</span>
              <span className={`ba-badge ${riskTone(data.red)}`}>{data.red.length} 项</span>
            </div>
            <RiskList items={data.red} dropped={slot.dropped} />
            <div className="ba-hint">
              证据子串校验：{data.red.length} 条通过
              {slot.dropped > 0 ? `，已丢弃 ${slot.dropped} 条无原文依据的结论` : ''}
              。风险结论仅为提示，不对公司或 HR 作事实认定。
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}

/** F4 匹配度。 */
function MatchSection({ state, host, job, manualJd, onPaste }: SectionProps): JSX.Element {
  const slot = state.slots.match;
  const data = slot.status === 'success' ? (slot.data as MatchResult | null) : null;
  const busy = slot.status === 'loading';
  const run = (force: boolean): void => runMatch(job, manualJd, force);
  const onAction = (a: ErrorAction): void =>
    mapErrorAction(a, host, { retry: () => run(true), paste: onPaste });

  // 未导入简历：只引导，不请求模型
  if (!state.hasResume) {
    return (
      <EmptyState
        title="尚未导入简历"
        body="导入简历后才能计算匹配度，本插件不会自动请求。支持上传 PDF（原文发送）或粘贴文本（发送前脱敏）。"
        actionLabel="去导入简历"
        onAction={() => host?.openOptions('resume')}
      />
    );
  }

  return (
    <>
      <section className="ba-card">
        <div className="ba-card-title ba-row-between">
          <span>简历匹配度</span>
          <span className="ba-sub">简历版本 v{state.resumeVersion}</span>
        </div>
        {busy ? <Skeleton lines={3} label={STATE_COPY.loading} /> : null}
        {slot.status === 'error' && slot.error ? (
          <ErrorCard code={slot.error.code} message={slot.error.message} onAction={onAction} />
        ) : null}
        {!data && !busy && slot.status !== 'error' ? <IdleHint /> : null}
        {data ? (
          <div className="ba-ring-wrap">
            <ScoreRing score={data.score} label={`匹配度 ${data.score} 分`} />
            <div>
              <div className="ba-score-lg" style={{ color: toneVar(data.score) }}>
                {data.score} 分
              </div>
              <div className="ba-sub">{matchLabel(data.score)}</div>
            </div>
          </div>
        ) : null}
        <div className="ba-actions">
          <ActionButtons
            label={data ? '重新计算' : '计算匹配度'}
            icon={data ? ICONS.refresh : ICONS.spark}
            onClick={() => run(Boolean(data))}
            busy={busy}
            apiReady={state.apiReady}
            host={host}
          />
        </div>
      </section>

      {data ? (
        <>
          <section className="ba-card">
            <div className="ba-card-title">优势</div>
            <TagList tags={data.strengths} />
          </section>
          <section className="ba-card">
            <div className="ba-card-title">缺失技能</div>
            <TagList tags={data.gaps} />
          </section>
          <section className="ba-card">
            <div className="ba-card-title">建议补充点</div>
            {data.advice.length ? (
              <ul className="ba-ul">
                {data.advice.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            ) : (
              <div className="ba-sub">{STATE_COPY.empty}</div>
            )}
          </section>
        </>
      ) : null}
    </>
  );
}

/** F5 打招呼语（流式输出 + 字数统计）。 */
function GreetingSection({ state, host, job, manualJd, onPaste }: SectionProps): JSX.Element {
  const slot = state.slots.greeting;
  const done = slot.status === 'success' && typeof slot.data === 'string' ? slot.data : '';
  const busy = slot.status === 'loading';
  const shown = busy ? slot.stream : done;
  const over = shown.length > LIMITS.maxReplyChars;
  const run = (force: boolean): void => runGreeting(job, manualJd, force);
  const onAction = (a: ErrorAction): void =>
    mapErrorAction(a, host, { retry: () => run(true), paste: onPaste });

  return (
    <section className="ba-card">
      <div className="ba-card-title ba-row-between">
        <span>个性化打招呼语</span>
        <span className={busy ? 'ba-badge m' : done ? 'ba-badge ai' : 'ba-badge mute'}>
          {busy ? '生成中' : done ? '已生成' : '待生成'}
        </span>
      </div>
      {slot.status === 'error' && slot.error ? (
        <ErrorCard code={slot.error.code} message={slot.error.message} onAction={onAction} />
      ) : null}
      {!shown && !busy && slot.status !== 'error' ? <IdleHint /> : null}
      {shown ? (
        <pre className="ba-stream" aria-label="打招呼语内容">
          {shown}
        </pre>
      ) : null}
      {shown ? (
        <div className="ba-row-between">
          <span className={`ba-count${over ? ' over' : ''}`}>
            {shown.length} 字
            {over
              ? `（超出 ${LIMITS.maxReplyChars} 字上限，请重新生成）`
              : ` / ${LIMITS.maxReplyChars} 字`}
          </span>
          <span className="ba-hint">由你手动复制发送，插件不会代发</span>
        </div>
      ) : null}
      <div className="ba-actions">
        <ActionButtons
          label={done ? '重新生成' : '生成打招呼语'}
          icon={done ? ICONS.refresh : ICONS.spark}
          onClick={() => run(Boolean(done))}
          busy={busy}
          apiReady={state.apiReady}
          host={host}
        />
        {shown && !busy ? <CopyButton text={shown} label="复制" /> : null}
      </div>
      <div className="ba-hint">
        不编造简历中没有的经历；每条不超过 {LIMITS.maxReplyChars} 字，超出时会提示压缩。
      </div>
    </section>
  );
}

/** F11 面试题。 */
function InterviewSection({ state, host, job, manualJd, onPaste }: SectionProps): JSX.Element {
  const slot = state.slots.interview;
  const data = slot.status === 'success' ? (slot.data as InterviewResult | null) : null;
  const busy = slot.status === 'loading';
  const questions = data?.questions ?? [];
  const countHint =
    questions.length === 0
      ? '未生成面试题，请重新生成。'
      : questions.length < 5
        ? `题量不足 5 题（当前 ${questions.length} 题），可重新生成补充。`
        : questions.length > 8
          ? '题量超过 8 题，已截断展示前 8 题。'
          : '';
  const run = (force: boolean): void => runInterview(job, manualJd, force);
  const onAction = (a: ErrorAction): void =>
    mapErrorAction(a, host, { retry: () => run(true), paste: onPaste });

  return (
    <>
      <section className="ba-card">
        <div className="ba-card-title ba-row-between">
          <span>预测面试题</span>
          <span className={data ? 'ba-badge ai' : 'ba-badge mute'}>
            {data ? `${questions.length} 题` : '待生成'}
          </span>
        </div>
        {busy ? <Skeleton lines={3} label={STATE_COPY.loading} /> : null}
        {slot.status === 'error' && slot.error ? (
          <ErrorCard code={slot.error.code} message={slot.error.message} onAction={onAction} />
        ) : null}
        {!data && !busy && slot.status !== 'error' ? <IdleHint /> : null}
        {data && countHint ? <div className="ba-hint">{countHint}</div> : null}
        <div className="ba-actions">
          <ActionButtons
            label={data ? '重新生成' : '预测面试题'}
            icon={data ? ICONS.refresh : ICONS.spark}
            onClick={() => run(Boolean(data))}
            busy={busy}
            apiReady={state.apiReady}
            host={host}
          />
        </div>
        <div className="ba-hint">按 JD 与简历生成 5–8 题；回答思路仅作提示，请结合真实经历准备。</div>
      </section>

      {questions.map((q, i) => (
        <section className="ba-qa" key={i}>
          <div className="ba-qa-q">
            {i + 1}. {q.q}
          </div>
          <div className="ba-qa-a">回答思路：{q.idea || STATE_COPY.empty}</div>
        </section>
      ))}
    </>
  );
}

/** F10 公司分析（页面信息 + 可选外部文本）。 */
function CompanySection({ state, host, job, onPaste }: Omit<SectionProps, 'manualJd'>): JSX.Element {
  const [extra, setExtra] = useState('');
  const slot = state.slots.company;
  const data = slot.status === 'success' ? (slot.data as CompanyResult | null) : null;
  const busy = slot.status === 'loading';
  const run = (force: boolean): void => runCompany(job, extra, state.company, force);
  const onAction = (a: ErrorAction): void =>
    mapErrorAction(a, host, { retry: () => run(true), paste: onPaste });

  return (
    <>
      <CompanyInfoCard company={state.company} />

      <section className="ba-card">
        <div className="ba-card-title">合并分析</div>
        <div className="ba-field">
          <label htmlFor="ba-company-extra">粘贴外部文本合并分析（可选）</label>
          <textarea
            id="ba-company-extra"
            value={extra}
            placeholder="例如：财报摘要、新闻稿、行业报告片段"
            onChange={(e) => setExtra(e.target.value)}
          />
        </div>
        <div className="ba-sub">
          未提供外部文本时，仅基于页面信息分析；外部文本不作为风险条目的原文依据。
        </div>
        {busy ? <Skeleton lines={3} label={STATE_COPY.loading} /> : null}
        {slot.status === 'error' && slot.error ? (
          <ErrorCard code={slot.error.code} message={slot.error.message} onAction={onAction} />
        ) : null}
        {!data && !busy && slot.status !== 'error' ? <IdleHint /> : null}
        <div className="ba-actions">
          <ActionButtons
            label={data ? '重新合并分析' : '合并分析'}
            icon={data ? ICONS.refresh : ICONS.spark}
            onClick={() => run(Boolean(data))}
            busy={busy}
            apiReady={state.apiReady}
            host={host}
          />
          {data && !busy ? <CopyButton text={companyToText(data)} label="复制分析" /> : null}
        </div>
      </section>

      {data ? (
        <>
          <section className="ba-card">
            <div className="ba-card-title">综合分析要点</div>
            {data.points.length ? (
              <ol className="ba-ul">
                {data.points.map((p, i) => (
                  <li key={i}>
                    {p.label ? `${p.label}：` : ''}
                    {p.value}
                  </li>
                ))}
              </ol>
            ) : (
              <div className="ba-sub">{STATE_COPY.empty}</div>
            )}
          </section>
          <section className="ba-card">
            <div className="ba-card-title ba-row-between">
              <span>风险提示</span>
              <span className={`ba-badge ${riskTone(data.risks)}`}>{data.risks.length} 项</span>
            </div>
            <RiskList items={data.risks} dropped={slot.dropped} emptyText="未发现明显风险信号" />
          </section>
          <div className="ba-note">{data.note || COMPANY_NOTE}</div>
        </>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// 标签组
// ---------------------------------------------------------------------------

/** 职位页主体内容（一级标签栏由 App 渲染）。 */
export function JobPanel({ state, host }: TabProps): JSX.Element {
  const [manualJd, setManualJd] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const job = state.job;

  // 门控红线：未登录时不渲染任何会触发请求的按钮
  if (state.auth !== 'logged_in') {
    return (
      <section className="ba-card">
        <div className="ba-card-title">请先登录 BOSS直聘</div>
        <div className="ba-sub">未登录时不解析页面内容，也不发出任何模型请求。</div>
        <Button variant="ghost" onClick={() => host?.requestLogin()}>
          去登录
        </Button>
      </section>
    );
  }

  /** 手动粘贴 JD：构造 manual job（保留已解析字段）并让其它标签也能复用。 */
  const applyManual = (text: string): void => {
    const t = text.trim();
    if (!t) {
      actions.toast('请先粘贴 JD 内容');
      return;
    }
    const base = job
      ? {
          url: location.href,
          title: job.title,
          company: job.company,
          salary: job.salary,
          city: job.city,
          experience: job.experience,
          education: job.education,
          tags: job.tags,
          hrName: job.hrName,
        }
      : { url: location.href };
    const manualJob = buildManualJob(t, base);
    setManualJd(t);
    setPasteOpen(false);
    actions.setState({ job: manualJob });
    runJobTab(state.jobTab, manualJob, t, false);
  };

  const openPaste = (): void => setPasteOpen(true);
  const cancelPaste = job ? (): void => setPasteOpen(false) : undefined;

  if (state.jobTab === 'company') {
    if (!job || pasteOpen) {
      return (
        <>
          <PasteCard
            onSubmit={applyManual}
            onCancel={cancelPaste}
            apiReady={state.apiReady}
            host={host}
          />
          {state.company ? <CompanyInfoCard company={state.company} /> : null}
        </>
      );
    }
    return <CompanySection state={state} host={host} job={job} onPaste={openPaste} />;
  }

  if (!job || pasteOpen) {
    return (
      <PasteCard
        onSubmit={applyManual}
        onCancel={cancelPaste}
        apiReady={state.apiReady}
        host={host}
      />
    );
  }

  switch (state.jobTab) {
    case 'match':
      return (
        <MatchSection state={state} host={host} job={job} manualJd={manualJd} onPaste={openPaste} />
      );
    case 'greeting':
      return (
        <GreetingSection
          state={state}
          host={host}
          job={job}
          manualJd={manualJd}
          onPaste={openPaste}
        />
      );
    case 'interview':
      return (
        <InterviewSection
          state={state}
          host={host}
          job={job}
          manualJd={manualJd}
          onPaste={openPaste}
        />
      );
    case 'analysis':
    default:
      return (
        <AnalysisSection
          state={state}
          host={host}
          job={job}
          manualJd={manualJd}
          onPaste={openPaste}
        />
      );
  }
}

/** 职位页底部固定操作栏（容器由 App 渲染，这里只返回按钮）。 */
export function JobFooter({ state, host }: TabProps): JSX.Element | null {
  // 门控保护：未登录时不渲染任何会触发请求的按钮
  if (state.auth !== 'logged_in') return null;

  const job = state.job;
  const inCompare = job !== null && state.compare.some((it) => it.jobId === job.id);

  const addCompare = (): void => {
    if (!job) return;
    const res = actions.addToCompare(job, pickScore(state, job), analysisRed(state));
    actions.toast(res.ok ? '已加入对比' : (res.reason ?? COMPARE_FULL_REASON));
  };

  const genGreeting = (): void => {
    actions.setState({ jobTab: 'greeting' });
    if (!job) return; // 无岗位时由 JobPanel 展示「手动粘贴 JD」入口
    if (!state.apiReady) {
      actions.toast('请先配置 API Key');
      host?.openOptions('api');
      return;
    }
    runGreeting(job, '', false);
  };

  return (
    <>
      <Button
        variant="ghost"
        onClick={addCompare}
        disabled={inCompare || !job}
        title={!job ? '请先识别或粘贴 JD' : undefined}
      >
        {inCompare ? '已在对比中' : '加入对比'}
      </Button>
      <Button onClick={genGreeting}>
        <span dangerouslySetInnerHTML={{ __html: ICONS.spark }} />
        生成打招呼语
      </Button>
    </>
  );
}
