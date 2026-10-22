import type { ReactNode } from 'react';

/** 通用按钮：primary / ghost / danger；busy 时显示转圈并禁用。 */
export function Button(p: {
  children: ReactNode;
  variant?: 'primary' | 'ghost' | 'danger';
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  title?: string;
  'aria-label'?: string;
}): JSX.Element {
  const variant = p.variant ?? 'primary';
  const disabled = Boolean(p.disabled || p.busy);
  return (
    <button
      type="button"
      className={`ba-btn ba-btn-${variant}`}
      onClick={p.onClick}
      disabled={disabled}
      title={p.title}
      aria-label={p['aria-label']}
      aria-busy={p.busy ? true : undefined}
    >
      {p.busy ? <span className="ba-spin" aria-hidden="true" /> : null}
      <span>{p.children}</span>
    </button>
  );
}
