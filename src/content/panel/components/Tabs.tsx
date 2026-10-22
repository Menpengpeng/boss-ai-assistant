import { useRef } from 'react';

/** 标签栏：role=tablist + role=tab + aria-selected，支持左右方向键切换。 */
export function Tabs<T extends string>(p: {
  items: { id: T; label: string; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}): JSX.Element {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  /** 在可用标签间循环移动焦点并切换。 */
  const move = (dir: 1 | -1): void => {
    const enabled = p.items.filter((it) => !it.disabled);
    if (enabled.length === 0) return;
    const current = enabled.findIndex((it) => it.id === p.value);
    const start = current < 0 ? 0 : current;
    const next = enabled[(start + dir + enabled.length) % enabled.length];
    p.onChange(next.id);
    refs.current[next.id]?.focus();
  };

  return (
    <div className="ba-tabs" role="tablist" aria-label={p.ariaLabel}>
      {p.items.map((it) => (
        <button
          key={it.id}
          ref={(el) => {
            refs.current[it.id] = el;
          }}
          type="button"
          role="tab"
          className="ba-tab"
          aria-selected={p.value === it.id}
          disabled={it.disabled}
          tabIndex={p.value === it.id ? 0 : -1}
          onClick={() => {
            if (!it.disabled) p.onChange(it.id);
          }}
          onKeyDown={(e) => {
            if (it.disabled) return;
            if (e.key === 'ArrowLeft') {
              e.preventDefault();
              move(-1);
            } else if (e.key === 'ArrowRight') {
              e.preventDefault();
              move(1);
            }
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
