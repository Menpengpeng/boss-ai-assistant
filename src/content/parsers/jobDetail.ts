/**
 * 职位详情页解析器（F3）。
 *
 * 规则：只使用 src/shared/selectors.ts 的候选选择器；不足时在本文件内的 LOCAL_FALLBACK 追加兜底，
 * 不修改 shared 文件。标题或 JD 正文缺失时返回 null —— 这是 UI「解析失败 → 手动粘贴 JD」的触发点。
 */
import type { JobInfo } from '../../shared/types';
import { hash32 } from '../../shared/cache-key';
import { DETAIL_SELECTORS, attrOf, qs, qsa, textOf } from '../../shared/selectors';

/** 本地备用候选：shared 规则表未覆盖时兜底（仅本模块使用）。 */
const LOCAL_FALLBACK: {
  title: string[];
  salary: string[];
  company: string[];
  jd: string[];
  tags: string[];
} = {
  title: ['.job-primary .job-name', '.job-detail-box .name', 'h1.job-name'],
  salary: ['.job-primary .salary', '.job-info .salary'],
  // 注意：不能用 a[href*="/gongsi/"] —— 它会命中顶部导航的「公司」链接（真实页面已验证）
  company: ['.job-detail-company .name'],
  jd: ['.job-detail-section .job-sec-text', '.job-sec .job-sec-text', 'article.job-detail .text'],
  tags: ['.job-tags .tag-item', '.job-keyword-list span'],
};

/** 标签噪声阈值：超过该长度的文本视为非标签。 */
const MAX_TAG_LEN = 20;

/** URL 中的岗位 ID：/job_detail/xxxxx.html。 */
const URL_JOB_ID = /\/job_detail\/([A-Za-z0-9_-]+)(?:\.html)?/;

/** 压缩空白：换行/多空格统一为单个空格并 trim。 */
function squeeze(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 把 shared 候选与本地兜底候选拼成一条尝试链。 */
function chain(primary: string[], fallback: string[]): string[] {
  return [...primary, ...fallback];
}

/**
 * 提取 JD 段落：
 * 优先按块级子元素切分（真实页面常以 div/p 分段），否则按换行切分；
 * 逐段 trim、压缩空白并去空行。
 */
function extractJd(root: ParentNode): string[] {
  const el = qs(root, chain(DETAIL_SELECTORS.jd, LOCAL_FALLBACK.jd));
  if (!el) return [];
  const blocks = Array.from(el.children).filter((child) =>
    ['DIV', 'P', 'LI', 'SECTION', 'ARTICLE'].includes(child.tagName),
  );
  if (blocks.length > 1) {
    return blocks.map((b) => squeeze(b.textContent ?? '')).filter(Boolean);
  }
  return (el.textContent ?? '')
    .split(/\r?\n+/)
    .map(squeeze)
    .filter(Boolean);
}

/** 提取标签：去空、去重、剔除超长噪声文本。 */
function extractTags(root: ParentNode): string[] {
  const list = qsa<HTMLElement>(root, chain(DETAIL_SELECTORS.tags, LOCAL_FALLBACK.tags));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const el of list) {
    const text = squeeze(el.textContent ?? '');
    if (!text || text.length > MAX_TAG_LEN || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

/** 从 URL 路径取岗位 ID；未命中返回 ''。 */
function jobIdFromUrl(): string {
  const matched = URL_JOB_ID.exec(location.href);
  return matched ? matched[1] : '';
}

/** 从 jobIdAttrs 指向的属性取岗位 ID；未命中返回 ''。 */
function jobIdFromAttr(root: ParentNode): string {
  return attrOf(root, DETAIL_SELECTORS.jobId, DETAIL_SELECTORS.jobIdAttrs);
}

/** 解析职位详情页；标题与 JD 至少一个段落都缺失时返回 null。 */
export function parseJobDetail(doc: Document = document): JobInfo | null {
  const title = textOf(doc, chain(DETAIL_SELECTORS.title, LOCAL_FALLBACK.title));
  const jd = extractJd(doc);
  if (!title || jd.length === 0) return null;

  const company = textOf(doc, chain(DETAIL_SELECTORS.company, LOCAL_FALLBACK.company));
  const salary = textOf(doc, chain(DETAIL_SELECTORS.salary, LOCAL_FALLBACK.salary));
  const city = textOf(doc, DETAIL_SELECTORS.city);
  const experience = textOf(doc, DETAIL_SELECTORS.experience);
  const education = textOf(doc, DETAIL_SELECTORS.education);
  const tags = extractTags(doc);
  const hrName = textOf(doc, DETAIL_SELECTORS.hrName);

  const id = jobIdFromUrl() || jobIdFromAttr(doc) || hash32(company + title + salary);

  return {
    id,
    title,
    company,
    salary,
    city,
    experience,
    education,
    tags,
    jd,
    hrName,
    url: location.href,
    source: 'detail',
  };
}
