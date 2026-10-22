// 构建编排（纯 Node）：清空 dist → 主构建 → content 构建 → 生成图标。
// 顺序执行，任一步失败即以非零码退出。
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const distDir = resolve(rootDir, 'dist');

function run(command) {
  const result = spawnSync(command, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: true, // Windows 下通过 shell 解析 node_modules/.bin 中的可执行文件
  });
  if (result.status !== 0) {
    console.error(`[boss-ai] 命令失败(${result.status}): ${command}`);
    process.exit(result.status ?? 1);
  }
}

// 1) 清空 dist（保证无残留旧产物）
if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true, force: true });
}

// 2) 主构建：background（ESM service worker）+ options 页 + manifest.json + public 资源
run('vite build -c vite.config.ts');

// 3) content 构建：IIFE 经典脚本 dist/content.js（emptyOutDir: false，保留上一步产物）
run('vite build -c vite.content.config.ts');

// 4) 图标：确保 public/icons 存在（正常情况下主构建已由 Vite 拷贝到 dist/icons）
run('node scripts/gen-icons.mjs');

console.log('[boss-ai] build done -> dist/');
