/**
 * 聊天页解析器（F6 聊天读取 / F8 敏感信号）。
 *
 * 规则：只用 src/shared/selectors.ts 的候选规则表；头部职位/公司字段 shared 未覆盖，
 * 在本文件内的 LOCAL_FALLBACK 追加兜底。非聊天页或消息数为 0 时 parseChat 返回 null。
 */
import type { ChatContext, ChatMessage, JobInfo } from '../../shared/types';
import { LIMITS } from '../../shared/constants';
import { hash32 } from '../../shared/cache-key';
import { CHAT_SELECTORS, URL_PATTERNS, qsa, textOf } from '../../shared/selectors';

/** 本地备用候选：聊天头部字段 shared 未覆盖，此处兜底。 */
const HEADER: {
  jobTitle: string[];
  company: string[];
  time: string[];
} = {
  jobTitle: [
    '.chat-header .job-name',
    '[class*="chat-title"] [class*="job-name"]',
    '.chat-position',
    '[class*="chat-position"]',
  ],
  company: [
    '.chat-header .company-name',
    '[class*="chat-title"] [class*="company-name"]',
    '.chat-company',
    '[class*="chat-company"]',
  ],
  time: ['[class*="message-time"]', '[class*="chat-time"]', '.time', 'time'],
};

/** 压缩空白：换行/多空格统一为单个空格并 trim。 */
function squeeze(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 判断消息是否由「我」发出：命中 itemFromMe 规则或含 self 类名/头像。 */
function isFromMe(el: Element): boolean {
  for (const sel of CHAT_SELECTORS.itemFromMe) {
    try {
      if (el.matches(sel)) return true;
    } catch {
      // 非法选择器，跳过
    }
    try {
      if (el.querySelector(sel)) return true;
    } catch {
      // 非法选择器，跳过
    }
  }
  const cls = el.className;
  if (typeof cls === 'string' && /(^|\s)(self|myself|me)(\s|$)/.test(cls)) return true;
  if (el.querySelector('[class*="avatar-self"], [class*="avatar-me"], img[class*="self"]')) return true;
  return false;
}

/** 从 URL 取会话/岗位 ID：?id= → /job_detail/xxxxx.html → 路径数字。 */
function chatIdFromUrl(): string {
  const query = /[?&](?:id|jobId|job_id)=([A-Za-z0-9_-]+)/.exec(location.href);
  if (query) return query[1];
  const detail = /\/job_detail\/([A-Za-z0-9_-]+)(?:\.html)?/.exec(location.href);
  if (detail) return detail[1];
  const numeric = /\/(\d{4,})(?:[/?#]|$)/.exec(location.pathname);
  return numeric ? numeric[1] : '';
}

/** 解析当前会话的全部消息；未命中返回 []。 */
export function parseChatMessages(doc: Document = document): ChatMessage[] {
  const items = qsa<HTMLElement>(doc, CHAT_SELECTORS.listItem);
  const out: ChatMessage[] = [];
  for (const item of items) {
    const text = textOf(item, CHAT_SELECTORS.itemText);
    if (!text) continue;
    out.push({
      role: isFromMe(item) ? 'me' : 'hr',
      text,
      time: squeeze(textOf(item, HEADER.time)),
    });
  }
  return out;
}

/**
 * 取最近 n 条消息（默认 LIMITS.chatTake=20）。
 * 总数超限时，把较早的消息折叠为一条 role:'hr' 的摘要占位，保证返回条数不超过 n。
 */
export function takeRecentMessages(
  msgs: ChatMessage[],
  n: number = LIMITS.chatTake,
): ChatMessage[] {
  if (n <= 0) return [];
  if (msgs.length <= n) return msgs.slice();
  const keep = n - 1;
  const head = msgs.slice(msgs.length - keep);
  const omitted = msgs.length - keep;
  return [{ role: 'hr', text: `【前 ${omitted} 条已省略】`, time: '' }, ...head];
}

/** 用 JobInfo 与会话消息组装 ChatContext（无 JobInfo 时字段填空串）。 */
export function chatContextOf(job: JobInfo | null, msgs: ChatMessage[]): ChatContext {
  return {
    jobId: job?.id ?? '',
    jobTitle: job?.title ?? '',
    company: job?.company ?? '',
    hrName: job?.hrName ?? '',
    messages: msgs,
  };
}

/** 解析当前聊天页；非聊天页或消息数为 0 返回 null。 */
export function parseChat(doc: Document = document): ChatContext | null {
  if (!URL_PATTERNS.chat.test(location.pathname)) return null;
  const messages = parseChatMessages(doc);
  if (messages.length === 0) return null;

  const hrName = textOf(doc, CHAT_SELECTORS.chatTitle);
  const jobTitle = textOf(doc, HEADER.jobTitle);
  const company = textOf(doc, HEADER.company);
  const jobId = chatIdFromUrl() || hash32(hrName + jobTitle);

  return { jobId, jobTitle, company, hrName, messages };
}
