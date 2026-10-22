import { ERROR_TIPS } from '../../../shared/errors';
import type { ErrorAction, ErrorCode } from '../../../shared/errors';
import { Button } from './Button';

/**
 * 错误卡片：标题 / 正文 / 按钮文案全部取自 ERROR_TIPS[code]，
 * 按钮点击按 tip.action 触发 onAction(action)。
 */
export function ErrorCard(p: {
  code: ErrorCode;
  message?: string;
  onAction?: (action: ErrorAction) => void;
}): JSX.Element {
  const tip = ERROR_TIPS[p.code] ?? ERROR_TIPS.UNKNOWN;
  const showAction = tip.action !== 'none' && tip.actionLabel !== '';
  return (
    <div className="ba-err" role="alert">
      <div className="ba-err-code">{p.code}</div>
      <div className="ba-err-title">{tip.title}</div>
      <div>{p.message ?? tip.body}</div>
      {showAction ? (
        <Button variant="ghost" onClick={() => p.onAction?.(tip.action)}>
          {tip.actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
