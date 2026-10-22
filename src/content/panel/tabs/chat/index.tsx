/**
 * 聊天助手标签组（F6 对话洞察 + F8 敏感信号 + 回复建议）。
 *
 * 红线（与 content/chat-bridge.ts、content/index.ts 一致）：
 * 1. 所有模型请求必须由用户点击触发；HR 新消息只更新气泡与「待回复」提示，绝不自动请求；
 * 2. 回复建议只能写入站点输入框（派发 input 事件并聚焦），绝不触发发送；
 * 3. 首次使用必须在弹窗中确认「会话文本会发送到你自行配置的模型服务商」，确认后才写入 chatConsent；
 * 4. 风险证据必须能在聊天原文中定位，否则丢弃并提示丢弃条数；
 * 5. 索要证件 / 转账收费 / 私人联系方式等关键词命中的条目强制判定为「高」。
 */
import { useState } from 'react';
import { LIMITS } from '../../../../shared/constants';
import { AppError, ERROR_TIPS } from '../../../../shared/errors';
import type { ErrorAction } from '../../../../shared/errors';
import type {
  ChatContext,
  ChatInsight,
  ChatMessage,
  RiskItem,
  RiskLevel,
} from '../../../../shared/types';
import { extractJson, pageTextFor, validateEvidence } from '../../../../shared/validate';
import { guardChatInsight } from '../../../../prompts/guards';
import { STATE_COPY } from '../../App';
import {
  Button,
  CopyButton,
  EmptyState,
  ErrorCard,
  KeyValue,
  Modal,
  RiskList,
  Skeleton,
} from '../../components';
import { runTask, sendBg } from '../../llm-client';
import { actions } from '../../store';
import type { PanelHost, PanelState, TabProps, TaskKey } from '../../types';

/** 该标签组的增量样式（注入 Shadow DOM），只补 baseStyles 未覆盖的规则。 */
export const chatStyles = `
/* —— 聊天助手（F6 + F8） —— */
.ba-chat-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.ba-bubble .ba-sub{margin-top:4px}
.ba-reply{border:1px solid var(--line);border-radius:var(--r-card);padding:10px 12px;background:var(--surface2);display:flex;flex-direction:column;gap:8px}
.ba-reply-text{font-size:var(--fs-13);line-height:20px;word-break:break-word}
.ba-reply-actions{display:flex;gap:8px;flex-wrap:wrap}
.ba-note.ba-pending{border:1px solid var(--warn);background:var(--warn-bg);color:var(--warn);justify-content:space-between}
`;

/** F6 与 F8 共用同一个洞察结果槽位。 */
const SLOT_KEY: TaskKey = 'chatReply';

/** 命中即强制判定为「高」的关键词（F8：索要证件 / 转账收费 / 私人联系方式）。 */
const FORCE_HIGH_KEYWORDS: readonly string[] = [
  '索要证件',
  '身份证',
  '银行卡',
  '转账',
  '汇款',
  '押金',
  '私人微信',
  '手机号',
  '私下联系',
];

/** 强制高风险条目在卡片上追加的说明（RiskList 结构固定，故拼进类型文案）。 */
export const FORCED_HIGH_NOTE = '已强制判定为高风险';

/** 底部快捷操作：只在本地把指示拼进上下文，不改变站点页面。 */
const QUICK_ACTIONS: { label: string; direction: string }[] = [
  { label: '婉拒', direction: '（请以婉拒为方向给出回复）' },
  { label: '谈薪', direction: '（请以谈薪为方向给出回复）' },
  { label: '约面', direction: '（请以约面试为方向给出回复）' },
];

/** 聊天原文池（证据子串校验用）：只取真实会话文本，不含本地指示。 */
export function chatTextOf(messages: ChatMessage[] | undefined): string {
  return (messages ?? []).map((m) => m.text).join('\n');
}

