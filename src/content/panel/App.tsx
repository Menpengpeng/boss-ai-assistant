import { useRef, useState, useSyncExternalStore } from 'react';
import { ERROR_TIPS } from '../../shared/errors';
import type { ErrorCode } from '../../shared/errors';
import type { AuthState } from '../../shared/types';
import { Button, IconButton, Modal, Tabs, ToastHost } from './components';
import { ICONS, PANEL_WIDTH_MAX, PANEL_WIDTH_MIN } from './styles';
import { actions, applyPanelWidth, clampPanelWidth, usePanelState } from './store';
import { ChatFooter, ChatPanel } from './tabs/chat';
import { CompareFooter, ComparePanel } from './tabs/compare';
import { JobFooter, JobPanel } from './tabs/job';
import type { JobSubTab, PanelHost, PanelTab, TabProps } from './types';

/** 宿主引用：由 index.tsx 的 mountPanel 注入（App 无 props，故用模块级引用传递）。 */
export interface PanelRef {
  host: PanelHost;
  close: () => void;
}

let panelRef: PanelRef | null = null;

/** 宿主引用变化订阅者（供 usePanelHost 使用）。 */
const refListeners = new Set<() => void>();

/** 注入 / 清除宿主引用。 */
export function setPanelRef(next: PanelRef | null): void {
  panelRef = next;
  refListeners.forEach((fn) => fn());
}

/** 读取当前宿主引用（可能为 null，调用方需判空）。 */
export function getPanelRef(): PanelRef | null {
  return panelRef;
}

/** 标签组件获取宿主能力的 hook（openOptions / requestLogin / insertIntoChatInput 等）。 */
export function usePanelHost(): PanelRef | null {
  return useSyncExternalStore(
    (fn: () => void) => {
      refListeners.add(fn);
      return () => {
        refListeners.delete(fn);
      };
    },
    getPanelRef,
    getPanelRef,
  );
}

const JOB_TABS: { id: JobSubTab; label: string }[] = [
  { id: 'analysis', label: '分析' },
  { id: 'match', label: '匹配度' },
  { id: 'greeting', label: '打招呼语' },
  { id: 'interview', label: '面试题' },
  { id: 'company', label: '公司' },
];

const ERROR_CODES = Object.keys(ERROR_TIPS) as ErrorCode[];

/**
 * 四态文案契约（框架固定，供三个标签任务直接复用，避免各处文案不一致）：
 * 初始态必须说明「不会自动请求」，加载态按钮文案为「分析中…」，字段为空显示「未提供」。
 */
export const STATE_COPY = {
  idle: '点击开始分析，本插件不会自动请求',
  loading: '分析中…',
  empty: '未提供',
  paste: '手动粘贴 JD',
} as const;

/** 是否展示「原型演示控制条」（仅本地评审用）。 */
function protoEnabled(): boolean {
  if (typeof location === 'undefined') return false;
  return location.hostname === 'localhost' || location.search.includes('ba_proto=1');
}

/**
 * 侧栏左缘拖拽手柄：Pointer Events + setPointerCapture。
 * 拖动过程中只更新页面 --ba-w CSS 变量（实时预览，不触发 React 渲染），
 * 松手 / 取消时一次性提交 store（写 state + 持久化）；
 * 支持键盘：左右方向键 ±16px。
 */
export function ResizeHandle(): JSX.Element {
  const state = usePanelState();
  const [dragging, setDragging] = useState(false);
  const startRef = useRef({ x: 0, w: 0 });

  /** 由事件横坐标换算宽度（面板贴右侧：向左拖 → 变宽）。 */
  const widthAt = (clientX: number): number =>
    clampPanelWidth(startRef.current.w + (startRef.current.x - clientX));

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    startRef.current = { x: e.clientX, w: state.panelWidth };
    setDragging(true);
    // 拖拽期间禁用页面文本选择并统一列宽调整光标（规则见 hostStyles 的 ba-col-resizing）
    document.documentElement.classList.add('ba-col-resizing');
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!dragging) return;
    applyPanelWidth(widthAt(e.clientX));
  };

  const finish = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!dragging) return;
    setDragging(false);
    document.documentElement.classList.remove('ba-col-resizing');
    actions.setPanelWidth(widthAt(e.clientX));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const step = e.key === 'ArrowLeft' ? 16 : e.key === 'ArrowRight' ? -16 : 0;
    if (step === 0) return;
    e.preventDefault();
    actions.setPanelWidth(state.panelWidth + step);
  };

  return (
    <div
      className={dragging ? 'ba-resize ba-resizing' : 'ba-resize'}
      role="separator"
      aria-orientation="vertical"
      aria-label="调整侧栏宽度（拖动或用左右方向键）"
      aria-valuemin={PANEL_WIDTH_MIN}
      aria-valuemax={PANEL_WIDTH_MAX}
      aria-valuenow={state.panelWidth}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onKeyDown={onKeyDown}
    />
  );
}

