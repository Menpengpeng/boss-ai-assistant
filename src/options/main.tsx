import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { KeyboardEvent } from 'react';
import './styles.css';
import { ApiTab } from './ApiTab';
import { HistoryTab } from './HistoryTab';
import { PrivacyTab } from './PrivacyTab';
import { ResumeTab } from './ResumeTab';

/** 四个标签：支持 #api / #resume / #privacy / #history 深链。 */
type OptionsTab = 'api' | 'resume' | 'privacy' | 'history';

const TABS: { id: OptionsTab; label: string }[] = [
  { id: 'api', label: 'API 配置' },
  { id: 'resume', label: '简历' },
  { id: 'privacy', label: '隐私' },
  { id: 'history', label: '历史' },
];

function isTab(value: string): value is OptionsTab {
  return TABS.some((t) => t.id === value);
}

/** 从 location.hash 解析当前标签（非法值回落到 API 配置）。 */
function readTab(): OptionsTab {
  const hash = window.location.hash.replace(/^#/, '');
  return isTab(hash) ? hash : 'api';
}

function App() {
  const [tab, setTab] = useState<OptionsTab>(readTab);
  const [toast, setToast] = useState('');
  const [resetKey, setResetKey] = useState(0);
  const toastTimer = useRef<number | null>(null);

  // 侧栏 openOptions('api'|...) 会带 hash 打开本页，这里监听变化
  useEffect(() => {
    const onHash = (): void => setTab(readTab());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const notify = useCallback((message: string): void => {
    setToast(message);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2600);
  }, []);

  const selectTab = useCallback((next: OptionsTab): void => {
    if (window.location.hash !== `#${next}`) window.location.hash = next;
    setTab(next);
  }, []);

  /** 左右方向键在标签间切换（可访问性）。 */
  const onTablistKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const idx = TABS.findIndex((t) => t.id === tab);
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const next = TABS[(idx + dir + TABS.length) % TABS.length].id;
    selectTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  };

  const onDataCleared = useCallback((): void => setResetKey((k) => k + 1), []);

  return (
    <main className="app">
      <header className="app-header">
        <h1 className="app-title">BOSS 求职 AI 助手 · 设置</h1>
        <p className="app-subtitle">
          所有数据仅保存在本机浏览器；仅向你自行配置的模型服务商发起请求。
        </p>
      </header>

      <div className="tabs" role="tablist" aria-label="设置分类" onKeyDown={onTablistKey}>
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? 'tab on' : 'tab'}
            onClick={() => selectTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        key={resetKey}
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        className="panel"
      >
        {tab === 'api' ? <ApiTab notify={notify} /> : null}
        {tab === 'resume' ? <ResumeTab notify={notify} /> : null}
        {tab === 'privacy' ? <PrivacyTab notify={notify} onDataCleared={onDataCleared} /> : null}
        {tab === 'history' ? <HistoryTab notify={notify} /> : null}
      </div>

      <div className="toast" role="status" aria-live="polite" data-show={toast ? 'true' : 'false'}>
        {toast}
      </div>
    </main>
  );
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
