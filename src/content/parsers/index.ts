/**
 * 解析器统一出口 + 页面类型识别 + 手动粘贴 JD 兜底。
 *
 * 供 content 侧其它模块（登录门控 / 侧栏）统一 import，避免各自引用具体解析器文件。
 */
import type { JobInfo, PageKind } from '../../shared/types';
import { hash32 } from '../../shared/cache-key';
import { URL_PATTERNS } from '../../shared/selectors';

export { parseJobDetail } from './jobDetail';
export { parseJobList, jobInfoFromCard, findCardElement, jobIdOfCardElement } from './jobList';
export { parseChat, parseChatMessages, takeRecentMessages, chatContextOf } from './chat';
export { parseCompany, findCompanyDetailLink } from './company';
export type { CompanyPageInfo } from './company';

/**
 * 用 URL 识别页面类型（默认取 location.href）。
 * 容错：优先判定聊天页，聊天与详情同时命中时聊天优先；都不命中返回 'other'。
 */
export function detectPageKind(url?: string): PageKind {
  const href = url ?? (typeof location === 'undefined' ? '' : location.href);
  let pathname = href;
  try {
    pathname = new URL(href, 'https://www.zhipin.com').pathname;
  } catch {
    pathname = href;
  }
  if (URL_PATTERNS.chat.test(pathname)) return 'chat';
  if (URL_PATTERNS.jobDetail.test(pathname)) return 'jobDetail';
  if (URL_PATTERNS.jobList.test(pathname)) return 'jobList';
  return 'other';
}

/** 构造「手动粘贴 JD」兜底 JobInfo：source 固定为 'manual'，jd 按换行切分。 */
export function buildManualJob(text: string, base: Partial<JobInfo> = {}): JobInfo {
  const jd = (text ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const title = base.title ?? '';
  const company = base.company ?? '';
  const salary = base.salary ?? '';

  return {
    id: base.id ?? hash32(company + title + salary + jd.join('')),
    title,
    company,
    salary,
    city: base.city ?? '',
    experience: base.experience ?? '',
    education: base.education ?? '',
    tags: base.tags ?? [],
    jd,
    hrName: base.hrName ?? '',
    url: base.url ?? '',
    source: 'manual',
  };
}
