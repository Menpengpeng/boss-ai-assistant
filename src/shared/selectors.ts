/**
 * 页面选择器规则表 + 启发式兜底工具。
 *
 * 设计原则：真实 zhipin.com 的类名无法穷举且会随版本变化，因此每个字段给出一组候选选择器，
 * 数组内「最可能命中」的排在前面，由 qs/qsa/textOf/attrOf 依序尝试。
 * 候选同时覆盖：精确类名（如 .job-sec-text）、类名包含匹配（[class*="xxx"]）与 data-* 属性。
 */

/** 选择器分组（用于调试与日志展示）。 */
export interface SelectorGroup {
  name: string;
  selectors: string[];
}

/** 登录态相关选择器。 */
export const AUTH_SELECTORS: { loggedIn: string[]; loginButton: string[] } = {
  loggedIn: [
    '.user-nav',
    '[class*="user-nav"]',
    '.nav-figure',
    '[class*="nav-figure"]',
    '.header-user',
    '[class*="header-user"]',
    '.user-info',
    '[class*="user-info"]',
    '.figure',
    '[class*="figure"]',
    '[data-user-id]',
    '[data-uid]',
    'img.avatar',
    '[class*="avatar"]',
  ],
  loginButton: [
    '.btn-login',
    '[class*="btn-login"]',
    '.nav-login',
    '[class*="nav-login"]',
    'a[href*="login"]',
    '[ka*="login"]',
    '[class*="login"]',
  ],
};

/** 职位详情页字段选择器。 */
export const DETAIL_SELECTORS: {
  title: string[];
  salary: string[];
  company: string[];
  city: string[];
  experience: string[];
  education: string[];
  tags: string[];
  jd: string[];
  hrName: string[];
  jobId: string[];
  jobIdAttrs: string[];
} = {
  title: [
    '.job-name',
    '[class*="job-name"]',
    '.job-detail .name h1',
    '.job-title',
    '[class*="job-title"]',
    '.name h1',
    'h1',
  ],
  salary: [
    '.salary',
    '[class*="salary"]',
    '.job-salary',
    '[class*="job-salary"]',
    '.job-detail .text-salary',
  ],
  company: [
    // 真实详情页右侧公司卡片的链接带 ka 属性（排除 logo 链接，其文本为空）；
    // 注意详情页顶部职位标题容器的 class 也是 company-info，靠顺序前置规避
    'a[ka^="job-detail-company"]:not([ka*="logo"])',
    '.sider-company a[title]',
    '.job-detail-company .name',
    '.company-info:not(:has(.job-title)) .name',
    '[class*="company-info"]:not(:has(.job-title)) .name',
  ],
  city: [
    '.job-area',
    '[class*="job-area"]',
    '.text-city',
    '[class*="city"]',
    '.job-primary .text-city',
  ],
  experience: [
    '.job-experience',
    '[class*="job-experience"]',
    '[class*="experience"]',
    '.job-limit .text',
  ],
  education: [
    '.job-degree',
    '[class*="job-degree"]',
    '[class*="degree"]',
    '[class*="education"]',
  ],
  tags: [
    '.job-keyword-list li',
    '[class*="keyword-list"] li',
    '.job-tags span',
    '[class*="tag-list"] li',
    '.tag-all .tag-item',
    '[class*="tag"] span',
  ],
  jd: [
    '.job-sec-text',
    '[class*="job-sec-text"]',
    '.job-detail-section .text',
    '.detail-content .text',
    '.job-detail .text',
    '[class*="job-detail"] .text',
  ],
  hrName: [
    '.job-boss-info .name',
    '[class*="boss-info"] .name',
    '.boss-name',
    '[class*="boss-name"]',
    '.job-boss-info h2',
    '[class*="boss-info"] h2',
  ],
  jobId: ['[data-jobid]', '[data-job-id]', '[data-lid]', '.job-detail'],
  jobIdAttrs: ['data-jobid', 'data-job-id', 'data-lid', 'data-jobId', 'data-id'],
};

/** 职位列表页选择器。 */
export const LIST_SELECTORS: {
  card: string[];
  link: string[];
  title: string[];
  company: string[];
  salary: string[];
  tags: string[];
  jobIdAttrs: string[];
} = {
  card: [
    '.job-card-wrapper',
    '[class*="job-card-wrapper"]',
    'li.job-card-wrapper',
    '.job-card-box',
    '[class*="job-card-box"]',
    '[class*="job-card"]',
    '.card-item',
  ],
  link: [
    'a.job-card-left',
    '[class*="job-card"] a',
    'a[href*="/job_detail/"]',
    'a[href*="job_detail"]',
  ],
  title: ['.job-name', '[class*="job-name"]', '.job-title', '[class*="job-title"]'],
  company: [
    '.company-name',
    '[class*="company-name"]',
    '.company-info .name',
    '[class*="company-info"] .name',
  ],
  salary: ['.salary', '[class*="salary"]', '.job-salary', '[class*="job-salary"]'],
  tags: [
    '.job-card-footer .tag-item',
    '[class*="tag-list"] span',
    '.tags span',
    '[class*="tag"] span',
  ],
  jobIdAttrs: ['data-jobid', 'data-job-id', 'data-lid', 'data-id'],
};

