/**
 * Options 页共用的纯函数与常量。
 * 本文件不依赖 React / chrome / DOM（downloadText 除外），便于单元测试。
 */
import type {
  AnalysisRecord,
  ApiSettings,
  AppSettings,
  DeepPartial,
  HistoryKind,
} from '../shared/types';
import { toAppError } from '../shared/errors';
import type { ErrorCode } from '../shared/errors';

/** 页面提示（toast）回调。 */
export type Notify = (message: string) => void;

/** 统一的界面错误结构（含错误码，便于展示文案与排查）。 */
export interface UiError {
  code: ErrorCode;
  message: string;
}

/** 任意异常 → UiError。 */
export function toUiError(e: unknown): UiError {
  const err = toAppError(e);
  return { code: err.code, message: err.message };
}


/** 内置 host 权限对应的源（对齐 manifest.host_permissions，仅 BOSS直聘）。 */
export const BUILTIN_ORIGINS: readonly string[] = ['https://www.zhipin.com'];

/** 取 URL 的源；非法或空值时返回空串。 */
export function originOf(url: string): string {
  const raw = String(url ?? '').trim();
  if (!raw) return '';
  try {
    const origin = new URL(raw).origin;
    return origin === 'null' ? '' : origin;
  } catch {
    return '';
  }
}

/** 判断某个 Base URL 是否需要动态申请域名权限（不在内置 host 权限内）。 */
export function needsOriginGrant(url: string): { origin: string; needed: boolean } {
  const origin = originOf(url);
  return { origin, needed: origin !== '' && !BUILTIN_ORIGINS.includes(origin) };
}

/** 密钥脱敏展示：长度 > 8 时保留前 4 + 后 4，其余打码；否则全部打码。 */
export function maskKeyDisplay(key: string): string {
  const k = String(key ?? '');
  if (!k) return '';
  if (k.length > 8) return `${k.slice(0, 4)}***${k.slice(-4)}`;
  return '*'.repeat(k.length);
}

/** PDF 文件头魔数：%PDF。 */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46];

/** 判断字节序列前 4 位是否为 %PDF。 */
export function isPdfHeader(bytes: Uint8Array): boolean {
  if (bytes.length < PDF_MAGIC.length) return false;
  return PDF_MAGIC.every((b, i) => bytes[i] === b);
}

/** 字节数组 → 小写十六进制。 */
export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** 计算 SHA-256（小写十六进制）。 */
export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const view = data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = await crypto.subtle.digest('SHA-256', view as unknown as BufferSource);
  return toHex(new Uint8Array(digest));
}

/** 字节数 → 可读文本。 */
export function formatBytes(size: number): string {
  const n = Number(size);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** 时间戳 → 本地时间字符串。 */
export function formatTime(at: number): string {
  const d = new Date(Number(at));
  if (!Number.isFinite(d.getTime())) return '未提供';
  return d.toLocaleString('zh-CN', { hour12: false });
}

/** 分数展示：null 显示「未提供」。 */
export function formatScore(score: number | null): string {
  return score === null || score === undefined ? '未提供' : String(score);
}

/** 历史类型 → 中文。 */
export const HISTORY_KIND_LABELS: Record<HistoryKind, string> = {
  analysis: '岗位分析',
  match: '匹配度',
  greeting: '打招呼语',
  company: '公司',
  interview: '面试题',
  quickReview: '快评',
  chat: '聊天',
};

/** 历史类型中文名。 */
export function kindLabel(kind: HistoryKind): string {
  return HISTORY_KIND_LABELS[kind] ?? String(kind);
}

/** 按类型 + 关键字（岗位标题 / 公司）筛选历史。 */
export function filterHistory(
  list: AnalysisRecord[],
  kind: HistoryKind | 'all',
  keyword: string,
): AnalysisRecord[] {
  const kw = keyword.trim().toLowerCase();
  return list.filter((r) => {
    if (kind !== 'all' && r.kind !== kind) return false;
    if (!kw) return true;
    return `${r.jobTitle ?? ''} ${r.company ?? ''}`.toLowerCase().includes(kw);
  });
}

/** CSV 单字段转义：含逗号 / 引号 / 换行时用双引号包裹，内部引号翻倍。 */
export function csvField(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** 历史记录 → CSV 文本（不含 BOM，由下载层决定是否加）。 */
export function buildCsv(records: AnalysisRecord[]): string {
  const header = ['时间', '岗位', '公司', '类型', '匹配度', '风险数', '模型'];
  const rows = records.map((r) => [
    formatTime(r.at),
    r.jobTitle,
    r.company,
    kindLabel(r.kind),
    formatScore(r.score),
    String(r.riskCount ?? 0),
    r.model,
  ]);
  return [header, ...rows].map((row) => row.map(csvField).join(',')).join('\r\n');
}

/** Markdown 表格单元格转义。 */
function mdCell(value: string): string {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** 历史记录 → Markdown 文本。 */
export function buildMarkdown(records: AnalysisRecord[]): string {
  const lines = [
    '# BOSS 求职 AI 助手 · 分析历史',
    '',
    `导出时间：${formatTime(Date.now())}`,
    `记录条数：${records.length}`,
    '',
    '| 时间 | 岗位 | 公司 | 类型 | 匹配度 | 风险数 | 模型 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const r of records) {
    lines.push(
      `| ${mdCell(formatTime(r.at))} | ${mdCell(r.jobTitle)} | ${mdCell(r.company)} | ${kindLabel(
        r.kind,
      )} | ${formatScore(r.score)} | ${r.riskCount ?? 0} | ${mdCell(r.model)} |`,
    );
  }
  return lines.join('\n');
}

/** 文件名用的日期戳（YYYYMMDD）。 */
export function todayStamp(date: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

/** 触发浏览器下载（CSV 可带 BOM 以便 Excel 正确识别 UTF-8）。 */
export function downloadText(
  filename: string,
  text: string,
  mime = 'text/plain',
  withBom = false,
): void {
  const blob = new Blob([withBom ? `\uFEFF${text}` : text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 500);
}

/** 对比草稿与已保存配置，仅产出有变化的字段（DeepPartial）。 */
export function buildApiPatch(current: ApiSettings, draft: ApiSettings): DeepPartial<AppSettings> {
  const api: Partial<ApiSettings> = {};
  (Object.keys(draft) as (keyof ApiSettings)[]).forEach((key) => {
    if (draft[key] !== current[key]) {
      (api as Record<string, unknown>)[key] = draft[key];
    }
  });
  return Object.keys(api).length > 0 ? ({ api } as DeepPartial<AppSettings>) : {};
}
