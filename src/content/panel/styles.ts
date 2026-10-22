/**
 * 侧栏样式（全部为 TS 字符串常量，注入 Shadow DOM；content script 绝不 import .css 文件）。
 *
 * - baseStyles：Shadow DOM 内的全部 UI 样式（含设计 Token 与深色模式）。
 * - hostStyles：注入页面 <head> 的最小宿主样式，只负责 #boss-ai-host 定位、悬浮球与页面挤压，
 *   必须用 !important + 高优先级 id 选择器，绝不写全局重置（避免破坏站点）。
 *
 * 设计 Token 对齐《设计说明 11.1》与高保真原型 <style>。
 */

/** 侧栏宽度（px）——默认值；用户可拖拽调整，实际值由 --ba-w CSS 变量承载。 */
export const PANEL_WIDTH = 380;

/** 侧栏允许的最小宽度（px）。 */
export const PANEL_WIDTH_MIN = 320;

/** 侧栏允许的最大宽度（px）。 */
export const PANEL_WIDTH_MAX = 560;

/** 宿主样式 <style> 的 id。 */
export const HOST_STYLE_ID = 'boss-ai-host-style';

/** 侧栏宿主节点 id。 */
export const PANEL_HOST_ID = 'boss-ai-host';

/** 悬浮球 id。 */
export const BALL_ID = 'boss-ai-ball';

/** 侧栏打开时给 <html> 添加的类名（用于挤压页面）。 */
export const PAGE_PUSH_CLASS = 'ba-page-push';

/** 设计 Token（浅色）——供 TSX 内联或程序化取色使用。 */
export const TOKENS: Record<string, string> = {
  '--primary': '#0B7074',
  '--on-primary': '#fff',
  '--pc': '#DDF3F3',
  '--on-pc': '#0B7074',
  '--accent': '#0E8588',
  '--bg': '#F3F8F8',
  '--surface': '#fff',
  '--surface2': '#EAF2F3',
  '--ink': '#14262B',
  '--ink2': '#52666B',
  '--outline': '#7E9499',
  '--line': '#DCE6E8',
  '--salary': '#D93A2A',
  '--ok-bg': '#E2F5EA',
  '--ok': '#146C43',
  '--warn-bg': '#FFF1DB',
  '--warn': '#8A4B00',
  '--err-bg': '#FDE8E8',
  '--err': '#9B1C1C',
  '--r-tag': '4px',
  '--r-btn': '8px',
  '--r-card': '12px',
  '--r-pill': '999px',
};

/** 把内联 SVG 片段包装成统一样式的图标（尺寸交给 CSS 控制）。 */
function svg(inner: string): string {
  return (
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    inner +
    '</svg>'
  );
}

