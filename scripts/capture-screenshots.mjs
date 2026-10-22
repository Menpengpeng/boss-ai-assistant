/**
 * 商店截图抓取（Task 13.2 素材部分）：用 CDP 驱动 Edge + dist/ 解包扩展，
 * 把 https://www.zhipin.com/* 映射到本地 fixture 页面，抓取 1280×800 的 PNG 截图。
 *
 * 为什么自包含：e2e-edge.mjs 是顶层直接执行 main() 的脚本（无导出、import 即执行），
 * 直接 import 会连带跑一遍 E2E；因此这里复制其「最小 WebSocket + CDP 客户端 + Fetch
 * 请求拦截」实现，保证不触碰、不改变 e2e-edge.mjs 的既有行为。
 *
 * 截图口径（如实说明）：
 * - 页面部分为本工程的测试 fixture（非真实 zhipin.com 页面），为可读性额外注入了一份
 *   本地「演示样式」（见 DEMO_CSS），不使用任何真实站点 CSS，也不伪造岗位数据；
 * - 侧栏 / 选项页为扩展的真实运行产物（真实渲染、真实交互）；
 * - 未配置 API Key，故侧栏呈「未配置」状态，证明不配置 Key 不会发起任何模型请求。
 *
 * 用法：node scripts/capture-screenshots.mjs [--headed] [--keep]
 * 退出码：全部截图成功为 0，否则 1。
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DIST = resolve(ROOT, 'dist');
const FIXTURES = resolve(ROOT, 'src/content/parsers/__tests__/fixtures');
const OUT_DIR = resolve(ROOT, 'release/screenshots');

const SHOT_W = 1280;
const SHOT_H = 800;

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'msedge',
];

const KEEP = process.argv.includes('--keep');
const HEADED = process.argv.includes('--headed');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 空闲端口。 */
function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => res(port));
    });
  });
}

/* ------------------------------------------------------------------ *
 * 最小 WebSocket 客户端（复制自 e2e-edge.mjs，仅保留 CDP 必需能力）
 * ------------------------------------------------------------------ */
