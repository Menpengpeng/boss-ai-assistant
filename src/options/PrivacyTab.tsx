/**
 * 隐私标签：存储位置说明、发送范围说明、聊天模块授权、一键清除全部数据、导出我的数据。
 */
import { useEffect, useState } from 'react';
import { listResumes } from '../shared/idb';
import type { AnalysisRecord, AppSettings } from '../shared/types';
import { sendBg } from './bg';
import { ConfirmDialog, Switch } from './ui';
import { downloadText, maskKeyDisplay, todayStamp, toUiError } from './util';
import type { Notify, UiError } from './util';

/** 存储位置说明表（与设计说明一致）。 */
const STORAGE_ROWS: { where: string; what: string; note: string }[] = [
  { where: 'chrome.storage.local', what: 'API Key', note: '仅本机，接口请求时才读取' },
  { where: 'chrome.storage.local', what: '配置 / 对比 / 收藏 / 快评', note: 'settings 与业务缓存' },
  { where: 'IndexedDB（本机）', what: '简历（含 PDF Blob）', note: 'resumes 表，按版本存储' },
  { where: 'IndexedDB（本机）', what: '分析历史', note: 'analyses 表，含岗位快照' },
  { where: 'chrome.storage.local', what: '本地日志', note: '环形裁剪，写入前脱敏' },
];

export function PrivacyTab({
  notify,
  onDataCleared,
}: {
  notify: Notify;
  onDataCleared: () => void;
}) {
  const [chatConsent, setChatConsent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<UiError | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let alive = true;
    sendBg<AppSettings>({ type: 'settings:get', payload: {} })
      .then((s) => {
        if (alive) setChatConsent(s.chatConsent);
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

  /** 聊天模块授权开关：立即持久化。 */
  const onChatConsent = async (next: boolean): Promise<void> => {
    setError(null);
    setChatConsent(next);
    try {
      await sendBg<AppSettings>({
        type: 'settings:set',
        payload: { patch: { chatConsent: next } },
      });
      notify(next ? '已开启聊天模块授权' : '已关闭聊天模块授权');
    } catch (e) {
      setChatConsent(!next);
      setError(toUiError(e));
    }
  };

  /** 一键清除全部数据：由 background 统一清理 storage + IndexedDB + session。 */
  const doClear = async (): Promise<void> => {
    setClearing(true);
    setError(null);
    try {
      await sendBg({ type: 'data:clearAll', payload: {} });
      setConfirmOpen(false);
      notify('已清除本机全部数据');
      onDataCleared();
    } catch (e) {
      setError(toUiError(e));
    } finally {
      setClearing(false);
    }
  };

  /** 导出我的数据（JSON）：不含完整 API Key。 */
  const onExport = async (): Promise<void> => {
    setExporting(true);
    setError(null);
    try {
      const [history, settings, resumes] = await Promise.all([
        sendBg<AnalysisRecord[]>({ type: 'history:list', payload: {} }),
        sendBg<AppSettings>({ type: 'settings:get', payload: {} }),
        listResumes(),
      ]);
      const payload = {
        exportedAt: new Date().toISOString(),
        note: 'API Key 已脱敏，不包含完整密钥。',
        settings: { ...settings, api: { ...settings.api, key: maskKeyDisplay(settings.api.key) } },
        resumes,
        history,
      };
      downloadText(
        `boss-ai-data-${todayStamp()}.json`,
        JSON.stringify(payload, null, 2),
        'application/json',
      );
      notify('已开始下载数据导出文件');
    } catch (e) {
      setError(toUiError(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="tab-body" aria-busy={loading}>
      <div className="cd">
        <div className="row">
          <b>数据只保存在本机</b>
        </div>
        <div className="sub" style={{ marginTop: 8 }}>
          不引入统计与远程日志；仅向你自行配置的服务商域名发起请求，全部数据不上传任何服务器。
        </div>
      </div>

      <h3 className="section-title">存储位置</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>位置</th>
              <th>内容</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            {STORAGE_ROWS.map((r) => (
              <tr key={`${r.where}-${r.what}`}>
                <td>{r.where}</td>
                <td>{r.what}</td>
                <td>{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="section-title">数据发送范围</h3>
      <ul className="plain-list">
        <li>使用 AI 功能时，接收方是你自行配置的模型服务商（不会经过自建服务器）。</li>
        <li>发送内容包括：当前岗位 JD、简历内容、当前会话文本。</li>
        <li>文本发送前会脱敏（手机号、邮箱、微信号、身份证号）；PDF 简历为原文发送，无法本地脱敏。</li>
        <li>所有请求均由你主动点击触发：插件不自动打招呼、不自动回复、不批量采集。</li>
        <li>风险结论仅供参考，不构成对公司或个人的事实认定。</li>
      </ul>

      <div className="row-between">
        <span>聊天模块授权（聊天内容发送到你配置的模型服务商）</span>
        <Switch
          ariaLabel="聊天模块授权"
          checked={chatConsent}
          onChange={(v) => void onChatConsent(v)}
        />
      </div>

      <div className="row-actions">
        <button type="button" className="btn outline" disabled={exporting} onClick={() => void onExport()}>
          {exporting ? '导出中…' : '导出我的数据'}
        </button>
        <button type="button" className="btn danger" onClick={() => setConfirmOpen(true)}>
          一键清除全部数据
        </button>
      </div>

      <div className="hint" style={{ marginTop: 12 }}>
        清除后本地无残留（含 PDF 文件）；Key 不写入日志，也不出现在任何错误信息中。
      </div>

      {error ? (
        <div className="errbox" role="alert" style={{ marginTop: 12 }}>
          <b>{error.message}</b>
          <div className="code">错误码：{error.code}</div>
        </div>
      ) : null}

      {confirmOpen ? (
        <ConfirmDialog
          title="确认清除全部数据"
          confirmLabel="确认清除全部数据"
          requireAck="我已了解：将清空配置、简历（含 PDF）、分析历史、缓存与日志，且不可恢复。"
          busy={clearing}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => void doClear()}
        >
          <div>将清除：chrome.storage.local 配置与日志、IndexedDB 中的简历与分析历史。</div>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
