// 测试辅助：读取 UTF-8 with BOM 的 fixture HTML 并解析为 Document。
// 注意：解析前剥离 BOM，避免 \uFEFF 作为文本节点污染 DOM。
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** 读取 fixtures/ 下的 HTML 片段并解析为 Document。 */
export function loadHtml(name: string): Document {
  const raw = readFileSync(resolve(HERE, 'fixtures', name), 'utf8').replace(/^\uFEFF/, '');
  return new DOMParser().parseFromString(raw, 'text/html');
}

/** 用内联 HTML 字符串构造 Document（失败用例用）。 */
export function parseInline(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}
