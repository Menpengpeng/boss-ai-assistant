/**
 * Options 页共用展示组件：开关、数字输入、弹窗与二次确认框。
 * 仅包含无业务逻辑的 UI 原语，所有交互通过回调上抛。
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

/** 开关（原生 button + role="switch"）。 */
export function Switch({
  checked,
  onChange,
  ariaLabel,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={checked ? 'switch on' : 'switch'}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="track">
        <span className="knob" aria-hidden="true" />
      </span>
    </button>
  );
}

/** 数字输入：内部保留字符串态，避免「0.」等中间态被立即回写。 */
export function NumField({
  id,
  label,
  value,
  min,
  max,
  step,
  hint,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  onChange: (next: number) => void;
}) {
  const [text, setText] = useState(() => String(value));

  // 仅当外部值与本输入解析结果不一致时同步（避免打字过程被覆盖）
  useEffect(() => {
    if (Number(text) !== value) setText(String(value));
  }, [value]);

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={text}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          const n = Number(next);
          if (next.trim() !== '' && Number.isFinite(n)) onChange(n);
        }}
      />
      {hint ? <div className="h">{hint}</div> : null}
    </div>
  );
}

/** 模态框：点击遮罩或按 Esc 关闭。 */
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-mask" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="modal-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** 二次确认框：可要求勾选确认后才能继续。 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  requireAck,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  requireAck?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [ack, setAck] = useState(false);
  const blocked = Boolean(busy) || (Boolean(requireAck) && !ack);

  return (
    <Modal title={title} onClose={onCancel}>
      <div className="modal-body">{children}</div>
      {requireAck ? (
        <label className="check">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span>{requireAck}</span>
        </label>
      ) : null}
      <div className="row-actions">
        <button type="button" className="btn danger" disabled={blocked} onClick={onConfirm}>
          {busy ? '处理中…' : confirmLabel}
        </button>
        <button type="button" className="btn outline" onClick={onCancel}>
          取消
        </button>
      </div>
    </Modal>
  );
}
