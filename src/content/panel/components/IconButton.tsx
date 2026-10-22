/** 图标按钮：必须带 aria-label；点击区域固定 44px。 */
export function IconButton(p: {
  icon: string;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      className="ba-ico"
      aria-label={p.label}
      title={p.label}
      aria-pressed={p.active === undefined ? undefined : p.active}
      disabled={p.disabled}
      onClick={p.onClick}
      dangerouslySetInnerHTML={{ __html: p.icon }}
    />
  );
}
