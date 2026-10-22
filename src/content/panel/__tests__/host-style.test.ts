// @vitest-environment jsdom
// 样式契约单测：宿主样式关键规则 + baseStyles 必需类名（缺一个即失败）。
import { describe, expect, it } from 'vitest';
import { baseStyles, hostStyles } from '../styles';

/** 后续三个标签任务只会使用这些类名，必须全部有样式。 */
const REQUIRED_CLASSES = [
  'ba-panel',
  'ba-head',
  'ba-title',
  'ba-sub',
  'ba-close',
  'ba-tabs',
  'ba-tab',
  'ba-tab[aria-selected="true"]',
  'ba-body',
  'ba-foot',
  'ba-card',
  'ba-card-title',
  'ba-kv',
  'ba-kv-k',
  'ba-kv-v',
  'ba-tag',
  'ba-tag-list',
  'ba-list',
  'ba-li',
  'ba-score',
  'ba-ring',
  'ba-verdict',
  'ba-risk',
  'ba-risk-h',
  'ba-risk-m',
  'ba-risk-l',
  'ba-risk-type',
  'ba-risk-ev',
  'ba-btn',
  'ba-btn-primary',
  'ba-btn-ghost',
  'ba-btn-danger',
  'ba-btn[disabled]',
  'ba-ico',
  'ba-skel',
  'ba-skel-line',
  'ba-err',
  'ba-err-code',
  'ba-toast',
  'ba-empty',
  'ba-modal',
  'ba-modal-mask',
  'ba-switch',
  'ba-badge',
  'ba-bubble',
  'ba-bubble-hr',
  'ba-bubble-me',
  'ba-chat-input',
  'ba-quick',
  'ba-table',
  'ba-th',
  'ba-td',
  'ba-note',
  'ba-field',
  'ba-input',
  'ba-select',
  'ba-hint',
  'ba-spin',
  'ba-proto',
  'ba-resize',
  'ba-resizing',
];

describe('hostStyles', () => {
  it('包含宿主定位 / 页面挤压 / 窄屏浮层 / 减弱动效规则', () => {
    expect(hostStyles).toContain('#boss-ai-host');
    expect(hostStyles).toContain('ba-page-push');
    expect(hostStyles).toContain('z-index:2147483646');
    expect(hostStyles).toContain('@media (max-width:900px)');
    expect(hostStyles).toContain('prefers-reduced-motion');
    expect(hostStyles).toContain('#boss-ai-ball');
    expect(hostStyles).toContain('margin-right:var(--ba-w,380px) !important');
  });

  it('宽度全部由 --ba-w 变量承载（宿主宽度 / 挤压量 / 窄屏上限三处一致）', () => {
    expect(hostStyles).toContain('width:var(--ba-w,380px)');
    expect(hostStyles).toContain('width:min(var(--ba-w,380px),94vw)');
    // 拖拽期间的全局光标 / 禁止选择规则
    expect(hostStyles).toContain('html.ba-col-resizing');
  });
});

describe('baseStyles', () => {
  it('必需类名全部存在（缺一失败）', () => {
    const missing = REQUIRED_CLASSES.filter((cls) => !baseStyles.includes(cls));
    expect(missing).toEqual([]);
  });

  it('包含设计 Token 与深色模式覆盖', () => {
    expect(baseStyles).toContain('--primary:#0B7074');
    expect(baseStyles).toContain('--salary:#D93A2A');
    expect(baseStyles).toContain(':host([data-theme="dark"])');
  });
});
