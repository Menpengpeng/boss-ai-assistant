// 主构建配置：负责 background（ESM service worker）与 options 页 HTML。
// content script 由 vite.content.config.ts 单独打成 IIFE 经典脚本。
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { manifest } from './manifest.config';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

/**
 * 内联插件：在打包结束后把 manifest 序列化写入 dist/manifest.json。
 * 显式以无 BOM 的 utf8 写出：Chrome/Edge 的 JSON 解析器不接受 BOM。
 */
function writeManifestPlugin() {
  return {
    name: 'boss-ai-write-manifest',
    writeBundle() {
      const outDir = resolve(rootDir, 'dist');
      mkdirSync(outDir, { recursive: true });
      const target = resolve(outDir, 'manifest.json');
      writeFileSync(target, JSON.stringify(manifest, null, 2), 'utf8');
      // 自检：确保落盘的首字节不是 BOM
      const bytes = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
      if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        throw new Error('[boss-ai] manifest.json 不能带 BOM');
      }
      console.log('[boss-ai] wrote dist/manifest.json');
    },
  };
}

export default defineConfig({
  plugins: [react(), writeManifestPlugin()],
  // 使用相对路径，扩展页面通过 chrome-extension:// 加载时也能正确解析资源
  base: './',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      input: {
        // 项目根的 options.html 会被原样输出为 dist/options.html
        options: resolve(rootDir, 'options.html'),
        background: resolve(rootDir, 'src/background/index.ts'),
      },
      output: {
        // background 必须是 dist/background.js（manifest 以此引用）
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
