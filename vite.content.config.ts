// content script 专用构建配置。
// MV3 的 content_scripts 不支持 ESM，必须输出单文件 IIFE 经典脚本（无 import/export 语句）。
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  // 关键：lib 模式的 IIFE 构建不会自动替换 process.env.NODE_ENV，
  // 而 content script 运行在页面源下没有 process 全局（真机会直接抛 ReferenceError），
  // 因此必须在这里静态替换为 "production"。
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  build: {
    outDir: 'dist',
    // 主配置已清空过 dist，此处必须保留 background/options 产物
    emptyOutDir: false,
    // 图标由主构建拷贝，这里不再重复拷贝
    copyPublicDir: false,
    target: 'es2022',
    sourcemap: false,
    // 后续 content 侧样式将以内联 CSS 字符串注入 Shadow DOM，不产出独立 css 资源
    cssCodeSplit: false,
    lib: {
      entry: resolve(rootDir, 'src/content/index.ts'),
      name: 'BossAiContent',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
    rollupOptions: {
      output: {
        // 单文件输出：所有动态导入内联，确保产物无 chunk 依赖
        inlineDynamicImports: true,
        extend: true,
      },
    },
  },
});
