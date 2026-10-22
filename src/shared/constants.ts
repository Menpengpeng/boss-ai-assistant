/**
 * 全局常量：服务商预设、默认配置、限额、存储键。
 * 字段与取值必须与原型保持一致（PROVIDERS / LIMITS / 存储键）。
 */
import type { ApiSettings, AppSettings, ProviderPreset } from './types';

/** 七家服务商预设（label 中文、id 英文）。 */
export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    kind: 'openai',
    pdf: 'native',
  },
  {
    id: 'claude',
    label: 'Claude',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-5',
    kind: 'anthropic',
    pdf: 'native',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    kind: 'openai',
    pdf: 'none',
  },
  {
    id: 'qwen',
    label: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    kind: 'openai',
    pdf: 'none',
  },
  {
    id: 'kimi',
    label: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    kind: 'openai',
    pdf: 'none',
  },
  {
    id: 'zhipu',
    label: '智谱',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    kind: 'openai',
    pdf: 'none',
  },
  {
    id: 'custom',
    label: '自定义',
    baseUrl: '',
    model: '',
    kind: 'openai',
    pdf: 'none',
  },
];

/** 默认 API 配置（默认服务商 DeepSeek）。 */
export const DEFAULT_API_SETTINGS: ApiSettings = {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  key: '',
  model: 'deepseek-chat',
  temperature: 0.3,
  maxTokens: 2048,
  timeoutSec: 60,
  stream: true,
  maskPhone: true,
  verified: false,
  verifiedAt: 0,
};

/** 默认应用配置。 */
export const DEFAULT_SETTINGS: AppSettings = {
  api: DEFAULT_API_SETTINGS,
  chatConsent: false,
  activeResumeVersion: 0,
  theme: 'auto',
};

/** 各项限额。 */
export const LIMITS = {
  maxPdfBytes: 10 * 1024 * 1024,
  maxCompare: 4,
  chatTake: 20,
  maxReplyChars: 60,
  maxJdChars: 12000,
  logCap: 200,
  streamFirstTokenMs: 3000,
  authDebounceMs: 300,
} as const;

/** chrome.storage.local 使用的键。 */
export const STORAGE_KEYS = {
  settings: 'boss_ai_settings',
  logs: 'boss_ai_logs',
  cachePrefix: 'boss_ai_cache_',
  compare: 'boss_ai_compare',
  favorites: 'boss_ai_favorites',
  chatSessions: 'boss_ai_chat_sessions',
  /** 用户拖拽过的侧栏宽度（px，仅存本地）。 */
  panelWidth: 'boss_ai_panel_width',
} as const;

/** 脱敏占位符前缀（用于展示与还原）。 */
export const MASK_PLACEHOLDER = '[已脱敏]';
