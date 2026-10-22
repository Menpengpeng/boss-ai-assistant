import { usePanelState } from '../store';

/**
 * Toast 宿主：从 store 读取 toast 文案，role=status + aria-live=polite。
 * 2.4 秒自动消失由 store.toast 的定时器负责（ToastHost 本身不重复计时）。
 */
export function ToastHost(): JSX.Element {
  const state = usePanelState();
  return (
    <div
      className="ba-toast"
      role="status"
      aria-live="polite"
      data-show={state.toast ? 'true' : 'false'}
    >
      {state.toast ?? ''}
    </div>
  );
}
