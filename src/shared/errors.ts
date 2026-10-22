/**
 * 统一错误码与错误文案（对齐原型 ERR_TIPS）。
 * 注意：errorResponse 输出的 message 绝不允许泄漏 API Key。
 */
/** 统一错误码。 */
export type ErrorCode =
  | 'NO_KEY'
  | 'INVALID_KEY'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'RATE_LIMIT'
  | 'NO_PERMISSION'
  | 'BAD_REQUEST'
  | 'BAD_JSON'
  | 'UNSUPPORTED_ATTACHMENT'
  | 'NOT_LOGGED_IN'
  | 'FILE_INVALID'
  | 'FILE_TOO_LARGE'
  | 'PARSE_FAIL'
  | 'ABORTED'
  | 'UNKNOWN';

/** 错误卡片上按钮的语义动作（由 UI 层映射到具体跳转/重试）。 */
export type ErrorAction =
  | 'opts-api'
  | 'opts-resume'
  | 'grant'
  | 'retry'
  | 'paste'
  | 'login'
  | 'none';

/** 错误展示信息：标题 + 解释 + 按钮动作与文案。 */
export interface ErrorTip {
  title: string;
  body: string;
  action: ErrorAction;
  actionLabel: string;
}

/** 应用内统一错误对象。 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly detail?: string;

  constructor(code: ErrorCode, message?: string, detail?: string) {
    super(message ?? ERROR_TIPS[code]?.title ?? '出现未知错误');
    this.name = 'AppError';
    this.code = code;
    this.detail = detail;
  }
}

/** 错误码 → 中文文案（与原型 ERR_TIPS 保持一致的标题与按钮文案）。 */
export const ERROR_TIPS: Record<ErrorCode, ErrorTip> = {
  NOT_LOGGED_IN: {
    title: '请先登录 BOSS直聘',
    body: '未检测到登录状态，登录后即可使用岗位分析、匹配度与沟通建议。',
    action: 'login',
    actionLabel: '去登录',
  },
  NO_KEY: {
    title: '尚未配置 API Key',
    body: '请先在设置页选择服务商并填写 API Key，之后才可发起请求。',
    action: 'opts-api',
    actionLabel: '去配置',
  },
  INVALID_KEY: {
    title: 'API Key 无效或已过期',
    body: '服务商拒绝了本次请求，请检查 API Key 是否正确或是否已过期。',
    action: 'opts-api',
    actionLabel: '去检查',
  },
  NETWORK: {
    title: '连接超时，请检查网络或中转地址',
    body: '无法连接到所配置的服务商，请检查网络与 Base URL 是否正确。',
    action: 'retry',
    actionLabel: '重试',
  },
  TIMEOUT: {
    title: '连接超时，请检查网络或中转地址',
    body: '请求超过了设定的超时时间，请检查网络或适当调大超时时间。',
    action: 'retry',
    actionLabel: '重试',
  },
  RATE_LIMIT: {
    title: '请求过于频繁，请稍后重试',
    body: '服务商返回了限流响应，请稍候片刻再试。',
    action: 'retry',
    actionLabel: '重试',
  },
  NO_PERMISSION: {
    title: '未授权访问该域名',
    body: '扩展需要访问该接口域名的权限，请重新授权后重试。',
    action: 'grant',
    actionLabel: '重新授权',
  },
  BAD_REQUEST: {
    title: '请求被服务商拒绝',
    body: '服务商未接受本次请求，常见原因是模型名称不正确、最大 tokens 或温度超出该模型允许范围，请到设置页核对。',
    action: 'opts-api',
    actionLabel: '去检查',
  },
  BAD_JSON: {
    title: '结果格式异常',
    body: '模型返回内容无法解析为所需结构，可重新生成一次。',
    action: 'retry',
    actionLabel: '重新生成',
  },
  UNSUPPORTED_ATTACHMENT: {
    title: '当前服务商不支持 PDF 附件',
    body: '请改用粘贴简历文本的方式导入简历。',
    action: 'opts-resume',
    actionLabel: '去设置',
  },
  FILE_INVALID: {
    title: '文件格式不正确',
    body: '请选择有效的 PDF 文件（文件头需为 %PDF）。',
    action: 'opts-resume',
    actionLabel: '重新选择',
  },
  FILE_TOO_LARGE: {
    title: '文件超过 10MB',
    body: '简历文件大小需不超过 10MB，请压缩或拆分后重试。',
    action: 'opts-resume',
    actionLabel: '重新选择',
  },
  PARSE_FAIL: {
    title: '页面解析失败，可手动粘贴 JD 继续分析',
    body: '未能从当前页面解析到岗位信息，可手动粘贴 JD 文本继续分析。',
    action: 'paste',
    actionLabel: '手动粘贴 JD',
  },
  ABORTED: {
    title: '已取消',
    body: '请求已被取消。',
    action: 'none',
    actionLabel: '',
  },
  UNKNOWN: {
    title: '出现未知错误',
    body: '发生了未预期的错误，请重试；若持续失败请检查配置。',
    action: 'retry',
    actionLabel: '重试',
  },
};

