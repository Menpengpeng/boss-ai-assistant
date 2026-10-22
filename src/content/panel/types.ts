/**
 * 侧栏（Task 7）公共类型契约。
 *
 * 本文件是后续三个 UI 任务（职位页五标签 / 聊天助手 / 列表快评对比）的固定接口：
 * 组件、store、宿主（Task 6 注入器）都只依赖这里声明的类型，不得随意变更导出名与结构。
 */
import type {
  AuthState,
  ChatContext,
  CompareItem,
  FavoriteItem,
  JobInfo,
  LogEntry,
  PageKind,
  QuickReview,
} from '../../shared/types';
import type { ErrorCode, ErrorAction } from '../../shared/errors';
import type { CompanyPageInfo } from '../parsers';

/** 侧栏一级标签。 */
export type PanelTab = 'job' | 'chat' | 'compare';

/** 职位页二级标签。 */
export type JobSubTab = 'analysis' | 'match' | 'greeting' | 'interview' | 'company';

/** 需要独立状态槽位的任务键（含职位页五标签与聊天/快评）。 */
export type TaskKey =
  | 'analysis'
  | 'match'
  | 'greeting'
  | 'interview'
  | 'company'
  | 'chatReply'
  | 'chatRisk'
  | 'quickReview';

/** 单个生成型区块的四态。 */
export type SlotStatus = 'idle' | 'loading' | 'success' | 'error';

/** 生成型区块的状态槽。 */
export interface TaskSlot<T = unknown> {
  status: SlotStatus;
  data: T | null;
  error: { code: ErrorCode; message: string } | null;
  /** 流式过程中的当前文本（未完成时非空）。 */
  stream: string;
  /** 被证据子串校验丢弃的风险条数。 */
  dropped: number;
}

/** 侧栏全局状态（唯一数据源）。 */
export interface PanelState {
  mounted: boolean;
  open: boolean;
  tab: PanelTab;
  jobTab: JobSubTab;
  auth: AuthState;
  authNote: string;
  job: JobInfo | null;
  company: CompanyPageInfo | null;
  chat: ChatContext | null;
  slots: Record<TaskKey, TaskSlot>;
  busyKey: TaskKey | null;
  quickScores: Record<string, QuickReview>;
  quickBusyJobId: string | null;
  compare: CompareItem[];
  favorites: FavoriteItem[];
  chatConsent: boolean;
  resumeVersion: number;
  hasResume: boolean;
  /** 是否已配置并测试通过 Key。 */
  apiReady: boolean;
  /** 侧栏宽度（px）：用户可拖拽调整，仅存本地；默认 PANEL_WIDTH。 */
  panelWidth: number;
  theme: 'light' | 'dark';
  toast: string | null;
  logs: LogEntry[];
}

/** 三个标签组收到的统一 props（host 由 App 注入，避免 tabs 反向依赖 App 造成循环引用）。 */
export interface TabProps {
  state: PanelState;
  host: PanelHost | null;
}

/** 由 Task 6（注入器 / 编排）实现的宿主能力。 */
export interface PanelHost {
  getAuth(): AuthState;
  getJob(): JobInfo | null;
  getCompany(): CompanyPageInfo | null;
  getChat(): ChatContext | null;
  getPageKind(): PageKind;
  openOptions(hash?: string): void;
  requestLogin(): void;
  /** 把文本写入站点聊天输入框并派发 input 事件、聚焦（绝不触发发送）。 */
  insertIntoChatInput(text: string): boolean;
  getChatInputText(): string;
  /** 登录态变化时由宿主调用，通知侧栏。 */
  onAuthChange?(this: void): void;
}

/** 侧栏对外句柄。 */
export interface PanelHandle {
  open(tab?: PanelTab): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  refresh(): void;
  destroy(): void;
}

export type { PageKind, ErrorCode, ErrorAction };
