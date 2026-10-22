/**
 * Content Script 装配层（F0 门控 + 页面注入编排）。
 *
 * 门控红线：
 * 1. 未登录 / 无法判断登录态时不注入任何功能控件（仅保留侧栏悬浮入口）、不解析页面、不发请求；
 * 2. 任何模型请求必须由用户点击触发；页面切换、新消息、登录态变化都只更新提示，绝不触发请求；
 * 3. 登录态变化时 abort 在途请求并清空内存中的聊天上下文（本地简历与历史保留）。
 *
 * 性能（F-NFR）：首屏只做本地读取（chrome.storage），不做任何网络请求；
 * 整个 init() 包在 try/catch 中，异常只写本地日志，绝不影响站点页面本身（F3）。
 */
import { logError } from '../shared/log';
import { AUTH_SELECTORS, qs } from '../shared/selectors';
import type { AuthState, ChatContext, JobInfo, PageKind } from '../shared/types';
import { createAuthDetector } from './auth-detector';
import { getChatInputText, insertIntoChatInput } from './chat-bridge';
import { FEATURES } from './features';
import type { FeatureContext } from './features';
import { createInjector } from './injector';
import { onChatMutation, onPageMutation, onRouteChange } from './observers';
import { actions, mountPanel } from './panel';
import type { PanelHandle, PanelHost, PanelState } from './panel';
import { detectPageKind, parseChat, parseCompany, parseJobDetail } from './parsers';
import type { CompanyPageInfo } from './parsers';

/** 装配层内部的页面上下文缓存（只在 logged_in 时填充）。 */
interface PageState {
  kind: PageKind;
  auth: AuthState;
  job: JobInfo | null;
  company: CompanyPageInfo | null;
  chat: ChatContext | null;
}

let started = false;