/** 疑似密钥替换为 ***，保证错误信息与日志不泄漏 Key。 */
const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{6,}/g, // OpenAI 风格 Key
  /(["?]?x-api-key"?\s*[:=]\s*"?)([A-Za-z0-9\-._]{6,})/gi, // 请求头里的 Key
  /[A-Za-z0-9+/=_-]{24,}/g, // 疑似 base64 / hex 长串
];

/** 对任意文本做脱敏（密钥 + 手机号 + 邮箱），供 errorResponse 与日志共用逻辑。 */
function redactSecrets(text: string): string {
  let out = String(text ?? '');
  out = out.replace(SECRET_PATTERNS[0], '***');
  out = out.replace(SECRET_PATTERNS[1], '$1***');
  out = out.replace(SECRET_PATTERNS[2], '***');
  out = out.replace(/1[3-9]\d{9}/g, '***');
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '***');
  return out;
}

/** 截断为不超过 max 个字符（超出时以省略号结尾）。 */
function clampText(text: string, max: number): string {
  if (max <= 0) return '';
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

/** DOMException/AbortError 判定。 */
export function isAbortError(e: unknown): boolean {
  if (e == null) return false;
  if (typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'AbortError') {
    return true;
  }
  const name = (e as { name?: unknown })?.name;
  if (name === 'AbortError') return true;
  const message = (e as { message?: unknown })?.message;
  return typeof message === 'string' && /abort/i.test(message);
}

/** 任意异常 → AppError。 */
export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (isAbortError(e)) return new AppError('ABORTED', ERROR_TIPS.ABORTED.title);
  const message =
    e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  if (e instanceof TypeError && /fetch|network|load/i.test(message)) {
    return new AppError('NETWORK', ERROR_TIPS.NETWORK.title, message);
  }
  if (/fetch failed|failed to fetch|networkerror|network error/i.test(message)) {
    return new AppError('NETWORK', ERROR_TIPS.NETWORK.title, message);
  }
  return new AppError('UNKNOWN', ERROR_TIPS.UNKNOWN.title, message);
}

/** HTTP 状态码 → 错误码。 */
export function normalizeHttpStatus(status: number): ErrorCode {
  // 400/422 是 LLM 场景最高频的错误（模型名不存在、max_tokens / temperature 超限、
  // 请求体含服务商不支持的字段），单独归一化以便给出可操作的修复指引
  if (status === 400 || status === 422) return 'BAD_REQUEST';
  if (status === 401 || status === 403) return 'INVALID_KEY';
  if (status === 404) return 'NETWORK';
  if (status === 408) return 'TIMEOUT';
  if (status === 429) return 'RATE_LIMIT';
  if (status >= 500 && status <= 599) return 'NETWORK';
  return 'UNKNOWN';
}

/** 供消息协议回传的安全错误结构。 */
export function errorResponse(e: unknown): { code: ErrorCode; message: string } {
  const err = toAppError(e);
  const tip = ERROR_TIPS[err.code] ?? ERROR_TIPS.UNKNOWN;
  const detail = err.detail ? clampText(redactSecrets(err.detail), 200) : '';
  return {
    code: err.code,
    message: detail ? `${tip.title}：${detail}` : tip.title,
  };
}
