// 打包脚本：把 dist/ 内的全部内容（不含外层 dist 目录）打包为
// release/boss-ai-edge-<version>.zip，version 取自 package.json。
import AdmZip from 'adm-zip';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, basename } from 'node:path';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const distDir = resolve(rootDir, 'dist');
const releaseDir = resolve(rootDir, 'release');

if (!existsSync(distDir)) {
  console.error('[boss-ai] 未找到 dist/，请先执行 npm run build');
  process.exit(1);
}

// package.json 可能带 BOM，读取后需剥掉再交给 JSON.parse
const pkgRaw = readFileSync(resolve(rootDir, 'package.json'), 'utf8').replace(/^\uFEFF/, '');
const { version } = JSON.parse(pkgRaw);

mkdirSync(releaseDir, { recursive: true });
const zipPath = resolve(releaseDir, `boss-ai-edge-${version}.zip`);
if (existsSync(zipPath)) rmSync(zipPath, { force: true });

const zip = new AdmZip();
// 第二参数 '' 表示把 dist 的内容放到压缩包根目录（不含 dist 外层目录）
zip.addLocalFolder(distDir, '');
zip.writeZip(zipPath);

const size = statSync(zipPath).size;
console.log(`[boss-ai] zip -> release/${basename(zipPath)} (${size} bytes)`);