/** 聊天页选择器。 */
export const CHAT_SELECTORS: {
  listItem: string[];
  itemText: string[];
  itemFromMe: string[];
  input: string[];
  sendButton: string[];
  chatTitle: string[];
} = {
  listItem: [
    // 真实聊天页（/web/geek/chat）：消息条目是 .chat-record 下的 .message-item，
    // 我方消息额外带 .item-myself。刻意不收录 .chat-message / [class*="chat-message"]：
    // 真实页面输入框的 class 恰好是 "bosschat-chat-input chat-message"，会被误当作消息条目
    '.chat-record .message-item',
    '.message-item',
    '[class*="message-item"]',
    '.chat-record [class*="item-myself"]',
    '.msg-item',
    'li[class*="message"]',
  ],
  itemText: [
    '.message-content .text',
    '.message-content',
    '.text',
    '[class*="message-text"]',
    'p',
  ],
  itemFromMe: [
    '.item-myself',
    '[class*="myself"]',
    '[class*="from-me"]',
    '.message-myself',
    '.me',
  ],
  input: [
    // 真实页面输入框：class 含 bosschat-chat-input（textarea 或 contenteditable 两种形态都覆盖；
    // 该容器 class 还含 chat-message，与消息条目候选严格隔离，见 listItem 注释）
    'textarea[class*="chat-input"]',
    '[contenteditable="true"][class*="chat-input"]',
    '.bosschat-chat-input textarea',
    '.bosschat-chat-input [contenteditable="true"]',
    '#chat-input',
    '.chat-input textarea',
    '[class*="chat-input"] textarea',
    '[class*="chat-input"] [contenteditable="true"]',
    'textarea',
    '[contenteditable="true"]',
  ],
  sendButton: [
    '.btn-send',
    '[class*="btn-send"]',
    '.send-message',
    '[class*="send"] button',
    'button[type="submit"]',
  ],
  chatTitle: [
    '.chat-title',
    '[class*="chat-title"]',
    '.chat-header .name',
    '[class*="chat-header"] .name',
    '.friend-name',
  ],
};

/** 公司信息选择器。 */
export const COMPANY_SELECTORS: {
  name: string[];
  intro: string[];
  size: string[];
  industry: string[];
  financing: string[];
} = {
  // 真实详情页：公司名在右侧 .sider-company 卡片（a 带 ka 属性 / title 属性）；
  // 顶部职位标题容器的 class 恰好也是 company-info，且内部是 .name > .job-title，
  // 因此用 :not(:has(.job-title)) 排除，并让 ka 候选永远排在最前。
  // 刻意不收录裸 .company-name / [class*="company-name"]：相似职位推荐区用该类名放别家公司名。
  name: [
    'a[ka^="job-detail-company"]:not([ka*="logo"])',
    '.sider-company a[title]',
    '.company-info:not(:has(.job-title)) .name',
    '[class*="company-info"]:not(:has(.job-title)) .name',
  ],
  intro: [
    '.company-info .text',
    '[class*="company-info"] .text',
    '.company-intro',
    '[class*="company-intro"]',
    '.job-sec .text',
  ],
  // 真实详情页规模/行业在 .sider-company 的 p 内，靠图标 class 定位（Chrome 105+ 支持 :has）
  size: ['.sider-company p:has(.icon-scale)', '[class*="company-size"]:not(i)', '[class*="person-size"]:not(i)', '[class*="scale"]:not(i)'],
  // a[ka*="brandindustry"] 优先：避免 [class*="industry"] 首个命中 i.icon-industry（空文本）
  industry: ['a[ka*="brandindustry"]', '.sider-company p:has(.icon-industry)', '[class*="industry"]:not(i)', '[class*="trade"]:not(i)'],
  financing: ['.sider-company p:has(i[class*="finance"])', '.sider-company p:has(i[class*="stage"])', '[class*="financing"]:not(i)', '[class*="stage"]:not(i)', '[class*="finance-stage"]:not(i)'],
};

/** 页面类型识别的 URL 规则（针对 location.pathname）。 */
export const URL_PATTERNS: { jobDetail: RegExp; jobList: RegExp; chat: RegExp } = {
  jobDetail: new RegExp('^/job_detail/'),
  jobList: new RegExp('^/(web/geek/job|job/)'),
  chat: new RegExp('^/(web/geek/chat|chat/)'),
};

/**
 * 依序尝试选择器，返回首个命中的元素。
 * 单个选择器非法（不被支持）时静默跳过，避免影响其它候选。
 */
export function qs<T extends Element = Element>(root: ParentNode, selectors: string[]): T | null {
  for (const sel of selectors) {
    try {
      const el = root.querySelector(sel);
      if (el) return el as T;
    } catch {
      // 忽略非法选择器，继续尝试下一个候选
    }
  }
  return null;
}

/** 依序尝试选择器，返回首个有命中的选择器的全部结果。 */
export function qsa<T extends Element = Element>(root: ParentNode, selectors: string[]): T[] {
  for (const sel of selectors) {
    try {
      const list = root.querySelectorAll(sel);
      if (list.length > 0) return Array.from(list) as unknown as T[];
    } catch {
      // 忽略非法选择器，继续尝试下一个候选
    }
  }
  return [];
}

/** 压缩空白：换行/多空格统一为单个空格并 trim。 */
function squeeze(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 取元素文本（压缩空白）；未命中返回 ''。 */
export function textOf(root: ParentNode | null, selectors: string[]): string {
  if (!root) return '';
  const el = qs(root, selectors);
  if (!el) return '';
  return squeeze(el.textContent ?? '');
}

/** 依序尝试选择器与属性，返回首个非空属性值；未命中返回 ''。 */
export function attrOf(root: ParentNode | null, selectors: string[], attrs: string[]): string {
  if (!root) return '';
  const el = qs(root, selectors);
  if (!el) return '';
  for (const attr of attrs) {
    const value = el.getAttribute(attr);
    if (value) return squeeze(value);
  }
  return '';
}
