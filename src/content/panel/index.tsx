/**
 * 侧栏对外唯一入口：挂载 Shadow DOM、注入样式、渲染 React 侧栏、提供 PanelHandle。
 *
 * 性能约束（F-NFR）：mount 阶段不做网络请求、不解析整页，仅同步读取宿主已解析好的数据。
 */
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { App, setPanelRef } from './App';
import { isModalOpen } from './components/Modal';
import { abortAllTasks } from './llm-client';
import { actions, getState, setState, subscribe } from './store';
import {
  BALL_ID,
  baseStyles,
  HOST_STYLE_ID,
  hostStyles,
  ICONS,
  PAGE_PUSH_CLASS,
  PANEL_HOST_ID,
} from './styles';
import { chatStyles } from './tabs/chat';
import { compareStyles } from './tabs/compare';
import { jobStyles } from './tabs/job';
import type { PanelHandle, PanelHost, PanelTab } from './types';

export type { PanelHandle, PanelHost, PanelTab, JobSubTab, TaskKey, PanelState, TabProps } from './types';
export { actions } from './store';

/** 桌面宽度阈值：≥ 该宽度时挤压页面，否则改为右侧浮层 + 遮罩。 */
const PUSH_MIN_WIDTH = 900;

/** 挂载侧栏，返回句柄。 */
export function mountPanel(host: PanelHost): PanelHandle {
  const prev = document.getElementById(PANEL_HOST_ID);
  if (prev) prev.remove();

  // 1) 宿主节点 + Shadow DOM（样式全部为内联字符串，绝不引入 .css 文件）
  const hostEl = document.createElement('div');
  hostEl.id = PANEL_HOST_ID;
  const shadow = hostEl.attachShadow({ mode: 'open' });
  const styleEl = document.createElement('style');
  styleEl.textContent = baseStyles + jobStyles + chatStyles + compareStyles;
  shadow.appendChild(styleEl);
  const mountEl = document.createElement('div');
  mountEl.className = 'ba-root';
  shadow.appendChild(mountEl);
  document.body.appendChild(hostEl);

  // 2) 注入页面 <head> 的最小宿主样式（已存在则跳过）
  if (!document.getElementById(HOST_STYLE_ID)) {
    const pageStyle = document.createElement('style');
    pageStyle.id = HOST_STYLE_ID;
    pageStyle.textContent = hostStyles;
    document.head.appendChild(pageStyle);
  }

  // 3) 悬浮球（页面层，便于窄视口浮层场景）
  const ball = document.createElement('button');
  ball.id = BALL_ID;
  ball.type = 'button';
  ball.setAttribute('aria-label', '打开 BOSS 求职 AI 助手');
  ball.innerHTML = ICONS.spark;
  document.body.appendChild(ball);

  let destroyed = false;

  /** 状态 → DOM 同步。 */
  const sync = (): void => {
    const s = getState();
    hostEl.dataset.theme = s.theme;
    hostEl.classList.toggle('ba-open', s.open);
    ball.hidden = s.open;
    const push = s.open && window.innerWidth >= PUSH_MIN_WIDTH;
    document.documentElement.classList.toggle(PAGE_PUSH_CLASS, push);
  };

  const unsubscribe = subscribe(sync);

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    if (isModalOpen()) return; // 弹窗自行处理 Esc
    if (getState().open) setState({ open: false });
  };

  const onStorageChanged = (): void => {
    void actions.refreshSettings();
    void actions.getCompare();
  };

  const root: Root = createRoot(mountEl);
  setPanelRef({ host, close: () => setState({ open: false }) });
  root.render(<App />);

  // 4) 初始化状态：宿主已解析好的同步数据 + 本地配置
  setState({ mounted: true });
  actions.setAuth(host.getAuth());
  setState({ job: host.getJob(), company: host.getCompany(), chat: host.getChat() });
  void actions.refreshSettings();
  void actions.getCompare();
  // 恢复用户上次拖拽保存的侧栏宽度（无记录时保持默认 380）
  void actions.initPanelWidth();
  sync();

  // 5) 全局监听
  document.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', sync);
  try {
    chrome.storage.onChanged.addListener(onStorageChanged);
  } catch {
    /* 非扩展环境下忽略 */
  }

  const handle: PanelHandle = {
    open(tab?: PanelTab) {
      if (destroyed) return;
      setState((s) => ({ open: true, tab: tab ?? s.tab }));
    },
    close() {
      if (destroyed) return;
      setState({ open: false });
    },
    toggle() {
      if (destroyed) return;
      setState((s) => ({ open: !s.open }));
    },
    isOpen() {
      return getState().open;
    },
    refresh() {
      if (destroyed) return;
      setState({ job: host.getJob(), company: host.getCompany(), chat: host.getChat() });
      void actions.refreshSettings();
      void actions.getCompare();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', sync);
      try {
        chrome.storage.onChanged.removeListener(onStorageChanged);
      } catch {
        /* 忽略 */
      }
      abortAllTasks();
      root.unmount();
      setPanelRef(null);
      hostEl.remove();
      ball.remove();
      document.getElementById(HOST_STYLE_ID)?.remove();
      document.documentElement.classList.remove(PAGE_PUSH_CLASS);
      // 清理拖拽宽度写入的内联变量与拖拽态类，避免残留影响下次挂载
      document.documentElement.classList.remove('ba-col-resizing');
      document.documentElement.style.removeProperty('--ba-w');
      setState({ mounted: false, open: false });
    },
  };

  ball.addEventListener('click', () => handle.toggle());
  return handle;
}
