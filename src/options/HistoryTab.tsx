/**
 * F12：历史标签（本机分析历史列表、类型筛选 / 关键字搜索、导出 Markdown / CSV、清除历史）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AnalysisRecord, HistoryKind } from '../shared/types';
import { sendBg } from './bg';
import { ConfirmDialog } from './ui';
import {
  buildCsv,
  buildMarkdown,
  downloadText,
  filterHistory,
  formatScore,
  formatTime,
  HISTORY_KIND_LABELS,
  kindLabel,
  toUiError,
  todayStamp,
} from './util';
import type { Notify, UiError } from './util';

const KIND_OPTIONS = Object.keys(HISTORY_KIND_LABELS) as HistoryKind[];

export function HistoryTab({ notify }: { notify: Notify }) {
  const [records, setRecords] = useState<AnalysisRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const [kind, setKind] = useState<HistoryKind | 'all'>('all');
  const [keyword, setKeyword] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    const list = await sendBg<AnalysisRecord[]>({ type: 'history:list', payload: { limit: 100 } });
    setRecords(Array.isArray(list) ? list : []);
  }, []);

  useEffect(() => {
    let alive = true;
    load()
      .catch((e) => {
        if (alive) setError(toUiError(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [load]);

  const shown = useMemo(() => filterHistory(records, kind, keyword), [records, kind, keyword]);

  const exportMarkdown = (): void => {
    if (shown.length === 0) {
      notify('暂无历史记录可导出');
      return;
    }
    downloadText(`boss-ai-history-${todayStamp()}.md`, buildMarkdown(shown), 'text/markdown');
    notify('已开始下载 Markdown');
  };

  const exportCsv = (): void => {
    if (shown.length === 0) {
      notify('暂无历史记录可导出');
      return;
    }
    downloadText(`boss-ai-history-${todayStamp()}.csv`, buildCsv(shown), 'text/csv', true);
    notify('已开始下载 CSV');
  };

  const doClear = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await sendBg({ type: 'history:clear', payload: {} });
      await load();
      setConfirmOpen(false);
      notify('已清除历史记录');
    } catch (e) {
      setError(toUiError(e));
    } finally {
      setBusy(false);
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
      <div className="row-between">
        <b>
          本机分析历史（共 {records.length} 条{shown.length !== records.length ? `，筛选后 ${shown.length} 条` : ''}）
        </b>
        <div className="row">
          <button type="button" className="btn outline sm" onClick={exportMarkdown}>
            导出 Markdown
          </button>
          <button type="button" className="btn outline sm" onClick={exportCsv}>
            导出 CSV
          </button>
        </div>
      </div>

      <div className="grid2">
        <div className="field">
          <label htmlFor="history-kind">类型筛选</label>
          <select
            id="history-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as HistoryKind | 'all')}
          >
            <option value="all">全部类型</option>
            {KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="history-keyword">关键字（岗位标题 / 公司）</label>
          <input
            id="history-keyword"
            value={keyword}
            placeholder="输入关键字筛选"
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
      </div>

      {shown.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>类型</th>
                <th>岗位</th>
                <th>公司</th>
                <th>模型</th>
                <th>匹配度</th>
                <th>风险数</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td>{formatTime(r.at)}</td>
                  <td>{kindLabel(r.kind)}</td>
                  <td>{r.jobTitle || '未提供'}</td>
                  <td>{r.company || '未提供'}</td>
                  <td>{r.model || '未提供'}</td>
                  <td>{formatScore(r.score)}</td>
                  <td>{r.riskCount ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="cd" style={{ textAlign: 'center' }}>
          <div className="sub">暂无历史记录</div>
        </div>
      )}

      <div className="row-actions">
        <button type="button" className="btn danger" onClick={() => setConfirmOpen(true)}>
          清除历史记录
        </button>
      </div>

      {error ? (
        <div className="errbox" role="alert" style={{ marginTop: 12 }}>
          <b>{error.message}</b>
          <div className="code">错误码：{error.code}</div>
        </div>
      ) : null}

      {confirmOpen ? (
        <ConfirmDialog
          title="确认清除历史记录"
          confirmLabel="确认清除"
          requireAck="我已了解，清除后本机分析历史不可恢复。"
          busy={busy}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => void doClear()}
        >
          <div>将清空 IndexedDB 中的全部分析历史（不影响简历与配置）。</div>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