/** 侧栏根组件。 */
export function App(): JSX.Element {
  const state = usePanelState();
  const [helpOpen, setHelpOpen] = useState(false);
  const errIdx = useRef(0);
  const host = panelRef?.host ?? null;

  const topItems: { id: PanelTab; label: string; disabled?: boolean }[] = [
    { id: 'job', label: '岗位' },
    { id: 'chat', label: '沟通', disabled: state.chat === null },
    { id: 'compare', label: '对比', disabled: state.compare.length === 0 },
  ];

  const tabProps: TabProps = { state, host };

  const content =
    state.tab === 'chat' ? (
      <ChatPanel {...tabProps} />
    ) : state.tab === 'compare' ? (
      <ComparePanel {...tabProps} />
    ) : (
      <>
        <Tabs
          items={JOB_TABS}
          value={state.jobTab}
          onChange={(v) => actions.setState({ jobTab: v })}
          ariaLabel="岗位分析标签"
        />
        <JobPanel {...tabProps} />
      </>
    );

  const footer =
    state.tab === 'chat' ? (
      <ChatFooter {...tabProps} />
    ) : state.tab === 'compare' ? (
      <CompareFooter {...tabProps} />
    ) : (
      <JobFooter {...tabProps} />
    );

  /** F0 门控引导卡：未登录 / 状态未知，均不渲染任何会触发模型请求的按钮。 */
  const gate =
    state.auth === 'logged_out' ? (
      <div className="ba-card">
        <div className="ba-card-title">请先登录 BOSS直聘</div>
        <div className="ba-sub">
          未登录时不注入任何控件，也不会解析页面内容或发出任何模型请求。
        </div>
        <Button onClick={() => host?.requestLogin()}>去登录</Button>
      </div>
    ) : state.auth === 'unknown' ? (
      <div className="ba-card">
        <div className="ba-card-title">无法确认登录状态，请确认已登录后刷新页面</div>
        <div className="ba-sub">页面结构可能已改版，为安全起见本次不发任何请求。</div>
        <Button
          onClick={() => {
            const next: AuthState | undefined = host?.getAuth();
            if (next) actions.setAuth(next);
          }}
        >
          我已登录，重新检测
        </Button>
      </div>
    ) : null;

  return (
    <>
      <div className="ba-scrim" onClick={() => panelRef?.close()} />
      <div className="ba-panel" role="complementary" aria-label="BOSS 求职 AI 助手侧栏">
        <ResizeHandle />
        <div className="ba-head">
          <div className="ba-titles">
            <div className="ba-title">BOSS 求职 AI 助手</div>
            <div className="ba-sub">{state.job?.title ?? '未识别岗位'}</div>
          </div>
          <IconButton icon={ICONS.help} label="使用说明" onClick={() => setHelpOpen(true)} />
          <IconButton
            icon={ICONS.settings}
            label="AI 设置"
            onClick={() => host?.openOptions('api')}
          />
          <button
            type="button"
            className="ba-close"
            aria-label="收起侧栏"
            onClick={() => panelRef?.close()}
            dangerouslySetInnerHTML={{ __html: ICONS.close }}
          />
        </div>

        {gate ? (
          <div className="ba-body">{gate}</div>
        ) : (
          <>
            {state.apiReady === false ? (
              <div className="ba-note">
                <span>尚未配置模型 API Key</span>
                <Button variant="ghost" onClick={() => host?.openOptions('api')}>
                  去配置
                </Button>
              </div>
            ) : null}
            <Tabs
              items={topItems}
              value={state.tab}
              onChange={(v) => actions.setState({ tab: v })}
              ariaLabel="侧栏标签"
            />
            <div className="ba-body">{content}</div>
            <div className="ba-foot">{footer}</div>
          </>
        )}

        <ToastHost />
        <Modal
          open={helpOpen}
          title="使用说明与隐私"
          cancelLabel="我知道了"
          onClose={() => setHelpOpen(false)}
        >
          <div className="ba-sub">
            1. 使用 AI 功能时，当前岗位 JD、简历内容与会话文本会发送到你自己配置的模型服务商；
            <br />
            2. 文本内容发送前会做脱敏（手机号、邮箱、微信号、身份证号）；
            <br />
            3. PDF 简历为原文发送，无法本地脱敏；
            <br />
            4. {STATE_COPY.idle}；插件不自动打招呼、不自动回复、不批量采集；
            <br />
            5. 风险结论仅供参考，不构成对公司或个人的事实认定。
          </div>
        </Modal>

        {protoEnabled() ? (
          <div className="ba-proto">
            <div className="ba-proto-row">
              <span>登录态</span>
              {(['logged_in', 'logged_out', 'unknown'] as AuthState[]).map((a) => (
                <button key={a} type="button" onClick={() => actions.setAuth(a)}>
                  {a}
                </button>
              ))}
            </div>
            <div className="ba-proto-row">
              <button
                type="button"
                onClick={() => {
                  errIdx.current = (errIdx.current + 1) % ERROR_CODES.length;
                  const code = ERROR_CODES[errIdx.current];
                  actions.setSlotError('analysis', code, ERROR_TIPS[code].title);
                }}
              >
                错误码轮播
              </button>
              <button type="button" onClick={() => actions.resetAllSlots()}>
                清空数据
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
