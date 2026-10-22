/**
 * Background 消息处理（Task 5）。
 * - 一次性请求：chrome.runtime.onMessage → BgResponse（任何异常都转为 errorResponse，绝不外抛）；
 * - 流式请求：chrome.runtime.onConnect(BG_PORT_NAME) → StreamServerMsg（delta / done / error）。
 */
import { AppError, errorResponse } from '../shared/errors';
import { addAnalysis, clearAnalyses, listAnalyses } from '../shared/idb';
import { clearLogs, getLogs } from '../shared/log';
import { BG_PORT_NAME } from '../shared/protocol';
import type {
  BgRequest,
  BgResponse,
  StreamClientMsg,
  StreamServerMsg,
  StreamStart,
} from '../shared/protocol';
import { clearCache, getCache, getSettings, setCache, setSettings } from '../shared/storage';
import type { AnalysisRecord } from '../shared/types';
import { clearAllData } from '../shared/wipe';
import { assertLoggedIn, queryTabAuth } from './auth';
import { createClient } from './llm';
import { assertOriginAllowed, checkPermission } from './permissions';
import { loadResumeContext } from './resume';
import { runTaskWithLLM } from './runner';

/** 在途流式任务：requestId → { 控制器, 所属端口 }。 */
const activeTasks = new Map<string, { controller: AbortController; port: chrome.runtime.Port }>();

/** 从 payload 中取历史记录（兼容 record / rec 两种字段名）。 */
function pickRecord(payload: unknown): AnalysisRecord | null {
  const p = payload as { record?: AnalysisRecord; rec?: AnalysisRecord } | undefined;
  return p?.record ?? p?.rec ?? null;
}

/** 最小连通性测试：授权 → Key → 请求 → 标记已验证。 */
async function runTest(): Promise<{ ms: number }> {
  const settings = await getSettings();
  const api = settings.api;
  await assertOriginAllowed(api.baseUrl);
  if (!api.key) throw new AppError('NO_KEY');
  const client = createClient(api);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, api.timeoutSec) * 1000);
  try {
    const ms = await client.test(controller.signal);
    await setSettings({ api: { verified: true, verifiedAt: Date.now() } });
    return { ms };
  } catch (e) {
    if (controller.signal.aborted) throw new AppError('TIMEOUT');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** 处理一次性请求，返回值恒为 BgResponse。 */
async function handleRequest(
  req: BgRequest,
  sender: chrome.runtime.MessageSender,
): Promise<BgResponse> {
  try {
    switch (req.type) {
      case 'settings:get':
        return { ok: true, data: await getSettings() };
      case 'settings:set':
        return { ok: true, data: await setSettings(req.payload.patch) };
      case 'llm:test':
        return { ok: true, data: await runTest() };
      case 'auth:check': {
        const tabId = sender?.tab?.id;
        const auth = typeof tabId === 'number' ? await queryTabAuth(tabId) : 'unknown';
        return { ok: true, data: { auth } };
      }
      case 'perm:ensure': {
        const settings = await getSettings();
        const url = (req.payload.baseUrl ?? '').trim() || settings.api.baseUrl;
        return { ok: true, data: await checkPermission(url) };
      }
      case 'cache:get':
        return { ok: true, data: await getCache(req.payload.key) };
      case 'cache:set':
        await setCache(req.payload.key, req.payload.value);
        return { ok: true, data: null };
      case 'cache:clear':
        await clearCache();
        return { ok: true, data: null };
      case 'history:list':
        return { ok: true, data: await listAnalyses(req.payload.limit) };
      case 'history:add': {
        const record = pickRecord(req.payload);
        if (!record) throw new AppError('UNKNOWN', undefined, 'history:add 缺少 record');
        await addAnalysis(record);
        return { ok: true, data: null };
      }
      case 'history:clear':
        await clearAnalyses();
        return { ok: true, data: null };
      case 'resume:snapshot':
        return { ok: true, data: await loadResumeContext() };
      case 'data:clearAll':
        await clearAllData();
        return { ok: true, data: null };
      case 'logs:list':
        return { ok: true, data: await getLogs() };
      case 'logs:clear':
        await clearLogs();
        return { ok: true, data: null };
      case 'ui:openOptions': {
        // content script 运行在页面源下，在那里 window.open(chrome-extension://…) 属于
        // 「网页发起的顶层导航」，会被 Chromium 的扩展资源策略拦截（真机表现为
        // ERR_BLOCKED_BY_CLIENT）；必须回到扩展上下文里用 chrome.tabs.create 打开。
        // chrome.tabs.create 不需要 tabs 权限，因此不扩大 manifest 权限集。
        const hash = (req.payload.hash ?? '').trim();
        const url = chrome.runtime.getURL(`options.html${hash ? `#${hash}` : ''}`);
        await chrome.tabs.create({ url });
        return { ok: true, data: null };
      }
      default:
        return { ok: false, error: errorResponse(new AppError('UNKNOWN')) };
    }
  } catch (e) {
    return { ok: false, error: errorResponse(e) };
  }
}

/** 注册一次性消息处理器。 */
export function registerMessageHandler(): void {
  chrome.runtime.onMessage.addListener(
    (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: BgResponse) => void,
    ) => {
      void handleRequest(message as BgRequest, sender).then((res) => {
        try {
          sendResponse(res);
        } catch {
          /* 响应通道可能已关闭 */
        }
      });
      return true;
    },
  );
}

/** 安全地向端口回发消息。 */
function post(port: chrome.runtime.Port, msg: StreamServerMsg): void {
  try {
    port.postMessage(msg);
  } catch {
    /* 端口已断开 */
  }
}

/** 开始一次流式任务。 */
async function handleStart(port: chrome.runtime.Port, msg: StreamStart): Promise<void> {
  const { requestId } = msg;
  const controller = new AbortController();
  activeTasks.set(requestId, { controller, port });
  try {
    // F0 二次校验：非登录态直接拒绝
    await assertLoggedIn(port.sender?.tab?.id);
    // 每个请求都重新读取配置（用户可能刚修改）
    const settings = await getSettings();
    const result = await runTaskWithLLM({
      task: msg.task,
      payload: msg.payload,
      settings: settings.api,
      signal: controller.signal,
      force: msg.force === true,
      onDelta: (text) => post(port, { type: 'delta', requestId, text }),
    });
    post(port, { type: 'done', requestId, text: result.text });
  } catch (e) {
    const { code, message } = errorResponse(e);
    post(port, { type: 'error', requestId, code, message });
  } finally {
    activeTasks.delete(requestId);
  }
}

/** 中止指定请求。 */
function handleAbort(requestId: string): void {
  const task = activeTasks.get(requestId);
  if (!task) return;
  activeTasks.delete(requestId);
  task.controller.abort();
}

/** 端口断开：中止该端口上全部在途任务。 */
function cleanupPort(port: chrome.runtime.Port): void {
  for (const [requestId, task] of Array.from(activeTasks.entries())) {
    if (task.port === port) {
      activeTasks.delete(requestId);
      task.controller.abort();
    }
  }
}

/** 注册流式 Port 处理器。 */
export function registerPortHandler(): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== BG_PORT_NAME) return;
    port.onMessage.addListener((raw: unknown) => {
      const msg = raw as StreamClientMsg;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'start') void handleStart(port, msg);
      else if (msg.type === 'abort') handleAbort(msg.requestId);
    });
    port.onDisconnect.addListener(() => cleanupPort(port));
  });
}
