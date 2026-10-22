import { toast } from '../store';
import { ICONS } from '../styles';
import { Button } from './Button';

/** 复制到剪贴板：优先 navigator.clipboard，失败回退 document.execCommand。 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 回退到 execCommand */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** 复制按钮：成功后 toast('已复制')。 */
export function CopyButton(p: {
  text: string;
  label?: string;
  onCopied?: () => void;
}): JSX.Element {
  const onClick = (): void => {
    void copyText(p.text).then((ok) => {
      if (ok) {
        toast('已复制');
        p.onCopied?.();
      } else {
        toast('复制失败，请手动选择文本复制');
      }
    });
  };
  return (
    <Button variant="ghost" onClick={onClick} aria-label={p.label ?? '复制'}>
      <span dangerouslySetInnerHTML={{ __html: ICONS.copy }} />
      {p.label ?? '复制'}
    </Button>
  );
}