/** 启动装配（幂等：重复调用直接返回）。 */
function init(): void {
  if (started) return;
  started = true;

  try {
    const st: PageState = {
      kind: detectPageKind(),
      auth: 'unknown',
      job: null,
      company: null,
      chat: null,
    };

    const detector = createAuthDetector();
    st.auth = detector.getState();

    let handle: PanelHandle | null = null;
    let featuresMounted = false;

    // ---- 上下文身份：用于判断「岗位是否切换」（切换时才取消在途请求） ----
    function identity(): string {
      return st.job?.id ?? st.chat?.jobId ?? st.kind;
    }

    /**
     * 重新解析当前页面上下文并写入 store。
     * 只在 logged_in 时调用；只读 DOM，不发任何请求。返回岗位身份是否变化。
     */
    function refreshContext(kind: PageKind): boolean {
      const prev = identity();
      st.kind = kind;
      if (kind === 'jobDetail') {
        st.job = parseJobDetail();
        st.company = parseCompany();
        st.chat = null;
      } else if (kind === 'chat') {
        st.job = null;
        st.company = null;
        st.chat = parseChat();
      } else {
        st.job = null;
        st.company = null;
        st.chat = null;
      }
      actions.setState({ job: st.job, company: st.company, chat: st.chat });
      return identity() !== prev;
    }

    /** 更新「待回复」提示：PanelState 暂无该字段（不得改 panel 文件），以可选扩展键写入运行时状态。 */
    function setPendingReply(pending: boolean): void {
      const patch: Partial<PanelState> & { pendingReply?: boolean } = { pendingReply: pending };
      actions.setState(patch);
    }

    // ---- 功能注册表挂载 / 卸载（Task 10 会向 FEATURES 注册实现） ----
    function mountFeatures(): void {
      if (featuresMounted) return;
      featuresMounted = true;
      const ctx: FeatureContext = { host, pageKind: st.kind };
      for (const feature of FEATURES) {
        try {
          feature.mount(ctx);
        } catch (e) {
          void logError('feature mount 失败', e);
        }
      }
    }

    function unmountFeatures(): void {
      if (!featuresMounted) return;
      featuresMounted = false;
      for (const feature of FEATURES) {
        try {
          feature.unmount();
        } catch (e) {
          void logError('feature unmount 失败', e);
        }
      }
    }

    // ---- 注入器（点击只回调，不请求） ----
    const injector = createInjector({
      getAuth: () => detector.getState(),
      getPageKind: () => st.kind,
      onRequestAnalysis: () => {
        handle?.open('job');
      },
      onRequestQuickReview: () => {
        // 列表快评由 FEATURES 注册的 quick-review feature 处理：点击后直接在卡片上给出分数徽标，不打开侧栏
      },
    });

    // ---- 侧栏宿主能力 ----
    const host: PanelHost = {
      getAuth: () => detector.getState(),
      getJob: () => st.job,
      getCompany: () => st.company,
      getChat: () => st.chat,
      getPageKind: () => st.kind,
      openOptions(hash) {
        // 不能在这里直接 window.open(chrome-extension://…)：content script 处于页面源下，
        // 该导航属于「网页发起的顶层导航」，会被 Chromium 的扩展资源策略拦截
        // （真机表现为 ERR_BLOCKED_BY_CLIENT）。改为请 background 在扩展上下文里
        // 用 chrome.tabs.create 打开。
        try {
          void chrome.runtime
            .sendMessage({ type: 'ui:openOptions', payload: hash ? { hash } : {} })
            .catch(() => undefined);
        } catch {
          /* 非扩展环境忽略 */
        }
      },
      requestLogin() {
        const el = qs<HTMLElement>(document, AUTH_SELECTORS.loginButton);
        if (el && typeof el.click === 'function') {
          el.click();
          return;
        }
        try {
          location.assign('https://www.zhipin.com/web/user/?ka=header-login');
        } catch {
          /* 忽略 */
        }
      },
      insertIntoChatInput,
      getChatInputText,
    };

    // 登录态为 logged_out / unknown 时同样挂载：悬浮入口与引导卡必须存在
    handle = mountPanel(host);

    // ---- background 二次查询登录态（字符串字面量与 background 的 AUTH_QUERY 保持一致，不新增共享常量） ----
    const onMessage = (
      msg: unknown,
      _sender: chrome.runtime.MessageSender,
      send: (response?: unknown) => void,
    ): boolean | undefined => {
      if ((msg as { type?: string } | null)?.type === 'ba:auth-query') {
        send({ auth: detector.getState() });
        return true;
      }
      return undefined;
    };
    try {
      chrome.runtime.onMessage.addListener(onMessage);
    } catch {
      /* 非扩展环境忽略 */
    }

    // ---- 登录态变化编排 ----
    let lastAuth: AuthState = st.auth;

    function onAuthChange(next: AuthState): void {
      const prev = lastAuth;
      lastAuth = next;
      st.auth = next;

      if (next === 'logged_in') {
        actions.setAuth('logged_in');
        refreshContext(st.kind);
        injector.apply(st.kind, 'logged_in');
        mountFeatures();
        if (prev !== 'logged_in') {
          handle?.open();
          actions.toast('已登录，可以开始分析');
        }
        return;
      }

      if (next === 'logged_out') {
        // 退出登录：abort 在途请求 + 清空内存聊天上下文（本地简历与历史保留）
        actions.setAuth('logged_out');
        actions.abortAll();
        st.job = null;
        st.company = null;
        st.chat = null;
        actions.setState({ chat: null, job: null, company: null });
        actions.resetAllSlots();
        unmountFeatures();
        injector.clear();
        handle?.close();
        return;
      }

      // unknown：不解析、不请求，仅保证 store 的 auth/authNote 正确（引导卡由 Task 7 的 App 负责）
      actions.setAuth('unknown', '无法确认登录状态，请确认已登录后刷新页面');
      actions.abortAll();
      st.job = null;
      st.company = null;
      st.chat = null;
      unmountFeatures();
      injector.clear();
    }

    // ---- 页面 / 路由变化：只在 logged_in 时重新解析并刷新上下文，绝不触发模型请求 ----
    let offMutation: (() => void) | null = null;

    function bindMutation(kind: PageKind): void {
      offMutation?.();
      offMutation = onPageMutation(kind, () => {
        if (detector.getState() !== 'logged_in') return;
        const switched = refreshContext(kind);
        if (switched) actions.abortAll(); // 仅在岗位身份变化时取消在途请求
        injector.apply(kind, 'logged_in'); // 列表异步渲染：mutation 后补注入按钮
      });
    }

    const offRoute = onRouteChange((kind) => {
      if (detector.getState() !== 'logged_in') {
        st.kind = kind;
        bindMutation(kind);
        return;
      }
      actions.abortAll(); // 切换岗位：取消在途请求（F-NFR）
      refreshContext(kind);
      injector.apply(kind, 'logged_in');
      bindMutation(kind);
    });

    // ---- 聊天页：仅更新待回复提示与刷新上下文，绝不请求模型 ----
    const offChat = onChatMutation(() => {
      if (detector.getState() !== 'logged_in' || st.kind !== 'chat') return;
      refreshContext('chat');
      const msgs = st.chat?.messages ?? [];
      const pending = msgs.length > 0 && msgs[msgs.length - 1].role === 'hr';
      setPendingReply(pending);
    });

    bindMutation(st.kind);

    // ---- 启动检测与首次编排 ----
    onAuthChange(st.auth);
    const offAuth = detector.start(onAuthChange);

    // ---- 统一释放（切页 / 关闭标签） ----
    function dispose(): void {
      try {
        offAuth();
        offRoute();
        offMutation?.();
        offChat();
        detector.stop();
        unmountFeatures();
        injector.dispose();
        handle?.destroy();
        try {
          chrome.runtime.onMessage.removeListener(onMessage);
        } catch {
          /* 忽略 */
        }
      } catch (e) {
        void logError('content dispose 失败', e);
      }
    }

    window.addEventListener('pagehide', dispose, { once: true });
  } catch (e) {
    // 任何异常都不得影响站点页面本身
    void logError('content init 失败', e);
  }
}

init();

export {};
