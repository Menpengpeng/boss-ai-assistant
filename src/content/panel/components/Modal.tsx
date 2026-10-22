import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Button } from './Button';

/** 已打开的弹窗数量（供宿主判断 Esc 归属）。 */
let openCount = 0;

/** 当前是否有弹窗打开。 */
export function isModalOpen(): boolean {
  return openCount > 0;
}

const FOCUSABLE =
  'button,[href],input,textarea,select,[tabindex]:not([tabindex="-1"])';

/** 弹窗：焦点陷阱 + Esc 关闭 + role=dialog + aria-modal。 */
export function Modal(p: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  onClose: () => void;
}): JSX.Element {
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!p.open) return;
    openCount += 1;

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        p.onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const box = boxRef.current;
      if (!box) return;
      const list = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute('disabled'),
      );
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    const firstEl = boxRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    firstEl?.focus();

    return () => {
      openCount -= 1;
      document.removeEventListener('keydown', onKey, true);
    };
  }, [p.open, p.onClose]);

  if (!p.open) return <></>;

  return (
    <div className="ba-modal-mask" onClick={p.onClose}>
      <div
        className="ba-modal"
        role="dialog"
        aria-modal="true"
        aria-label={p.title}
        ref={boxRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ba-card-title">{p.title}</div>
        <div className="ba-modal-body">{p.children}</div>
        <div className="ba-modal-foot">
          <Button variant="ghost" onClick={p.onClose}>
            {p.cancelLabel ?? '关闭'}
          </Button>
          {p.confirmLabel && p.onConfirm ? (
            <Button onClick={p.onConfirm}>{p.confirmLabel}</Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
