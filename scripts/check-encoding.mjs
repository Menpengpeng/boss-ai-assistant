// 编码检查：遍历项目源码/配置/文档，校验文件为 UTF-8 with BOM 且不含 U+FFFD 替换字符。
// 排除：node_modules、dist、release、.git、doc（只读历史资产，非本工程源码）、package-lock.json。
// 发现问题文件时打印路径并以非零码退出。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, relative, extname, basename } from 'node:path';

const rootDir = fileURLToPath(new URL('..', import.meta.url));

const EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'release', '.git', 'doc']);
// package-lock.json 由 npm 生成（无 BOM）；
// package.json 必须保持无 BOM：Vite 5 与 postcss-load-config 会用 JSON.parse 直接读取它，
// 带 BOM 会导致 "Unexpected token ﻿ in JSON at position 0"，并使 Vite 误判配置为 CJS。
// 二者均为合法 UTF-8，此处仅豁免 BOM 校验。
const EXCLUDED_FILES = new Set(['package-lock.json', 'package.json']);
// 仅检查文本类文件，避免对 PNG 等二进制资源误报
const TEXT_EXTS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.html',
  '.css',
  '.md',
  '.txt',
  '.yml',
  '.yaml',
  '.svg',
]);
// 无扩展名但属于配置文本的文件
const TEXT_FILENAMES = new Set(['.gitignore']);

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const REPLACEMENT = '\uFFFD';

const bad = [];
let checked = 0;

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      walk(resolve(dir, entry.name));
      continue;
    }
    if (!entry.isFile()) continue;

    const full = resolve(dir, entry.name);
    if (EXCLUDED_FILES.has(entry.name)) continue;
    if (!TEXT_EXTS.has(extname(entry.name)) && !TEXT_FILENAMES.has(basename(entry.name))) continue;
    if (statSync(full).size === 0) continue;

    checked++;
    const buf = readFileSync(full);
    const hasBom = buf.length >= 3 && buf.subarray(0, 3).equals(BOM);
    const text = buf.toString('utf8');
    const hasReplacement = text.includes(REPLACEMENT);

    if (!hasBom || hasReplacement) {
      bad.push({
        file: relative(rootDir, full).replace(/\\/g, '/'),
        reason: [
          !hasBom ? '缺少 UTF-8 BOM(EF BB BF)' : null,
          hasReplacement ? `包含替换字符 ${REPLACEMENT}` : null,
        ]
          .filter(Boolean)
          .join('；'),
      });
    }
  }
}

walk(rootDir);

if (bad.length > 0) {
  console.error(`[boss-ai] 编码检查未通过，问题文件 ${bad.length} 个（共检查 ${checked} 个）：`);
  for (const item of bad) {
    console.error(`  - ${item.file}：${item.reason}`);
  }
  process.exit(1);
}

console.log(`[boss-ai] 编码检查通过：共检查 ${checked} 个文件，全部为 UTF-8 with BOM 且无乱码。`);