/** 取最近 take 条消息（默认 LIMITS.chatTake = 20）。 */
export function recentMessages(
  messages: ChatMessage[] | undefined,
  take: number = LIMITS.chatTake,
): ChatMessage[] {
  const list = messages ?? [];
  return list.length <= take ? list : list.slice(list.length - take);
}

/**
 * 归一化风险等级：类型或结论命中强制关键词时提升为「高」，
 * 并在类型后追加说明（等级仍由 RiskList 以文字展示，不只靠颜色）。
 */
export function normalizeRiskLevel(risks: RiskItem[] | undefined): RiskItem[] {
  return (risks ?? []).map((item) => {
    const hit = FORCE_HIGH_KEYWORDS.some((k) => `${item.type}${item.conclusion}`.includes(k));
    if (!hit) return item;
    const level: RiskLevel = '高';
    const type = item.type.includes(FORCED_HIGH_NOTE)
      ? item.type
      : `${item.type}（${FORCED_HIGH_NOTE}）`;
    return { ...item, level, type };
  });
}

/** 把本地指示作为一条「我」的消息追加到上下文末尾（仅本地提示，不写入页面）。 */
export function withDirection(context: ChatContext, direction: string): ChatContext {
  return {
    ...context,
    messages: [...context.messages, { role: 'me', text: direction, time: '' }],
  };
}

/** ERROR_TIPS 的 action → 统一动作（供 ErrorCard.onAction 使用）。 */
export function runErrorAction(action: ErrorAction, host: PanelHost | null, retry: () => void): void {
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
      retry();
      return;
    default:
      return; // 'paste' | 'none'：聊天页无对应动作
  }
}

/**
 * 发起一次对话洞察请求（ChatPanel / ChatFooter 共用）。
 * 结果写入 slots.chatReply，风险条目在写回前先做强制高风险归一化与证据子串校验。
 */
export function requestChatInsight(
  context: ChatContext,
  opts: { force?: boolean; direction?: string } = {},
): void {
  const payloadContext = opts.direction ? withDirection(context, opts.direction) : context;
  const chatText = chatTextOf(context.messages);

  actions.setBusy(SLOT_KEY);
  actions.setSlot(SLOT_KEY, { status: 'loading', error: null, stream: '', dropped: 0, data: null });

  const handle = runTask<string>(
    'chatReply',
    { context: payloadContext },
    {
      force: opts.force,
      onDelta: (t) => actions.setSlot(SLOT_KEY, { stream: actions.getSlot(SLOT_KEY).stream + t }),
    },
  );

  handle.done
    .then((raw) => {
      const parsed = guardChatInsight(extractJson(raw));
      if (!parsed) throw new AppError('BAD_JSON', ERROR_TIPS.BAD_JSON.title);
      // 证据池必须是聊天原文：pageTextFor 仅对 src === '聊天' 取 extra（此处 job 只作占位）
      const { ok, drop } = validateEvidence(normalizeRiskLevel(parsed.risks), (it) =>
        pageTextFor({ jd: [] } as never, it.src, chatText),
      );
      actions.setSlot(SLOT_KEY, {
        status: 'success',
        data: { ...parsed, risks: ok },
        dropped: drop.length,
        stream: '',
      });
      actions.setBusy(null);
    })
    .catch((e: unknown) => {
      const err = e instanceof AppError ? e : new AppError('UNKNOWN', ERROR_TIPS.UNKNOWN.title);
      if (err.code === 'ABORTED') return;
      actions.setSlot(SLOT_KEY, {
        status: 'error',
        error: { code: err.code, message: err.message },
        stream: '',
      });
      actions.setBusy(null);
    });
}

/** 持久化聊天模块授权（仅在用户于弹窗中确认后调用）。 */
async function persistConsent(): Promise<void> {
  try {
    await sendBg({ type: 'settings:set', payload: { patch: { chatConsent: true } } });
    await actions.refreshSettings();
    actions.toast('已启用聊天助手');
  } catch (e) {
    const err = e instanceof AppError ? e : new AppError('UNKNOWN', ERROR_TIPS.UNKNOWN.title);
    actions.toast(err.message || ERROR_TIPS[err.code].title);
  }
}

