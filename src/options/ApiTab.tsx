/**
 * F1：API 配置标签（服务商预设 / 参数 / 测试连接 / 自定义域名授权）。
 * 运行在扩展源下，因此可以直接调用 chrome.permissions.request（必须由用户点击触发）。
 */
import { useEffect, useRef, useState } from 'react';
import { PROVIDERS } from '../shared/constants';
import { ERROR_TIPS } from '../shared/errors';
import type { ApiSettings, AppSettings } from '../shared/types';
import { sendBg } from './bg';
import { NumField, Switch } from './ui';
import { buildApiPatch, maskKeyDisplay, needsOriginGrant, toUiError } from './util';
import type { Notify, UiError } from './util';

/** 单个数字参数的安全取整 / 夹取。 */
function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function ApiTab({ notify }: { notify: Notify }) {
  const [draft, setDraft] = useState<ApiSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [keyError, setKeyError] = useState('');
  const [testMsg, setTestMsg] = useState('');
  const [error, setError] = useState<UiError | null>(null);
  const [granted, setGranted] = useState<boolean | null>(null);
  const original = useRef<ApiSettings | null>(null);

  useEffect(() => {
    let alive = true;
    sendBg<AppSettings>({ type: 'settings:get', payload: {} })
      .then((s) => {
        if (!alive) return;
        original.current = s.api;
        setDraft(s.api);
      })
      .catch((e) => {
        if (alive) setError(toUiError(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const baseUrl = draft?.baseUrl ?? '';
  const { origin, needed } = needsOriginGrant(baseUrl);

  // 自定义域名：检查初始授权状态，用于决定按钮文案
  useEffect(() => {
    if (!needed) {
      setGranted(null);
      return;
    }
    let alive = true;
    chrome.permissions
      .contains({ origins: [`${origin}/*`] })
      .then((ok) => {
        if (alive) setGranted(ok);
      })
      .catch(() => {
        if (alive) setGranted(false);
      });
    return () => {
      alive = false;
    };
  }, [needed, origin]);

  const set = (patch: Partial<ApiSettings>): void => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  };

  /** 切换服务商预设：同步填入 Base URL / 模型（custom 为空可编辑）。 */
  const onProvider = (id: string): void => {
    const preset = PROVIDERS.find((p) => p.id === id);
    setDraft((d) =>
      d
        ? {
            ...d,
            provider: id,
            baseUrl: preset?.baseUrl ?? '',
            model: preset?.model ?? '',
            verified: false,
            verifiedAt: 0,
          }
        : d,
    );
    setTestMsg('');
    setError(null);
  };

  /** 保存（只提交有变化的字段）。 */
  const onSave = async (): Promise<void> => {
    if (!draft) return;
    setError(null);
    setSaving(true);
    try {
      const patch = buildApiPatch(original.current ?? draft, draft);
      if (Object.keys(patch).length === 0) {
        notify('没有需要保存的改动');
        return;
      }
      const next = await sendBg<AppSettings>({ type: 'settings:set', payload: { patch } });
      original.current = next.api;
      setDraft(next.api);
      notify('已保存到本机');
    } catch (e) {
      setError(toUiError(e));
    } finally {
      setSaving(false);
    }
  };

  /** 测试连接：先落盘草稿 → llm:test → 成功后持久化 verified。 */
  const onTest = async (): Promise<void> => {
    if (!draft) return;
    setError(null);
    setTestMsg('');
    if (!draft.key.trim()) {
      setKeyError('请先填写 API Key');
      return; // 不发任何请求
    }
    setKeyError('');
    setTesting(true);
    try {
      const patch = buildApiPatch(original.current ?? draft, draft);
      if (Object.keys(patch).length > 0) {
        const saved = await sendBg<AppSettings>({ type: 'settings:set', payload: { patch } });
        original.current = saved.api;
        setDraft(saved.api);
      }
      const res = await sendBg<{ ms?: number }>({ type: 'llm:test', payload: {} });
      const ms = typeof res?.ms === 'number' ? res.ms : 0;
      setTestMsg(`连接正常（${ms} ms）`);
      const verified = await sendBg<AppSettings>({
        type: 'settings:set',
        payload: { patch: { api: { verified: true, verifiedAt: Date.now() } } },
      });
      original.current = verified.api;
      setDraft(verified.api);
      notify('测试连接成功');
    } catch (e) {
      setError(toUiError(e));
    } finally {
      setTesting(false);
    }
  };

  /** 申请自定义域名权限（用户手势直接触发，首次 await 必须是 request）。 */
  const onGrant = async (): Promise<void> => {
    if (!origin) return;
    setError(null);
    let ok = false;
    try {
      ok = await chrome.permissions.request({ origins: [`${origin}/*`] });
    } catch {
      ok = false;
    }
    if (!ok) {
      setGranted(false);
      setError({ code: 'NO_PERMISSION', message: ERROR_TIPS.NO_PERMISSION.title });
      return;
    }
    try {
      const res = await sendBg<{ granted: boolean }>({
        type: 'perm:ensure',
        payload: { baseUrl },
      });
      setGranted(res.granted);
      notify(res.granted ? '已授权访问该域名' : '授权未生效，请重试');
    } catch (e) {
      setGranted(false);
      setError(toUiError(e));
    }
  };

  if (loading || !draft) {
    return (
      <div className="tab-body" aria-busy="true">
        <p className="muted">加载中…</p>
      </div>
    );
  }

  const preset = PROVIDERS.find((p) => p.id === draft.provider);
  const pdfCap = preset?.pdf ?? 'none';
  const isCustom = draft.provider === 'custom';
  const tip = ERROR_TIPS[error?.code ?? 'UNKNOWN'];

  return (
    <div className="tab-body" aria-busy={loading}>
      <div className="field">
        <label htmlFor="api-provider">服务商预设</label>
        <select id="api-provider" value={draft.provider} onChange={(e) => onProvider(e.target.value)}>
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <div className="h">
          <span className={pdfCap === 'native' ? 'badge ok' : 'badge mute'}>
            {pdfCap === 'native' ? 'PDF 附件：支持' : isCustom ? 'PDF 附件：未知' : 'PDF 附件：不支持'}
          </span>{' '}
          {pdfCap === 'native'
            ? '该服务商支持 PDF 原文直传（原生附件接口）。'
            : isCustom
              ? '自定义服务商无法自动判断，插件按「不支持」处理；如你的网关支持 PDF，可在「简历」标签用粘贴文本导入。'
              : '该服务商不支持 PDF 附件，简历请用粘贴文本导入；需要直传 PDF 可改用 OpenAI 或 Claude。'}
        </div>
      </div>

      <div className="field">
        <label htmlFor="api-base-url">Base URL</label>
        <input
          id="api-base-url"
          value={draft.baseUrl}
          placeholder="https://api.example.com/v1"
          spellCheck={false}
          onChange={(e) => set({ baseUrl: e.target.value })}
        />
        <div className="h">
          兼容 OpenAI 格式（/chat/completions）；Claude 单独实现。
          {isCustom ? ' 自定义地址请自行确认接口兼容性。' : ''}
        </div>
      </div>

      <div className={keyError ? 'field err' : 'field'}>
        <label htmlFor="api-key">API Key（仅存本地）</label>
        <div className="row-nowrap">
          <input
            id="api-key"
            type={showKey ? 'text' : 'password'}
            value={showKey ? maskKeyDisplay(draft.key) : draft.key}
            readOnly={showKey}
            placeholder="sk-..."
            autoComplete="off"
            spellCheck={false}
            aria-invalid={keyError ? true : undefined}
            onChange={(e) => set({ key: e.target.value })}
          />
          <button
            type="button"
            className="btn outline sm"
            aria-pressed={showKey}
            aria-label={showKey ? '隐藏密钥' : '显示脱敏后的密钥'}
            onClick={() => setShowKey((v) => !v)}
          >
            {showKey ? '隐藏' : '显示'}
          </button>
        </div>
        <div className="h">
          {keyError
            ? keyError
            : showKey
              ? '显示态为脱敏结果（前 4 + 后 4），完整密钥不会出现在界面上。'
              : draft.key
                ? '密钥仅保存在本机浏览器，界面脱敏显示。'
                : '只保存在本机浏览器，不经过任何自建服务器。'}
        </div>
      </div>

      <div className="grid2">
        <div className="field">
          <label htmlFor="api-model">模型</label>
          <input
            id="api-model"
            value={draft.model}
            spellCheck={false}
            onChange={(e) => set({ model: e.target.value })}
          />
        </div>
        <NumField
          id="api-temperature"
          label="temperature"
          value={draft.temperature}
          min={0}
          max={2}
          step={0.1}
          onChange={(n) =>
            set({ temperature: clampNumber(Math.round(n * 10) / 10, 0, 2) })
          }
        />
        <NumField
          id="api-max-tokens"
          label="max_tokens"
          value={draft.maxTokens}
          min={1}
          step={1}
          onChange={(n) => set({ maxTokens: Math.max(1, Math.round(n)) })}
        />
        <NumField
          id="api-timeout"
          label="超时（秒）"
          value={draft.timeoutSec}
          min={1}
          step={1}
          onChange={(n) => set({ timeoutSec: Math.max(1, Math.round(n)) })}
        />
      </div>

      <div className="row-between">
        <span>流式输出</span>
        <Switch
          ariaLabel="流式输出"
          checked={draft.stream}
          onChange={(v) => set({ stream: v })}
        />
      </div>
      <div className="row-between">
        <span>发送前自动脱敏手机号、邮箱、微信号、身份证号</span>
        <Switch
          ariaLabel="发送前自动脱敏"
          checked={draft.maskPhone}
          onChange={(v) => set({ maskPhone: v })}
        />
      </div>

      {needed ? (
        <div className="warnbox">
          <div>自定义域名需通过 chrome.permissions.request 动态申请权限。</div>
          <div className="row" style={{ marginTop: 8 }}>
            {granted ? (
              <span className="badge ok">已授权</span>
            ) : (
              <button type="button" className="btn sm" onClick={() => void onGrant()}>
                授权访问该域名
              </button>
            )}
          </div>
        </div>
      ) : null}

      <div className="row-actions">
        <button type="button" className="btn" disabled={testing} onClick={() => void onTest()}>
          {testing ? '测试中…' : '测试连接'}
        </button>
        <button
          type="button"
          className="btn outline"
          disabled={saving}
          onClick={() => void onSave()}
        >
          {saving ? '保存中…' : '保存'}
        </button>
        {testMsg ? <span className="badge ok">{testMsg}</span> : null}
      </div>

      {error ? (
        <div className="errbox" role="alert">
          <b>{tip.title}</b>
          <div style={{ marginTop: 4 }}>{tip.body}</div>
          <div className="code">错误码：{error.code}</div>
          {error.message && error.message !== tip.title ? (
            <div className="code">详情：{error.message}</div>
          ) : null}
        </div>
      ) : null}

      <div className="hint" style={{ marginTop: 14 }}>
        未配置 Key 时点击测试不会发出任何请求；测试通过后其它 AI 功能才可触发。测试连接会先保存当前页面上的改动。
      </div>
    </div>
  );
}
