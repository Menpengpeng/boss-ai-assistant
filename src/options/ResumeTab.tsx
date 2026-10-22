/**
 * F2：简历标签（PDF 上传 / 粘贴文本脱敏预览 / 版本管理）。
 * 直接读写 IndexedDB（options 运行在扩展源下，允许 import shared/idb）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LIMITS, PROVIDERS } from '../shared/constants';
import { deleteResume, listResumes, putResume } from '../shared/idb';
import { maskText } from '../shared/mask';
import type { AppSettings, ResumeMeta, ResumeRecord } from '../shared/types';
import { sendBg } from './bg';
import { ConfirmDialog, Switch } from './ui';
import { formatBytes, formatTime, isPdfHeader, sha256Hex, toUiError } from './util';
import type { Notify, UiError } from './util';

/** 待确认上传的 PDF（已通过校验并算出哈希）。 */
interface PendingPdf {
  file: File;
  size: number;
  sha256: string;
}

export function ResumeTab({ notify }: { notify: Notify }) {
  const [metas, setMetas] = useState<ResumeMeta[]>([]);
  const [activeVersion, setActiveVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const [rawText, setRawText] = useState('');
  const [name, setName] = useState('');
  const [maskName, setMaskName] = useState(true);
  const [pending, setPending] = useState<PendingPdf | null>(null);
  const [pdfAck, setPdfAck] = useState(false);
  const [confirmDel, setConfirmDel] = useState<ResumeMeta | null>(null);
  /** 当前服务商 id：用于上传 PDF 前就提示「该服务商是否支持 PDF 附件」。 */
  const [apiProvider, setApiProvider] = useState('');

  const refresh = useCallback(async (): Promise<void> => {
    const [list, settings] = await Promise.all([
      listResumes(),
      sendBg<AppSettings>({ type: 'settings:get', payload: {} }),
    ]);
    setMetas(list);
    setActiveVersion(settings.activeResumeVersion);
    setApiProvider(settings.api.provider);
  }, []);

  useEffect(() => {
    let alive = true;
    refresh()
      .catch((e) => {
        if (alive) setError(toUiError(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [refresh]);

  /** 实时脱敏预览。 */
  const preview = useMemo(
    () => (rawText.trim() ? maskText(rawText, { name: name.trim(), maskName }).masked : ''),
    [rawText, name, maskName],
  );

  /**
   * 当前服务商的 PDF 附件能力提示（未加载完或支持时不提示）。
   * custom 视为未知，与 background 的口径一致：按「不支持」处理。
   */
  const preset = PROVIDERS.find((p) => p.id === apiProvider);
  const pdfHint =
    !apiProvider || preset?.pdf === 'native'
      ? null
      : apiProvider === 'custom'
        ? '当前服务商为「自定义」：插件无法判断其是否支持 PDF 附件，会按「不支持」处理。想参与分析请用粘贴文本导入；如确认你的网关支持 PDF，可在「API 配置」改选对应预设。'
        : `当前服务商「${preset?.label ?? apiProvider}」不支持 PDF 附件：可以继续保存 PDF 留作备份，但要参与分析请改用粘贴文本，或在「API 配置」切换到 OpenAI / Claude。`;

  /** 校验并预载 PDF（MIME → 大小 → 文件头 → SHA-256）。 */
  const onPickPdf = async (file: File): Promise<void> => {
    setError(null);
    setPending(null);
    setPdfAck(false);
    try {
      if (file.type !== 'application/pdf') {
        throw new Error('MIME 必须为 application/pdf');
      }
      if (file.size > LIMITS.maxPdfBytes) {
        setError({ code: 'FILE_TOO_LARGE', message: '文件超过 10MB' });
        return;
      }
      const buf = await file.arrayBuffer();
      if (!isPdfHeader(new Uint8Array(buf))) {
        setError({ code: 'FILE_INVALID', message: '文件头不是 %PDF' });
        return;
      }
      const sha256 = await sha256Hex(buf);
      setPending({ file, size: file.size, sha256 });
    } catch {
      setError({ code: 'FILE_INVALID', message: '文件格式不正确' });
    }
  };

  /** 写为新的简历版本并设为当前。 */
  const saveVersion = async (rec: ResumeRecord): Promise<void> => {
    await putResume(rec);
    const next = await sendBg<AppSettings>({
      type: 'settings:set',
      payload: { patch: { activeResumeVersion: rec.version } },
    });
    setActiveVersion(next.activeResumeVersion);
    setMetas(await listResumes());
  };

  const savePdf = async (): Promise<void> => {
    if (!pending || !pdfAck) return;
    setBusy(true);
    setError(null);
    try {
      const version = Date.now();
      await saveVersion({
        kind: 'pdf',
        name: pending.file.name,
        version,
        updatedAt: version,
        size: pending.size,
        sha256: pending.sha256,
        maskName: false,
        blob: pending.file,
      });
      setPending(null);
      setPdfAck(false);
      notify(`已保存 PDF 简历 v${version}`);
    } catch (e) {
      setError(toUiError(e));
    } finally {
      setBusy(false);
    }
  };

  const saveText = async (): Promise<void> => {
    const text = rawText.trim();
    setError(null);
    if (!text) {
      notify('请先粘贴简历文本');
      return;
    }
    setBusy(true);
    try {
      const bytes = new TextEncoder().encode(text);
      const { masked, map } = maskText(text, { name: name.trim(), maskName });
      const version = Date.now();
      await saveVersion({
        kind: 'text',
        name: '粘贴文本',
        version,
        updatedAt: version,
        size: bytes.length,
        sha256: await sha256Hex(bytes),
        maskName,
        rawText: text,
        maskedText: masked,
        map,
      });
      notify(`已保存文本简历 v${version}（发送前脱敏）`);
    } catch (e) {
      setError(toUiError(e));
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (version: number): Promise<void> => {
    setError(null);
    try {
      const next = await sendBg<AppSettings>({
        type: 'settings:set',
        payload: { patch: { activeResumeVersion: version } },
      });
      setActiveVersion(next.activeResumeVersion);
      notify(`已切换为 v${version}`);
    } catch (e) {
      setError(toUiError(e));
    }
  };

  const doDelete = async (meta: ResumeMeta): Promise<void> => {
    setError(null);
    try {
      await deleteResume(meta.version);
      if (meta.version === activeVersion) {
        const next = await sendBg<AppSettings>({
          type: 'settings:set',
          payload: { patch: { activeResumeVersion: 0 } },
        });
        setActiveVersion(next.activeResumeVersion);
      }
      setMetas(await listResumes());
      setConfirmDel(null);
      notify(`已删除简历 v${meta.version}`);
    } catch (e) {
      setError(toUiError(e));
    }
  };

  if (loading) {
    return (
      <div className="tab-body" aria-busy="true">
        <p className="muted">加载中…</p>
      </div>
    );
  }

  return (
    <div className="tab-body" aria-busy={busy}>
      <div className="cd">
        <div className="row-between">
          <b>当前简历</b>
          {activeVersion > 0 ? (
            <span className="badge ok">v{activeVersion} · 使用中</span>
          ) : (
            <span className="badge mute">未导入</span>
          )}
        </div>
        <div className="sub" style={{ marginTop: 8 }}>
          支持 PDF（≤10MB，原文发送）与粘贴文本（发送前脱敏）；DOCX 暂不支持，请先转为 PDF。
        </div>
      </div>

      {metas.length > 0 ? (
        <ul className="resume-list">
          {metas.map((m) => (
            <li
              key={m.version}
              className={m.version === activeVersion ? 'resume-item active' : 'resume-item'}
            >
              <div className="row-between">
                <b>
                  {m.kind === 'pdf' ? 'PDF' : '文本'} · {m.name}
                </b>
                {m.version === activeVersion ? (
                  <span className="badge ok">使用中</span>
                ) : (
                  <span className="badge mute">v{m.version}</span>
                )}
              </div>
              <div className="sub">
                版本 v{m.version} · {formatBytes(m.size)} · 哈希 {m.sha256.slice(0, 12)} ·
                更新 {formatTime(m.updatedAt)}
                {m.maskName ? ' · 姓名已脱敏' : ''}
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                {m.version !== activeVersion ? (
                  <button
                    type="button"
                    className="btn outline sm"
                    onClick={() => void setActive(m.version)}
                  >
                    设为当前
                  </button>
                ) : null}
                <button type="button" className="btn text sm" onClick={() => setConfirmDel(m)}>
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="field">
        <label htmlFor="resume-pdf">上传 PDF 简历</label>
        <input
          id="resume-pdf"
          type="file"
          accept="application/pdf,.pdf"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onPickPdf(file);
            e.currentTarget.value = '';
          }}
        />
        <div className="h">校验 MIME 与文件头（%PDF）、大小不超过 10MB。</div>
        {pdfHint ? (
          <div className="warnbox" style={{ marginTop: 8 }}>
            {pdfHint}
          </div>
        ) : null}
      </div>

      {pending ? (
        <div className="cd">
          <div className="sub">
            文件：{pending.file.name} · {formatBytes(pending.size)} · 哈希{' '}
            {pending.sha256.slice(0, 12)}
          </div>
          <div className="warnbox" style={{ marginTop: 8 }}>
            PDF 简历将以「原文」发送，无法本地脱敏。文件中可能包含手机号、邮箱、身份证号等个人信息，请确认后再上传。
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={pdfAck}
              onChange={(e) => setPdfAck(e.target.checked)}
            />
            <span>我已知悉：PDF 将以原文发送，无法本地脱敏。</span>
          </label>
          <button
            type="button"
            className="btn"
            disabled={!pdfAck || busy}
            onClick={() => void savePdf()}
          >
            确认并保存为简历版本
          </button>
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="resume-name">姓名（可选，用于“姓名也脱敏”）</label>
        <input
          id="resume-name"
          value={name}
          placeholder="如：张伟"
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="resume-text">或粘贴简历文本</label>
        <textarea
          id="resume-text"
          rows={8}
          value={rawText}
          placeholder="粘贴简历正文…"
          onChange={(e) => setRawText(e.target.value)}
        />
      </div>

      <div className="row-between">
        <span>姓名也脱敏</span>
        <Switch ariaLabel="姓名也脱敏" checked={maskName} onChange={setMaskName} />
      </div>

      <div className="row-actions">
        <button type="button" className="btn" disabled={busy} onClick={() => void saveText()}>
          保存为简历版本
        </button>
      </div>

      {preview ? (
        <div className="quote">
          <div className="sub">脱敏预览（真正发送给模型的内容）</div>
          <pre className="preview">{preview}</pre>
        </div>
      ) : null}

      {error ? (
        <div className="errbox" role="alert" style={{ marginTop: 12 }}>
          <b>{error.message}</b>
          <div className="code">错误码：{error.code}</div>
        </div>
      ) : null}

      {confirmDel ? (
        <ConfirmDialog
          title="删除简历版本"
          confirmLabel="确认删除"
          requireAck="我已了解，删除后该版本（含 PDF 文件）将无法恢复。"
          onCancel={() => setConfirmDel(null)}
          onConfirm={() => void doDelete(confirmDel)}
        >
          <div>
            将删除 v{confirmDel.version}（{confirmDel.kind === 'pdf' ? 'PDF' : '文本'} ·{' '}
            {confirmDel.name}）。
          </div>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
