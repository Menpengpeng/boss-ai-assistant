import { Button } from './Button';

/** 空数据 / 引导态。 */
export function EmptyState(p: {
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}): JSX.Element {
  return (
    <div className="ba-empty">
      <div className="ba-card-title">{p.title}</div>
      {p.body ? <div className="ba-sub">{p.body}</div> : null}
      {p.actionLabel ? (
        <Button variant="ghost" onClick={p.onAction}>
          {p.actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
