/**
 * 职位列表页解析器（F7 列表快评）。
 *
 * 规则：只用 src/shared/selectors.ts 的候选规则表；不足时在本文件内的 LOCAL_FALLBACK 追加兜底。
 * 未命中任何卡片返回 []。列表会重渲染，因此同时提供按 id 或 index 重新定位卡片的工具。
 */
import type { JobCard, JobInfo } from '../../shared/types';
import { hash32 } from '../../shared/cache-key';
import { LIST_SELECTORS, qs, qsa, textOf } from '../../shared/selectors';

/** 本地备用候选：shared 规则表未覆盖时兜底（仅本模块使用）。 */
const LOCAL_FALLBACK: {
  card: string[];
  link: string[];
  title: string[];
} = {
  card: ['.job-list .card-item', '.job-list-box .job-card-wrapper'],
  link: ['a[href*="/job_detail/"]', 'a[href*="job_detail"]'],
  title: ['.job-card-left .job-name', '.job-card-body .job-name'],
};

/** 卡片内链接的岗位 ID：/job_detail/xxxxx.html。 */
const HREF_JOB_ID = /\/job_detail\/([A-Za-z0-9_-]+)(?:\.html)?/;

/** 压缩空白：换行/多空格统一为单个空格并 trim。 */
function squeeze(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 相对路径补全为绝对 URL；失败时原样返回。 */
function toAbsolute(href: string): string {
  try {
    return new URL(href, location.href).href;
  } catch {
    return href;
  }
}

/** 收集结果集中的全部卡片元素（qsa 已按候选优先级短路）。 */
function collectCards(doc: Document): Element[] {
  return qsa<Element>(doc, [...LIST_SELECTORS.card, ...LOCAL_FALLBACK.card]);
}

/** 从 href 取岗位 ID；未命中返回 ''。 */
function jobIdFromHref(href: string): string {
  const matched = HREF_JOB_ID.exec(href);
  return matched ? matched[1] : '';
}

/** 从卡片自身属性取岗位 ID；未命中返回 ''。 */
function readJobIdAttr(el: Element): string {
  for (const attr of LIST_SELECTORS.jobIdAttrs) {
    const value = el.getAttribute(attr);
    if (value) return squeeze(value);
  }
  return '';
}

/** 卡片标题链（shared 优先，本地兜底）。 */
function cardTitle(el: Element): string {
  return textOf(el, [...LIST_SELECTORS.title, ...LOCAL_FALLBACK.title]);
}

/** 卡片链接元素。 */
function cardLink(el: Element): HTMLAnchorElement | null {
  return qs<HTMLAnchorElement>(el, [...LIST_SELECTORS.link, ...LOCAL_FALLBACK.link]);
}

/** 卡片标签：去空、去重、剔除超长噪声。 */
function cardTags(el: Element): string[] {
  const list = qsa<HTMLElement>(el, LIST_SELECTORS.tags);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const node of list) {
    const text = squeeze(node.textContent ?? '');
    if (!text || text.length > 20 || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

/** 计算指定卡片元素的稳定 ID：链接 jobId → 属性 jobId → 哈希兜底。 */
export function jobIdOfCardElement(el: Element, index: number): string {
  const fromHref = jobIdFromHref(cardLink(el)?.getAttribute('href') ?? '');
  if (fromHref) return fromHref;
  const fromAttr = readJobIdAttr(el);
  if (fromAttr) return fromAttr;
  const company = textOf(el, LIST_SELECTORS.company);
  const salary = textOf(el, LIST_SELECTORS.salary);
  return hash32(company + cardTitle(el) + salary + index);
}

/** 解析列表页全部卡片；未命中返回 []。 */
export function parseJobList(doc: Document = document): JobCard[] {
  const cards = collectCards(doc);
  return cards.map((el, index) => {
    const link = cardLink(el);
    const href = link?.getAttribute('href') ?? '';
    return {
      id: jobIdOfCardElement(el, index),
      index,
      title: cardTitle(el),
      company: textOf(el, LIST_SELECTORS.company),
      salary: textOf(el, LIST_SELECTORS.salary),
      tags: cardTags(el),
      url: href ? toAbsolute(href) : '',
    };
  });
}

/** 列表快评用：把卡片提升为 JobInfo（JD 取不到 → jd: []）。 */
export function jobInfoFromCard(card: JobCard): JobInfo {
  return {
    id: card.id,
    title: card.title,
    company: card.company,
    salary: card.salary,
    city: '',
    experience: '',
    education: '',
    tags: card.tags,
    jd: [],
    hrName: '',
    url: card.url,
    source: 'list',
  };
}

/**
 * 重新定位卡片元素（列表会重渲染）：
 * 先按稳定 ID 匹配，其次回退到 index。
 */
export function findCardElement(card: JobCard, doc: Document = document): Element | null {
  const cards = collectCards(doc);
  if (cards.length === 0) return null;
  for (let i = 0; i < cards.length; i += 1) {
    if (jobIdOfCardElement(cards[i], i) === card.id) return cards[i];
  }
  return cards[card.index] ?? null;
}