function createWebSocket(rawUrl) {
  const u = new URL(rawUrl);
  const port = Number(u.port || 80);
  const path = u.pathname + u.search;
  const key = randomBytes(16).toString('base64');
  const socket = connect(port, u.hostname);

  let handshakeDone = false;
  let buffer = Buffer.alloc(0);
  let fragOpcode = 0;
  let fragParts = [];
  const openHandlers = [];
  const messageHandlers = [];
  const closeHandlers = [];
  let closed = false;

  const emitClose = (reason) => {
    if (closed) return;
    closed = true;
    closeHandlers.forEach((fn) => fn(reason));
  };

  function sendFrame(opcode, payload) {
    const mask = randomBytes(4);
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[1] = 0x80 | len;
    } else if (len <= 65535) {
      header = Buffer.alloc(4);
      header[1] = 0x80 | 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x80 | opcode;
    const masked = Buffer.alloc(len);
    for (let i = 0; i < len; i += 1) masked[i] = payload[i] ^ mask[i % 4];
    socket.write(Buffer.concat([header, mask, masked]));
  }

  function parseFrames() {
    for (;;) {
      if (buffer.length < 2) return;
      const b0 = buffer[0];
      const b1 = buffer[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buffer.length < 4) return;
        len = buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buffer.length < 10) return;
        len = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }
      let maskKey = null;
      if (masked) {
        if (buffer.length < offset + 4) return;
        maskKey = buffer.subarray(offset, offset + 4);
        offset += 4;
      }
      if (buffer.length < offset + len) return;
      let payload = Buffer.from(buffer.subarray(offset, offset + len));
      buffer = buffer.subarray(offset + len);
      if (masked && maskKey) {
        for (let i = 0; i < payload.length; i += 1) payload[i] ^= maskKey[i % 4];
      }
      if (opcode === 0x8) {
        emitClose('服务端关闭连接');
        return;
      }
      if (opcode === 0x9) {
        sendFrame(0xa, payload);
        continue;
      }
      if (opcode === 0xa) continue;
      if (opcode === 0x0) {
        fragParts.push(payload);
        if (fin) {
          const full = Buffer.concat(fragParts);
          fragParts = [];
          if (fragOpcode === 1) messageHandlers.forEach((fn) => fn(full.toString('utf8')));
        }
        continue;
      }
      if (opcode === 1 || opcode === 2) {
        if (!fin) {
          fragOpcode = opcode;
          fragParts = [payload];
          continue;
        }
        if (opcode === 1) messageHandlers.forEach((fn) => fn(payload.toString('utf8')));
      }
    }
  }

  socket.on('connect', () => {
    socket.write(
      `GET ${path} HTTP/1.1\r\n` +
        `Host: ${u.hostname}:${port}\r\n` +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Key: ${key}\r\n` +
        'Sec-WebSocket-Version: 13\r\n\r\n',
    );
  });
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (!handshakeDone) {
      const idx = buffer.indexOf('\r\n\r\n');
      if (idx < 0) return;
      const head = buffer.subarray(0, idx).toString('utf8');
      buffer = buffer.subarray(idx + 4);
      const statusLine = head.split('\r\n')[0];
      if (!/ 101 /.test(statusLine)) {
        emitClose(`WebSocket 握手失败：${statusLine}`);
        return;
      }
      handshakeDone = true;
      openHandlers.forEach((fn) => fn());
    }
    parseFrames();
  });
  socket.on('error', (e) => emitClose(`socket 错误：${e.message}`));
  socket.on('close', () => emitClose('socket 关闭'));

  return {
    onOpen(fn) {
      openHandlers.push(fn);
    },
    onMessage(fn) {
      messageHandlers.push(fn);
    },
    onClose(fn) {
      closeHandlers.push(fn);
    },
    send(text) {
      sendFrame(0x1, Buffer.from(text, 'utf8'));
    },
    close() {
      try {
        sendFrame(0x8, Buffer.alloc(0));
      } catch {
        /* 忽略 */
      }
      socket.destroy();
    },
  };
}

/** CDP 客户端（复制自 e2e-edge.mjs）。 */
function createCdp(ws) {
  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();

  ws.onMessage((text) => {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve: res, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`CDP ${msg.error.code}: ${msg.error.message}`));
      else res(msg.result);
      return;
    }
    if (msg.method) listeners.forEach((fn) => fn(msg));
  });

  return {
    send(method, params = {}, sessionId) {
      const id = nextId;
      nextId += 1;
      return new Promise((res, rej) => {
        pending.set(id, { resolve: res, reject: rej });
        const payload = { id, method, params };
        if (sessionId) payload.sessionId = sessionId;
        ws.send(JSON.stringify(payload));
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            rej(new Error(`CDP 调用超时：${method}`));
          }
        }, 20000);
      });
    },
    on(fn) {
      listeners.add(fn);
    },
  };
}

/* ------------------------------------------------------------------ *
 * fixture 渲染（仅截图用）
 * ------------------------------------------------------------------ */

/**
 * 演示样式：只为让 fixture 页面在截图中可读（浅色卡片布局 + 隐藏测试噪声块）。
 * 不是 zhipin.com 的真实样式，也不含任何真实品牌资源。
 */
const DEMO_CSS = `
*{box-sizing:border-box}
body{margin:0;background:#f4f6f8;color:#1f2329;font:14px/1.65 "Microsoft YaHei","PingFang SC",system-ui,sans-serif}
h1,h2,h3{margin:0}
.header-ad,.recommend-list,.ad-banner,.ad-slot,.job-card-skeleton{display:none !important}
.job-detail{max-width:840px;margin:24px auto;background:#fff;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.06);padding:24px 28px}
.job-name{font-size:22px;font-weight:700;display:inline-block;margin:0 16px 4px 0}
.salary{color:#d93a2a;font-weight:700;font-size:20px}
.job-area,.job-experience,.job-degree{color:#6b7785;margin-right:12px;font-size:13px}
.job-keyword-list{list-style:none;padding:0;margin:16px 0;display:flex;flex-wrap:wrap;gap:8px}
.job-keyword-list li{background:#eef2f6;color:#4b5b6b;border-radius:4px;padding:2px 10px;font-size:12px}
.job-sec-text{border-top:1px solid #eef0f2;margin-top:16px;padding-top:16px;color:#31404e}
.job-sec-text p{margin:0 0 10px}
.job-boss-info{margin-top:20px;border-top:1px solid #eef0f2;padding-top:16px}
.job-boss-info .name{font-size:16px}
.boss-title{color:#6b7785;font-size:12px;margin-left:8px}
.company-info{margin-top:12px;font-size:15px;font-weight:600}
.company-info a{color:#0b7074;text-decoration:none}
.job-list-box{max-width:860px;margin:24px auto}
.job-list{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:12px}
.job-card-wrapper{background:#fff;border:1px solid #e8ecef;border-radius:10px;padding:16px 20px;display:flex;flex-direction:column;gap:8px}
.job-card-left{display:flex;align-items:baseline;justify-content:space-between;gap:16px;text-decoration:none;color:inherit}
.job-card-left .job-name{font-size:16px;font-weight:600}
.company-name{font-size:14px;font-weight:500;color:#31404e}
.job-card-footer{display:flex;gap:8px;flex-wrap:wrap}
.tag-item{background:#eef2f6;color:#4b5b6b;border-radius:4px;padding:2px 8px;font-size:12px}
.chat-header{max-width:900px;margin:24px auto 0;background:#fff;border-radius:10px 10px 0 0;padding:14px 20px;border-bottom:1px solid #eef0f2}
.chat-title .name{font-size:16px;font-weight:600}
.chat-position{color:#6b7785;font-size:12px}
.chat-record{max-width:900px;margin:0 auto;background:#fff;padding:16px 20px;display:flex;flex-direction:column;gap:12px;min-height:340px}
.chat-message{display:flex;flex-direction:column;max-width:70%;background:#f2f5f7;border-radius:10px;padding:8px 12px;align-self:flex-start;font-size:13px}
.chat-message.item-myself{align-self:flex-end;background:#ddf3f3;color:#0b7074}
.message-time{font-size:11px;color:#93a0ab;margin-top:2px}
.avatar{display:none}
.chat-input{max-width:900px;margin:0 auto;background:#fff;border-radius:0 0 10px 10px;padding:12px 20px 20px;display:flex;gap:10px;border-top:1px solid #eef0f2}
.chat-input textarea{flex:1;min-height:64px;border:1px solid #d5dbe0;border-radius:8px;padding:8px 10px;font:inherit;resize:none}
.chat-input .btn-send{min-width:88px;border:0;border-radius:8px;background:#0b7074;color:#fff;font-size:14px}
`;

/** 读取 fixture 并注入演示样式 + 离屏「已登录」标志（保留布局盒，不进入截图画面）。 */
function pageHtml(name) {
  let raw = readFileSync(resolve(FIXTURES, name), 'utf8').replace(/^\uFEFF/, '');
  const styleTag = `<style>${DEMO_CSS}</style>`;
  raw = raw.includes('</head>') ? raw.replace('</head>', `${styleTag}</head>`) : styleTag + raw;
  const loginFlag =
    '<div class="user-nav" id="e2e-login-flag" style="position:fixed;left:-9999px;top:0">已登录</div>';
  raw = raw.includes('</body>') ? raw.replace('</body>', `${loginFlag}</body>`) : raw + loginFlag;
  return raw;
}

/** 按路径选择 fixture。 */
function fixtureFor(url) {
  const path = new URL(url).pathname;
  if (path.startsWith('/job_detail/')) return 'job-detail.html';
  if (path.startsWith('/web/geek/chat') || path.startsWith('/chat/')) return 'chat.html';
  if (path.startsWith('/web/geek/job') || path.startsWith('/job/')) return 'job-list.html';
  return 'job-detail.html';
}

/** Fetch.requestPaused → 用本地 fixture 兑现 zhipin 请求，其余子资源返回空 200。 */
function makeFulfiller(cdp, sessionId) {
  return (params) => {
    const { requestId, request, resourceType } = params;
    const url = request.url;
    if (!url.startsWith('https://www.zhipin.com/')) {
      void cdp.send('Fetch.continueRequest', { requestId }, sessionId).catch(() => undefined);
      return;
    }
    if (resourceType === 'Document') {
      const body = Buffer.from(pageHtml(fixtureFor(url)), 'utf8').toString('base64');
      void cdp
        .send(
          'Fetch.fulfillRequest',
          {
            requestId,
            responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
            body,
          },
          sessionId,
        )
        .catch(() => undefined);
      return;
    }
    void cdp
      .send(
        'Fetch.fulfillRequest',
        {
          requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }],
          body: Buffer.from('', 'utf8').toString('base64'),
        },
        sessionId,
      )
      .catch(() => undefined);
  };
}

/* ------------------------------------------------------------------ *
 * 浏览器生命周期
 * ------------------------------------------------------------------ */
function findEdge() {
  for (const candidate of EDGE_CANDIDATES) {
    if (candidate === 'msedge' || existsSync(candidate)) return candidate;
  }
  return null;
}

async function waitForDevtools(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return await res.json();
    } catch {
      /* 尚未就绪 */
    }
    await sleep(300);
  }
  throw new Error(`等待 DevTools 端点超时（端口 ${port}）`);
}

function teardown(pid, userDataDir) {
  if (pid) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  if (!KEEP && userDataDir) {
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      /* 忽略占用 */
    }
  }
}

/** 解包扩展 id 兜底推算（Chrome 算法：路径 sha256 前 32 位十六进制映射 0-f → a-p）。 */
function extIdFromPath(p) {
  const hex = createHash('sha256').update(p, 'utf8').digest('hex').slice(0, 32);
  return hex.replace(/[0-9a-f]/g, (c) => 'abcdefghijklmnop'[parseInt(c, 16)]);
}

/* ------------------------------------------------------------------ *
 * 截图抓取
 * ------------------------------------------------------------------ */
const report = [];

/** 页面上下文求值。 */
async function evaluate(cdp, sessionId, expression) {
  const r = await cdp.send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  );
  if (r.exceptionDetails) {
    const desc = r.exceptionDetails.exception?.description ?? r.exceptionDetails.text;
    throw new Error(`页面脚本异常：${desc}`);
  }
  return r.result.value;
}

/** 等待一次刚刚触发过的 SPA 重渲染与异步 chrome.storage 读取。 */
async function settle(ms = 1100) {
  await sleep(ms);
}

/** 打开侧栏（点击页面层悬浮球）。 */
const OPEN_PANEL = `(() => {
  const ball = document.getElementById('boss-ai-ball');
  const host = document.getElementById('boss-ai-host');
  if (!host) return 'no-host';
  if (host.classList.contains('ba-open')) return 'already-open';
  if (!ball) return 'no-ball';
  ball.click();
  return 'clicked';
})()`;

/** 侧栏状态探针（调试用）。 */
const PANEL_STATE = `(() => {
  const host = document.getElementById('boss-ai-host');
  const sr = host && host.shadowRoot;
  return JSON.stringify({
    open: !!(host && host.classList.contains('ba-open')),
    tabs: sr ? [...sr.querySelectorAll('[role="tab"]')].map((b) => b.textContent.trim() + (b.disabled ? '(disabled)' : '')) : [],
    title: sr ? (sr.querySelector('.ba-title')?.textContent || '') : '',
  });
})()`;

/** 在 Shadow DOM 内按可见文本点击 [role=tab]。 */
function clickTab(label) {
  return `(() => {
    const sr = document.getElementById('boss-ai-host')?.shadowRoot;
    if (!sr) return 'no-shadow';
    const t = [...sr.querySelectorAll('[role="tab"]')].find((b) => b.textContent.trim() === ${JSON.stringify(label)});
    if (!t) return 'not-found';
    if (t.disabled) return 'disabled';
    t.click();
    return 'ok';
  })()`;
}

/** 在 Shadow DOM 内按可见文本点击 button。 */
function clickButton(text) {
  return `(() => {
    const sr = document.getElementById('boss-ai-host')?.shadowRoot;
    if (!sr) return 'no-shadow';
    const el = [...sr.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)});
    if (!el) return 'not-found';
    if (el.disabled) return 'disabled';
    el.click();
    return 'ok';
  })()`;
}

/** 拦截事件登记（Fetch.requestPaused 串行处理，避免返回值串号）。 */
function bindFulfiller(cdp, sessionId) {
  const fulfill = makeFulfiller(cdp, sessionId);
  let queue = Promise.resolve();
  cdp.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Fetch.requestPaused') {
      queue = queue.then(() => fulfill(msg.params));
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      console.log(`  [诊断] 页面异常：${d.exception?.description ?? d.text}`);
    }
  });
  return () => queue;
}

/** 导航并等待加载完成 + 注入 + 首屏渲染。 */
async function goto(cdp, sessionId, waitQueue, url) {
  await cdp.send('Page.navigate', { url }, sessionId);
  for (let i = 0; i < 120; i += 1) {
    const ready = await evaluate(cdp, sessionId, 'document.readyState').catch(() => '');
    if (ready === 'complete') break;
    await sleep(100);
  }
  await settle(1600);
  await waitQueue();
}

/** 截图并写入磁盘，返回 {file, bytes, width, height}。 */
async function shot(cdp, sessionId, fileName) {
  const r = await cdp.send(
    'Page.captureScreenshot',
    {
      format: 'png',
      captureBeyondViewport: false,
      clip: { x: 0, y: 0, width: SHOT_W, height: SHOT_H, scale: 1 },
    },
    sessionId,
  );
  const buf = Buffer.from(r.data, 'base64');
  const file = resolve(OUT_DIR, fileName);
  writeFileSync(file, buf);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  report.push({ file: `release/screenshots/${fileName}`, bytes: buf.length, width, height });
  const ok = width === SHOT_W && height === SHOT_H;
  console.log(
    `${ok ? 'OK  ' : 'BAD '} ${fileName} — ${buf.length} bytes, ${width}×${height}`,
  );
  return ok;
}

async function main() {
  if (!existsSync(resolve(DIST, 'manifest.json'))) {
    console.error('[shots] 未找到 dist/manifest.json，请先执行 npm run build。');
    process.exit(1);
  }
  const edgePath = findEdge();
  if (!edgePath) {
    console.error('[shots] 未找到 msedge.exe，无法抓取截图。');
    process.exit(1);
  }
  mkdirSync(OUT_DIR, { recursive: true });

  const port = await freePort();
  const userDataDir = mkdtempSync(resolve(tmpdir(), 'boss-ai-shot-'));
  const args = [
    `--user-data-dir=${userDataDir}`,
    `--load-extension=${DIST}`,
    `--disable-extensions-except=${DIST}`,
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    `--window-size=${SHOT_W},${SHOT_H}`,
    'about:blank',
  ];
  if (!HEADED) args.unshift('--headless=new');

  console.log(`[shots] 启动 Edge（${HEADED ? 'headed' : 'headless=new'}）端口 ${port} …`);
  const proc = spawn(edgePath, args, { stdio: 'ignore' });
  let ws = null;
  let allOk = false;
  try {
    const version = await waitForDevtools(port);
    if (!version.webSocketDebuggerUrl) throw new Error('/json/version 未返回 webSocketDebuggerUrl');
    ws = createWebSocket(version.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error('WebSocket 连接超时')), 10000);
      ws.onOpen(() => {
        clearTimeout(timer);
        res();
      });
      ws.onClose((reason) => {
        clearTimeout(timer);
        rej(new Error(reason));
      });
    });

    const cdp = createCdp(ws);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send(
      'Fetch.enable',
      { patterns: [{ urlPattern: 'https://www.zhipin.com/*', requestStage: 'Request' }] },
      sessionId,
    );
    await cdp.send(
      'Emulation.setDeviceMetricsOverride',
      { width: SHOT_W, height: SHOT_H, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );

    const waitQueue = bindFulfiller(cdp, sessionId);
    // 记录内容脚本隔离世界上下文（扩展 id 兜底用）
    const contexts = [];
    cdp.on((msg) => {
      if (msg.method === 'Runtime.executionContextCreated') contexts.push(msg.params.context);
    });

    /* ---- 01 详情页 + 岗位分析 ---- */
    await goto(cdp, sessionId, waitQueue, 'https://www.zhipin.com/job_detail/shot-0001.html');
    console.log(`  打开侧栏：${await evaluate(cdp, sessionId, OPEN_PANEL)}`);
    await settle();
    console.log(`  侧栏状态：${await evaluate(cdp, sessionId, PANEL_STATE)}`);
    await shot(cdp, sessionId, '01-job-analysis.png');

    /* ---- 02 详情页 + 匹配度 ---- */
    console.log(`  切到「匹配度」：${await evaluate(cdp, sessionId, clickTab('匹配度'))}`);
    await settle(900);
    await shot(cdp, sessionId, '02-match.png');

    /* ---- 03 列表页 + AI 快评按钮（侧栏保持收起，突出卡片按钮） ---- */
    await goto(cdp, sessionId, waitQueue, 'https://www.zhipin.com/web/geek/job');
    const quick = await evaluate(
      cdp,
      sessionId,
      "document.querySelectorAll('.boss-ai-quick-btn').length",
    );
    console.log(`  列表页注入 AI 快评按钮：${quick} 个`);
    await shot(cdp, sessionId, '03-list-quick-review.png');

    /* ---- 04 聊天页 + 聊天助手 ---- */
    await goto(cdp, sessionId, waitQueue, 'https://www.zhipin.com/web/geek/chat');
    console.log(`  打开侧栏：${await evaluate(cdp, sessionId, OPEN_PANEL)}`);
    await settle();
    console.log(`  切到「沟通」：${await evaluate(cdp, sessionId, clickTab('沟通'))}`);
    await settle(900);
    // F6 首次启用流程：点击「启用聊天助手」→ 弹窗「同意并启用」（真实交互，写入本地授权）
    console.log(`  启用聊天助手：${await evaluate(cdp, sessionId, clickButton('启用聊天助手'))}`);
    await settle(700);
    console.log(`  弹窗确认：${await evaluate(cdp, sessionId, clickButton('同意并启用'))}`);
    await settle(1500);
    console.log(`  侧栏状态：${await evaluate(cdp, sessionId, PANEL_STATE)}`);
    await shot(cdp, sessionId, '04-chat-assistant.png');

    /* ---- 05 设置页 API 配置 ----
     * 扩展 id 以内容脚本隔离世界的 chrome.runtime.id 为准（最可靠），
     * 再依次尝试 target 列表里的 chrome-extension:// 主机名与路径推算值；
     * 每个候选都实际打开并用 #root 是否挂载来验证，避免截到 ERR_FILE_NOT_FOUND 错误页。 */
    const ids = [];
    try {
      const { targetInfos } = await cdp.send('Target.getTargets');
      for (const t of targetInfos) {
        if (t.url.startsWith('chrome-extension://')) {
          console.log(`  [诊断] 扩展 target：${t.type} ${t.url}`);
          const id = new URL(t.url).hostname;
          if (!ids.includes(id)) ids.push(id);
        }
      }
    } catch (e) {
      console.log(`  [诊断] target 列表读取失败：${e.message}`);
    }
    const isolated = contexts.filter((c) => c.auxData && c.auxData.isDefault === false).at(-1);
    if (isolated) {
      const id = await cdp
        .send(
          'Runtime.evaluate',
          { expression: 'chrome.runtime.id', contextId: isolated.id, returnByValue: true },
          sessionId,
        )
        .then((r) => r.result?.value)
        .catch(() => null);
      console.log(`  [诊断] 隔离世界 chrome.runtime.id = ${id}`);
      if (typeof id === 'string' && id) {
        const at = ids.indexOf(id);
        if (at >= 0) ids.splice(at, 1);
        ids.unshift(id);
      }
    }
    ids.push(extIdFromPath(DIST));

    let optionsOk = false;
    for (const id of ids) {
      console.log(`  尝试扩展 id：${id}`);
      await goto(cdp, sessionId, waitQueue, `chrome-extension://${id}/options.html#api`);
      await settle(900);
      const mounted = await evaluate(cdp, sessionId, "!!document.getElementById('root')").catch(
        () => false,
      );
      if (mounted) {
        optionsOk = true;
        break;
      }
    }
    if (!optionsOk) console.log('  [警告] 所有候选 id 均未能打开扩展设置页');
    await settle(400);
    await shot(cdp, sessionId, '05-options-api.png');

    allOk = report.length === 5 && report.every((r) => r.width === SHOT_W && r.height === SHOT_H);
  } finally {
    try {
      ws?.close();
    } catch {
      /* 忽略 */
    }
    teardown(proc.pid, userDataDir);
    if (KEEP) console.log(`[shots] 已保留临时目录：${userDataDir}`);
  }

  console.log('\n[shots] 产物清单：');
  for (const r of report) {
    console.log(`  ${r.file} — ${r.bytes} bytes, ${r.width}×${r.height}`);
  }
  console.log(`[shots] 结果：${allOk ? 'PASS' : 'FAIL'}（期望 5 张 ${SHOT_W}×${SHOT_H}）`);
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error(`[shots] 未捕获异常：${e?.stack ?? e}`);
  process.exit(1);
});

export { pageHtml, fixtureFor, extIdFromPath };