/** 内联 SVG 图标表（Lucide 风格描边，宽 1.75 / 20px）。 */
export const ICONS: Record<string, string> = {
  spark: svg('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 17v4M17 19h4"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  back: svg('<path d="M15 6l-6 6 6 6"/>'),
  copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>'),
  star: svg('<path d="M12 3l2.9 6 6.1.9-4.5 4.3 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.9 9.1 9z"/>'),
  compare: svg('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  refresh: svg('<path d="M20 11a8 8 0 1 0-2.3 6.3"/><path d="M20 5v6h-6"/>'),
  settings: svg('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  send: svg('<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>'),
  bot: svg('<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 14h0M15 14h0"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  check: svg('<path d="M5 12l5 5 9-10"/>'),
  alert: svg('<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h0"/>'),
  lock: svg('<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'),
  key: svg('<circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v3M15 12v2"/>'),
  eye: svg('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>'),
  file: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>'),
  chat: svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z"/>'),
  shield: svg('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>'),
  history: svg('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 8v4l3 2"/>'),
  download: svg('<path d="M12 3v12M7 11l5 5 5-5M4 21h16"/>'),
  trash: svg('<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/>'),
  chev: svg('<path d="M9 6l6 6-6 6"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>'),
  sliders: svg('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.3M12 17h0"/>'),
};

/** Shadow DOM 内的全部 UI 样式。 */
export const baseStyles = `
:host{
--primary:#0B7074;--on-primary:#fff;--pc:#DDF3F3;--on-pc:#0B7074;--accent:#0E8588;
--bg:#F3F8F8;--surface:#fff;--surface2:#EAF2F3;--ink:#14262B;--ink2:#52666B;
--outline:#7E9499;--line:#DCE6E8;--salary:#D93A2A;
--ok-bg:#E2F5EA;--ok:#146C43;--warn-bg:#FFF1DB;--warn:#8A4B00;--err-bg:#FDE8E8;--err:#9B1C1C;
--e2:0 4px 12px rgba(10,40,45,.14);--e3:0 12px 32px rgba(10,40,45,.24);
--r-tag:4px;--r-btn:8px;--r-card:12px;--r-pill:999px;
--fs-28:28px;--fs-20:20px;--fs-15:15px;--fs-14:14px;--fs-13:13px;--fs-12:12px;
font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif;
font-size:14px;line-height:22px;color:var(--ink);text-align:left;
}
/* 深色模式：仅覆盖 Token，组件样式无需改动 */
:host([data-theme="dark"]){
--primary:#5CD0D3;--on-primary:#06282B;--pc:#13393C;--on-pc:#B5ECEE;--accent:#5CD0D3;
--bg:#0E1A1D;--surface:#16262A;--surface2:#1D3136;--ink:#E6F0F1;--ink2:#9DB2B6;
--outline:#5F7A80;--line:#2A3F44;--salary:#FF8A7A;
--ok-bg:#153424;--ok:#7FDBA8;--warn-bg:#3A2D14;--warn:#F5C77A;--err-bg:#3D1C1C;--err:#FFB4B4;
--e2:0 4px 12px rgba(0,0,0,.45);--e3:0 12px 32px rgba(0,0,0,.55);
}
*{box-sizing:border-box}
button,input,textarea,select{font:inherit;color:inherit}
button{cursor:pointer}
:focus-visible{outline:3px solid var(--primary);outline-offset:2px}

/* —— 布局骨架 —— */
.ba-root{height:100%}
.ba-panel{display:flex;flex-direction:column;height:100%;background:var(--surface);color:var(--ink);border-left:1px solid var(--line);overflow:hidden;position:relative}
.ba-resize{position:absolute;left:0;top:0;bottom:0;width:8px;cursor:col-resize;touch-action:none;user-select:none;z-index:5}
.ba-resize::after{content:'';display:block;width:3px;height:36px;margin:10px auto 0;border-radius:2px;background:var(--line);transition:background .15s}
.ba-resize:hover::after,.ba-resize:focus-visible::after,.ba-resize.ba-resizing::after{background:var(--accent)}
.ba-resize:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.ba-head{flex:none;display:flex;align-items:center;gap:8px;padding:8px 8px 8px 16px;border-bottom:1px solid var(--line)}
.ba-head .ba-titles{flex:1;min-width:0}
.ba-title{font-size:var(--fs-15);font-weight:600;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ba-sub{color:var(--ink2);font-size:var(--fs-12);line-height:18px;word-break:break-word}
.ba-body{flex:1;min-height:0;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:12px}
.ba-foot{flex:none;border-top:1px solid var(--line);padding:12px 16px;display:flex;gap:8px;background:var(--surface);box-shadow:0 -4px 12px rgba(10,40,45,.06)}
.ba-foot:empty{display:none}
.ba-foot>*{flex:1;min-width:0}

/* —— 标签栏 —— */
.ba-tabs{flex:none;display:flex;border-bottom:1px solid var(--line);overflow-x:auto;scrollbar-width:none}
.ba-tabs::-webkit-scrollbar{display:none}
.ba-tab{border:0;background:none;min-height:44px;padding:0 12px;color:var(--ink2);border-bottom:2px solid transparent;white-space:nowrap;font-size:var(--fs-13)}
.ba-tab:hover:not(:disabled){background:var(--surface2)}
.ba-tab[aria-selected="true"]{color:var(--primary);border-color:var(--primary);font-weight:600}
.ba-tab[disabled]{opacity:.5;cursor:not-allowed}

/* —— 按钮 —— */
.ba-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:0 16px;border-radius:var(--r-btn);border:1px solid var(--primary);background:var(--primary);color:var(--on-primary);font-weight:500}
.ba-btn-primary{background:var(--primary);border-color:var(--primary);color:var(--on-primary)}
.ba-btn-ghost{background:transparent;border-color:var(--primary);color:var(--primary)}
.ba-btn-danger{background:var(--err);border-color:var(--err);color:#fff}
.ba-btn:hover:not(:disabled){filter:brightness(1.08)}
.ba-btn[disabled]{background:var(--line);border-color:transparent;color:var(--ink2);cursor:not-allowed}
.ba-btn.sm{min-height:36px;padding:0 12px;font-size:var(--fs-13)}
.ba-ico{width:44px;height:44px;min-width:44px;min-height:44px;border:0;background:transparent;color:var(--ink2);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;padding:0}
.ba-ico:hover:not(:disabled){background:var(--surface2)}
.ba-ico[aria-pressed="true"]{color:var(--primary);background:var(--pc)}
.ba-close{width:44px;height:44px;min-width:44px;min-height:44px;border:0;background:transparent;color:var(--ink2);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;padding:0}
.ba-ico svg,.ba-close svg{width:20px;height:20px}
.ba-btn svg{width:16px;height:16px}

/* —— 卡片与键值 —— */
/* 四态文案契约（供三个标签任务复用，见 App.tsx 的 STATE_COPY）：
   初始态提示「点击开始分析，本插件不会自动请求」；字段/标签为空时显示「未提供」。 */
.ba-card{border:1px solid var(--line);border-radius:var(--r-card);padding:12px;background:var(--surface);display:flex;flex-direction:column;gap:8px}
.ba-card-title{font-size:var(--fs-15);font-weight:600;line-height:22px}
.ba-kv{display:flex;flex-direction:column;gap:4px}
.ba-kv-row{display:flex;gap:8px;font-size:var(--fs-13)}
.ba-kv-k{color:var(--ink2);flex:none;min-width:64px}
.ba-kv-v{color:var(--ink);flex:1;min-width:0;word-break:break-word}

/* —— 标签 —— */
.ba-tag-list{display:flex;flex-wrap:wrap;gap:4px}
.ba-tag{background:var(--surface2);color:var(--ink2);font-size:var(--fs-12);line-height:18px;padding:1px 8px;border-radius:var(--r-tag)}
.ba-tag.on{background:var(--pc);color:var(--on-pc);font-weight:600}
.ba-badge{display:inline-block;font-size:var(--fs-12);line-height:18px;padding:1px 8px;border-radius:var(--r-pill);font-weight:600;background:var(--ok-bg);color:var(--ok)}
.ba-badge.mute{background:var(--surface2);color:var(--ink2)}
.ba-badge.h{background:var(--err-bg);color:var(--err)}
.ba-badge.m{background:var(--warn-bg);color:var(--warn)}
.ba-badge.l{background:var(--ok-bg);color:var(--ok)}
.ba-badge.ai{background:var(--pc);color:var(--on-pc)}

/* —— 列表 —— */
.ba-list{display:flex;flex-direction:column;gap:8px}
.ba-li{display:flex;gap:8px;align-items:flex-start;padding:8px;border-radius:var(--r-btn);background:var(--surface2)}
.ba-score{font-size:22px;font-weight:700;color:var(--ink)}
.ba-verdict{font-size:var(--fs-13);color:var(--ink2)}

/* —— 评分环 / 进度条 —— */
.ba-ring{position:relative;display:inline-flex;align-items:center;justify-content:center;flex:none}
.ba-ring .ba-score{position:absolute;left:0;right:0;text-align:center}

/* —— 风险信号 —— */
.ba-risk{border:1px solid var(--line);border-left-width:4px;border-radius:var(--r-card);padding:10px 12px;display:flex;flex-direction:column;gap:6px;background:var(--surface)}
.ba-risk-h{border-left-color:var(--err)}
.ba-risk-m{border-left-color:var(--warn)}
.ba-risk-l{border-left-color:var(--ok)}
.ba-risk-type{display:flex;align-items:center;gap:6px;font-size:var(--fs-14);font-weight:600}
.ba-risk-ev{background:var(--surface2);border-radius:var(--r-tag);padding:6px 10px;font-size:var(--fs-12);line-height:18px;color:var(--ink2);word-break:break-word}

/* —— 错误 / 提示 / 空态 —— */
.ba-err{background:var(--err-bg);border-radius:var(--r-btn);padding:10px 12px;color:var(--err);font-size:var(--fs-13);line-height:20px;display:flex;flex-direction:column;gap:6px}
.ba-err-code{font-family:ui-monospace,Consolas,monospace;font-weight:700}
.ba-err-title{font-weight:600}
.ba-note{font-size:var(--fs-12);line-height:18px;background:var(--surface2);border-radius:var(--r-btn);padding:8px 12px;color:var(--ink2);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ba-hint{font-size:var(--fs-12);line-height:18px;color:var(--ink2)}
.ba-empty{display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;padding:24px 12px;border:1px dashed var(--line);border-radius:var(--r-card);color:var(--ink2)}

/* —— 骨架屏 / 转圈 —— */
.ba-skel{display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--line);border-radius:var(--r-card)}
.ba-skel-line{height:12px;border-radius:6px;background:var(--line);animation:ba-pulse 1s infinite alternate}
@keyframes ba-pulse{to{opacity:.4}}
.ba-spin{display:inline-block;width:14px;height:14px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:ba-spin 1s linear infinite}
@keyframes ba-spin{to{transform:rotate(360deg)}}

/* —— 弹窗 / 遮罩 —— */
.ba-modal-mask{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px;z-index:80}
.ba-modal{background:var(--surface);color:var(--ink);border-radius:var(--r-card);padding:20px 22px;width:100%;max-width:560px;max-height:92vh;overflow:auto;box-shadow:var(--e3);display:flex;flex-direction:column;gap:12px}
.ba-modal-foot{display:flex;justify-content:flex-end;gap:8px}
.ba-scrim{display:none}

/* —— 表单 —— */
.ba-field{display:flex;flex-direction:column;gap:4px;margin-top:8px}
.ba-field>label{font-size:var(--fs-12);color:var(--ink2)}
.ba-input,.ba-select,.ba-field input,.ba-field select,.ba-field textarea{width:100%;min-height:44px;border:1px solid var(--outline);border-radius:var(--r-btn);padding:0 12px;background:var(--surface);color:var(--ink)}
.ba-field textarea{min-height:96px;padding:8px 12px;resize:vertical;line-height:1.7}

/* —— 开关 —— */
.ba-switch{width:44px;height:26px;min-width:44px;min-height:26px;border-radius:13px;border:0;background:var(--outline);position:relative;flex:none;padding:0}
.ba-switch::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:.15s}
.ba-switch[aria-checked="true"]{background:var(--primary)}
.ba-switch[aria-checked="true"]::after{left:21px;background:var(--on-primary)}

/* —— 表格 —— */
.ba-table{border-collapse:collapse;width:100%;font-size:var(--fs-13)}
.ba-table .ba-th,.ba-table .ba-td{border:1px solid var(--line);padding:8px;text-align:left;vertical-align:top}
.ba-table .ba-th{background:var(--surface2);font-weight:600;white-space:nowrap}

/* —— 聊天 —— */
.ba-bubble{max-width:100%;border-radius:10px;padding:9px 12px;line-height:1.7;word-break:break-word;border:1px solid var(--line);background:var(--surface2);color:var(--ink)}
.ba-bubble-hr{align-self:flex-start}
.ba-bubble-me{align-self:flex-end;background:var(--pc);border-color:transparent;color:var(--on-pc)}
.ba-chat-input{width:100%;min-height:78px;border:1px solid var(--outline);border-radius:var(--r-btn);padding:10px 12px;resize:none;background:var(--surface);color:var(--ink)}
.ba-quick{display:flex;gap:6px;flex-wrap:wrap}
.ba-quick button{min-height:44px;border:1px solid var(--line);background:var(--surface);color:var(--ink2);border-radius:var(--r-pill);padding:0 14px;font-size:var(--fs-12)}

/* —— Toast —— */
.ba-toast{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:12px 16px;border-radius:var(--r-btn);box-shadow:var(--e3);font-size:var(--fs-13);max-width:90vw;z-index:90;transition:opacity .2s;opacity:1}
.ba-toast[data-show="false"]{opacity:0;pointer-events:none}

/* —— 原型演示控制条（仅 localhost 或 ?ba_proto=1 时渲染） —— */
.ba-proto{position:fixed;left:16px;bottom:16px;z-index:70;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-btn);box-shadow:var(--e2);font-size:var(--fs-12);color:var(--ink2);max-width:300px;padding:8px 12px;display:flex;flex-direction:column;gap:6px}
.ba-proto .ba-proto-row{display:flex;gap:4px;flex-wrap:wrap}
.ba-proto button{min-height:32px;padding:0 10px;border-radius:var(--r-btn);border:1px solid var(--line);background:transparent;color:var(--ink2)}

/* —— 窄视口：改为右侧浮层 + 半透明遮罩（遮罩点击关闭） —— */
@media (max-width:900px){
.ba-scrim{display:block;position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:0}
.ba-panel{position:relative;z-index:1}
}
@media (prefers-reduced-motion:reduce){
.ba-skel-line,.ba-spin,.ba-toast{animation:none;transition:none}
}
`;

/**
 * 注入页面 <head> 的最小宿主样式。
 * 只写 4 类规则：#boss-ai-host 定位、#boss-ai-ball 悬浮球、html.ba-page-push 挤压、窄屏浮层。
 * 绝不写全局重置（如 all:initial 作用于 * ）以免破坏站点。
 */
export const hostStyles = `
#boss-ai-host{position:fixed;top:0;right:0;width:var(--ba-w,380px);height:100vh;z-index:2147483646;border:0;margin:0;padding:0;background:transparent;display:none}
#boss-ai-host.ba-open{display:block}
#boss-ai-ball{position:fixed;right:20px;bottom:calc(20px + env(safe-area-inset-bottom,0px));width:52px;height:52px;border-radius:50%;border:0;padding:0;margin:0;background:#0B7074;color:#fff;box-shadow:0 4px 12px rgba(10,40,45,.24);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;z-index:2147483645}
#boss-ai-ball[hidden]{display:none !important}
#boss-ai-ball svg{width:24px;height:24px}
html.ba-page-push{margin-right:var(--ba-w,380px) !important}
/* 拖拽期间整页统一列宽光标并禁止选择：cursor/user-select 均为继承属性，作用于 html 即可，
   不用通配选择器（保持"宿主样式零全局规则"的样式隔离约束） */
html.ba-col-resizing{cursor:col-resize !important;user-select:none !important}
@media (max-width:900px){
html.ba-page-push{margin-right:0 !important}
#boss-ai-host{width:min(var(--ba-w,380px),94vw);box-shadow:-4px 0 20px rgba(0,0,0,.25)}
}
@media (prefers-reduced-motion:reduce){
#boss-ai-host,#boss-ai-ball{transition:none !important}
html.ba-page-push{margin-right:0 !important}
}
`;
