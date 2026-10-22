// 程序化生成品牌图标（纯 Node，零依赖，手写 PNG 编码器）。
//
// 设计：品牌色 #0B7074 圆角方块 + 白色大写字母 "B" 字形（5x7 点阵字模），四周留约 14% 留白。
// 每个尺寸都按「矢量方式」重新光栅化（含 4x4 超采样抗锯齿），而不是缩放 128 位图，避免模糊。
// 产物：public/icons/icon{16,32,48,128}.png（Vite 会自动拷贝到 dist/icons/）。

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const outDir = resolve(rootDir, 'public', 'icons');

/** 品牌色 #0B7074 */
const BRAND = { r: 0x0b, g: 0x70, b: 0x74 };
const WHITE = { r: 0xff, g: 0xff, b: 0xff };

// 5x7 点阵字模：'1' 表示填充像素。品牌字形为大写字母 B。
const GLYPH_B = ['11110', '10001', '10001', '11110', '10001', '10001', '11110'];

const GLYPH_ROWS = 7;
const GLYPH_W = 5;
/** 单字母字形，无字母间距。 */
const GLYPH_COLS = GLYPH_W;

/** 取字形第 col 列、第 row 行是否为填充像素。 */
function glyphPixel(col, row) {
  if (col < 0 || row < 0 || row >= GLYPH_ROWS || col >= GLYPH_COLS) return false;
  return GLYPH_B[row][col] === '1';
}

/** 圆角矩形内部判定（坐标为 0..1 归一化）。 */
function inRoundedRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

/** 将单个尺寸的图标光栅化为 RGBA 像素数据。 */
function rasterize(size, supersample = 4) {
  const padding = 0.14; // 四周留白
  const rectSize = 1 - padding * 2;
  const rectLeft = padding;
  const rectTop = padding;
  const rectRight = 1 - padding;
  const rectBottom = 1 - padding;
  const radius = 0.16; // 圆角半径（相对整幅尺寸）

  const glyphHeightFrac = 0.56; // 单字母字形总高占整幅尺寸比例（比双字母更大，保证 16px 下可读）
  const block = glyphHeightFrac / GLYPH_ROWS; // 单个点阵像素块边长（相对整幅尺寸）
  const glyphWidthFrac = block * GLYPH_COLS;
  const glyphLeft = (1 - glyphWidthFrac) / 2;
  const glyphTop = (1 - glyphHeightFrac) / 2;

  const pixels = Buffer.alloc(size * size * 4);
  const samples = supersample * supersample;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let aSum = 0;
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;

      for (let sy = 0; sy < supersample; sy++) {
        for (let sx = 0; sx < supersample; sx++) {
          const x = (px + (sx + 0.5) / supersample) / size;
          const y = (py + (sy + 0.5) / supersample) / size;

          let color = null;
          if (
            x >= glyphLeft &&
            y >= glyphTop &&
            x < glyphLeft + glyphWidthFrac &&
            y < glyphTop + glyphHeightFrac
          ) {
            const col = Math.floor((x - glyphLeft) / block);
            const row = Math.floor((y - glyphTop) / block);
            if (glyphPixel(col, row)) color = WHITE;
          }
          if (!color && inRoundedRect(x, y, rectLeft, rectTop, rectRight, rectBottom, radius)) {
            color = BRAND;
          }
          if (color) {
            aSum += 1;
            // 以预乘方式累加，避免边缘出现暗边
            rSum += color.r;
            gSum += color.g;
            bSum += color.b;
          }
        }
      }

      const idx = (py * size + px) * 4;
      if (aSum > 0) {
        pixels[idx] = Math.round(rSum / aSum);
        pixels[idx + 1] = Math.round(gSum / aSum);
        pixels[idx + 2] = Math.round(bSum / aSum);
        pixels[idx + 3] = Math.round((aSum / samples) * 255);
      }
    }
  }

  return pixels;
}

// ------------------------- PNG 编码器 -------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crcBuf]);
}

/** 把 RGBA 像素编码成 PNG 字节流（彩色类型 6，8 位深度）。 */
function encodePng(size, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); // width
  ihdr.writeUInt32BE(size, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter type: None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------- 主流程 -------------------------

function generate(size) {
  const rgba = rasterize(size);
  const png = encodePng(size, rgba);
  const file = resolve(outDir, `icon${size}.png`);
  writeFileSync(file, png);
  return { file, bytes: png.length };
}

function main() {
  mkdirSync(outDir, { recursive: true });
  for (const size of [16, 32, 48, 128]) {
    const { file, bytes } = generate(size);
    console.log(`[boss-ai] icon ${size} -> ${file} (${bytes} bytes)`);
  }
}

main();

// 供其他脚本/测试复用
export { rasterize, encodePng };
