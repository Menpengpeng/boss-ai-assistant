/**
 * 公司信息解析器（F10 公司分析）。
 *
 * 规则：只用 src/shared/selectors.ts 的候选规则表；不足时在本文件内的 LOCAL_FALLBACK 追加兜底。
 * 全部字段为空时 parseCompany 返回 null；intro 截断到 2000 字。
 */
import { COMPANY_SELECTORS, attrOf, qs, textOf } from '../../shared/selectors';

/** 页面公司信息（非权威核实，仅基于当前 DOM）。 */
export interface CompanyPageInfo {
  name: string;
  intro: string;
  size: string;
  industry: string;
  financing: string;
}

/** 本地备用候选：shared 规则表未覆盖时兜底（仅本模块使用）。 */
const LOCAL_FALLBACK: {
  name: string[];
  intro: string[];
  link: string[];
} = {
  name: ['.company-detail .name', '.company-header .name'],
  intro: ['.company-detail .text', '.company-desc', '[class*="company-desc"]'],
  link: ['a[href*="/gongsi/"]'],
};

/** 详情页右侧公司卡片链接（ka 属性最稳，排除纯 logo 链接）。 */
const CARD_LINK = 'a[ka^="job-detail-company"]:not([ka*="logo"])';

/** intro 最大保留长度。 */
const INTRO_MAX = 2000;

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

/** 工商信息区块里的公司全称：li.company-name 的 textContent 形如「公司名称XXX」，需剥离字段名前缀。 */
function businessName(doc: Document): string {
  const li = qs(doc, ['.business-info-box .company-name', 'li.company-name']);
  if (!li) return '';
  const clone = li.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('span').forEach((span) => span.remove());
  return squeeze(clone.textContent ?? '');
}

/** 按「公司介绍」标题定位介绍正文：克隆区块后移除标题元素再取文本（页面 class 改版时仍可命中）。 */
function introByHeading(doc: Document): string {
  const heads = Array.from(doc.querySelectorAll('h2, h3, h4'));
  const head = heads.find((h) => squeeze(h.textContent ?? '') === '公司介绍');
  if (!head) return '';
  const section = head.closest('.job-sec, .detail-section-item, [class*="job-sec"]') ?? head.parentElement;
  if (!section) return '';
  const clone = section.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('h2, h3, h4').forEach((h) => h.remove());
  return squeeze(clone.textContent ?? '');
}

/** 公司名称取值链：卡片链接文本 → 链接 title 属性 → 规则表候选 → 工商信息全称。 */
function pickName(doc: Document): string {
  const direct = textOf(doc, [...COMPANY_SELECTORS.name, ...LOCAL_FALLBACK.name]);
  if (direct) return direct;
  const viaTitle = attrOf(doc, [CARD_LINK, '.sider-company a[title]'], ['title']);
  if (viaTitle) return viaTitle;
  return businessName(doc);
}

/** 解析公司信息；全部字段为空返回 null。 */
export function parseCompany(doc: Document = document): CompanyPageInfo | null {
  const name = pickName(doc);
  const intro = (textOf(doc, [...COMPANY_SELECTORS.intro, ...LOCAL_FALLBACK.intro]) || introByHeading(doc)).slice(0, INTRO_MAX);
  const size = textOf(doc, COMPANY_SELECTORS.size);
  const industry = textOf(doc, COMPANY_SELECTORS.industry);
  const financing = textOf(doc, COMPANY_SELECTORS.financing);

  if (!name && !intro && !size && !industry && !financing) return null;
  return { name, intro, size, industry, financing };
}

/** 详情页里公司链接的绝对 URL；取不到返回 ''。 */
export function findCompanyDetailLink(doc: Document = document): string {
  const anchor = qs<HTMLAnchorElement>(doc, [
    ...LOCAL_FALLBACK.link,
    '.company-info a',
    '[class*="company-info"] a',
    '.company-name a',
    '[class*="company-name"] a',
    '.company-info .name a',
  ]);
  const href = anchor?.getAttribute('href') ?? '';
  return href ? toAbsolute(href) : '';
}