/** 未授权时的说明卡：不渲染任何会触发模型请求的按钮。 */
function ConsentGate({ onEnable }: { onEnable: () => void }): JSX.Element {
  return (
    <div className="ba-card">
      <div className="ba-card-title">启用聊天助手</div>
      <div className="ba-sub">
        聊天助手只读取你当前打开的会话（HR 与你的消息）。点击「分析当前对话」后，会话文本才会发送到
        你自己配置的模型服务商；发送前会做脱敏（手机号、邮箱、微信号、身份证号）。
      </div>
      <div className="ba-sub">插件不会自动回复、不会自动请求，也不会批量采集会话内容。</div>
      <Button onClick={onEnable}>启用聊天助手</Button>
    </div>
  );
}

/** 聊天助手主体内容（F6 对话洞察 + F8 敏感信号 + 回复建议）。 */
export function ChatPanel({ state, host }: TabProps): JSX.Element {
  const [consentOpen, setConsentOpen] = useState(false);

  // 门控红线：未登录只显示提示，不渲染任何会触发请求的按钮
  if (state.auth !== 'logged_in') {
    return (
      <div className="ba-card">
        <div className="ba-card-title">请先登录 BOSS直聘</div>
        <div className="ba-sub">未登录时不读取会话内容，也不发出任何模型请求。</div>
      </div>
    );
  }

  // F6 首次启用确认：确认前不渲染任何请求按钮
  if (!state.chatConsent) {
    return (
      <>
        <ConsentGate onEnable={() => setConsentOpen(true)} />
        <Modal
          open={consentOpen}
          title="启用聊天助手"
          confirmLabel="同意并启用"
          cancelLabel="暂不启用"
          onConfirm={() => {
            void persistConsent();
            setConsentOpen(false);
          }}
          onClose={() => setConsentOpen(false)}
        >
          <div className="ba-sub">
            1. 启用后，当前会话文本（HR 与你的聊天记录）会发送到你自行配置的模型服务商；
            <br />
            2. 文本发送前会做脱敏（手机号、邮箱、微信号、身份证号）；
            <br />
            3. 插件不会自动回复、不会批量采集会话，也不会自动发起请求；
            <br />
            4. 可随时在设置页关闭该授权。
          </div>
        </Modal>
      </>
    );
  }

  const context = state.chat;
  if (!context) {
    return <EmptyState title="当前不在聊天页面" body="请打开 BOSS直聘 聊天页后使用" />;
  }

  const slot = state.slots[SLOT_KEY];
  const parsed = slot.status === 'success' ? (slot.data as ChatInsight | null) : null;
  const busy = slot.status === 'loading';
  const messages = recentMessages(context.messages);
  // 该字段由 content/index.ts 以可选扩展键写入（类型系统未声明），仅作提示，绝不触发请求
  const pendingReply = (state as PanelState & { pendingReply?: boolean }).pendingReply === true;

  const analyze = (force = false): void => requestChatInsight(context, { force });

  /** 只写入站点输入框：绝不触发发送按钮。 */
  const fill = (text: string): void => {
    if (host?.insertIntoChatInput(text)) {
      actions.toast('已填入输入框，请确认后手动发送');
      return;
    }
    actions.toast('未能写入输入框，请手动复制');
  };

  const onErrorAction = (action: ErrorAction): void =>
    runErrorAction(action, host, () => analyze(true));

  return (
    <>
      <section className="ba-card">
        <div className="ba-card-title ba-chat-row">
          <span>最近对话</span>
          <span className="ba-sub">
            {messages.length}/{context.messages.length} 条
          </span>
        </div>
        {context.company || context.jobTitle || context.hrName ? (
          <div className="ba-sub">
            {[context.company, context.jobTitle, context.hrName ? `HR ${context.hrName}` : '']
              .filter(Boolean)
              .join(' · ')}
          </div>
        ) : null}
        <div className="ba-list" role="log" aria-live="polite" aria-label="最近对话内容">
          {messages.length === 0 ? (
            <div className="ba-sub">尚未读取到聊天消息</div>
          ) : (
            messages.map((m, i) => (
              <div
                className={`ba-bubble ${m.role === 'hr' ? 'ba-bubble-hr' : 'ba-bubble-me'}`}
                key={`${i}-${m.time}`}
              >
                <div>{m.text}</div>
                {m.time ? <div className="ba-sub">{m.time}</div> : null}
              </div>
            ))
          )}
        </div>
      </section>

      {pendingReply ? (
        <div className="ba-note ba-pending" role="status">
          <span>HR 有新消息，待你回复（不会自动请求模型）</span>
          <Button variant="ghost" onClick={() => analyze()} disabled={busy}>
            分析当前对话
          </Button>
        </div>
      ) : null}

      <section className="ba-card">
        <div className="ba-card-title ba-chat-row">
          <span>对话洞察</span>
          <span className={`ba-badge ${parsed ? 'ai' : 'mute'}`}>{parsed ? '已更新' : '待分析'}</span>
        </div>
        {busy ? <Skeleton lines={3} label={STATE_COPY.loading} /> : null}
        {slot.status === 'error' && slot.error ? (
          <ErrorCard code={slot.error.code} message={slot.error.message} onAction={onErrorAction} />
        ) : null}
        {parsed ? (
          <KeyValue
            items={[
              { k: '意图', v: parsed.intent },
              { k: '阶段', v: parsed.stage },
              { k: '待回复', v: parsed.pending },
            ]}
          />
        ) : null}
        <Button onClick={() => analyze(Boolean(parsed))} disabled={busy} busy={busy}>
          {busy ? STATE_COPY.loading : parsed ? '重新分析' : '分析当前对话'}
        </Button>
        <div className="ba-hint">
          HR 新消息只更新气泡与「待回复」提示，不会自动请求，请手动点击分析。
        </div>
      </section>

      <section className="ba-card">
        <div className="ba-card-title ba-chat-row">
          <span>敏感信号</span>
          <span className="ba-sub">依据须为 HR 原话</span>
        </div>
        <RiskList
          items={parsed?.risks ?? []}
          dropped={slot.dropped}
          emptyText={parsed ? '未发现明显敏感信号' : '分析当前对话后展示'}
        />
      </section>

      <section className="ba-card">
        <div className="ba-card-title ba-chat-row">
          <span>回复建议</span>
          <span className="ba-sub">每条不超过 {LIMITS.maxReplyChars} 字</span>
        </div>
        {parsed && parsed.replies.length > 0 ? (
          parsed.replies.map((r, i) => (
            <div className="ba-reply" key={`${i}-${r.style}`}>
              <span className="ba-tag on">{r.style}</span>
              <div className="ba-reply-text">{r.text}</div>
              <div className="ba-reply-actions">
                <Button variant="ghost" onClick={() => fill(r.text)}>
                  填入输入框
                </Button>
                <CopyButton text={r.text} />
              </div>
            </div>
          ))
        ) : (
          <div className="ba-sub">分析当前对话后展示三种风格的候选回复。</div>
        )}
        <div className="ba-hint">只填入输入框，不会自动发送。</div>
      </section>
    </>
  );
}

/** 底部快捷操作栏（F6）：婉拒 / 谈薪 / 约面 —— 只把本地指示拼进上下文，不改变站点页面。 */
export function ChatFooter({ state }: TabProps): JSX.Element | null {
  const context = state.chat;
  if (state.auth !== 'logged_in' || !state.chatConsent || !context) return null;

  const busy = state.slots[SLOT_KEY].status === 'loading';
  return (
    <>
      {QUICK_ACTIONS.map((item) => (
        <Button
          key={item.label}
          variant="ghost"
          disabled={busy}
          busy={busy}
          onClick={() => requestChatInsight(context, { direction: item.direction })}
        >
          {busy ? STATE_COPY.loading : item.label}
        </Button>
      ))}
    </>
  );
}
