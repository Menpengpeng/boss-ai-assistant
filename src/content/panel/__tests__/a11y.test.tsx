// @vitest-environment jsdom
/**
 * 无障碍抽查（Task 12.4）——全部为可自动化的程序化断言，不依赖肉眼看颜色：
 * 1) 侧栏渲染出的所有 <button> 都必须有可访问名（aria-label 或可见文本）；
 * 2) Tabs 具备 role=tablist / role=tab / aria-selected，且左右方向键可切换；
 * 3) ScoreRing 有 role="img" + aria-label；
 * 4) RiskList 每个风险项同时含等级文字「高/中/低」（不能只靠颜色）；
 * 5) Modal 有 role=dialog + aria-modal、Esc 关闭、Tab 焦点陷阱；
 * 6) 对比度：对 styles.ts 的 TOKENS 与深色覆盖值程序化计算 WCAG 对比度，断言关键组合达标。
 */
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RiskItem } from '../../../shared/types';
import { App } from '../App';
import { Modal, RiskList, ScoreRing, Tabs } from '../components';
import { actions, createInitialState } from '../store';
import { baseStyles, TOKENS } from '../styles';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

/** 同步渲染（手动 act，不引入 @testing-library/react）。 */
function render(node: ReactNode): void {
  act(() => {
    root.render(node);
  });
}

/** 元素的可访问名（简化版：aria-label 优先，其次可见文本）。 */
function accessibleName(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria && aria.trim()) return aria.trim();
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('面板按钮可访问名', () => {
  it('已登录态下所有 <button> 都有 aria-label 或可见文本', () => {
    act(() => {
      actions.setState({ ...createInitialState(), auth: 'logged_in', apiReady: true });
    });
    render(<App />);
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.length).toBeGreaterThan(0);
    const unnamed = buttons
      .filter((b) => accessibleName(b) === '')
      .map((b) => b.outerHTML.slice(0, 120));
    expect(unnamed).toEqual([]);
  });

  it('未登录门控态下同样不出现无名按钮', () => {
    act(() => {
      actions.setState({ ...createInitialState(), auth: 'logged_out' });
    });
    render(<App />);
    const unnamed = Array.from(container.querySelectorAll('button')).filter(
      (b) => accessibleName(b) === '',
    );
    expect(unnamed).toEqual([]);
  });
});

describe('Tabs 语义与键盘可达', () => {
  it('role=tablist + role=tab + 仅当前项 aria-selected=true', () => {
    render(
      <Tabs
        items={[
          { id: 'a', label: '分析' },
          { id: 'b', label: '匹配度' },
          { id: 'c', label: '公司' },
        ]}
        value="b"
        onChange={() => undefined}
        ariaLabel="岗位分析标签"
      />,
    );
    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist?.getAttribute('aria-label')).toBe('岗位分析标签');
    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    expect(tabs).toHaveLength(3);
    expect(tabs.map((t) => accessibleName(t))).toEqual(['分析', '匹配度', '公司']);
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
  });

  it('左右方向键在可用标签间循环切换', () => {
    const picked: string[] = [];
    render(
      <Tabs
        items={[
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
          { id: 'c', label: 'C' },
        ]}
        value="a"
        onChange={(v) => picked.push(v)}
        ariaLabel="t"
      />,
    );
    const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    act(() => {
      tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    act(() => {
      tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(picked).toEqual(['b', 'c']);
  });
});

describe('ScoreRing 与 RiskList 的屏幕阅读器可读性', () => {
  it('ScoreRing 为 role=img 且带 aria-label（含分数）', () => {
    render(<ScoreRing score={72} />);
    const ring = container.querySelector('[role="img"]');
    expect(ring).not.toBeNull();
    expect(ring?.getAttribute('aria-label')).toBe('评分 72 分');
    expect(container.textContent).toContain('72');
  });

  it('RiskList 每项同时以文字标出等级，而非仅靠颜色', () => {
    const items: RiskItem[] = [
      { level: '高', type: '索要证件', conclusion: '要求提供身份证照片', evidence: '原文一', src: '聊天' },
      { level: '中', type: '薪资含糊', conclusion: '薪资范围不明确', evidence: '原文二', src: 'JD' },
      { level: '低', type: '加班暗示', conclusion: '偶发加班', evidence: '原文三', src: 'JD' },
    ];
    render(<RiskList items={items} dropped={1} />);
    const rows = Array.from(container.querySelectorAll('.ba-risk'));
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('高');
    expect(rows[1].textContent).toContain('中');
    expect(rows[2].textContent).toContain('低');
    // 每条都带原文依据；丢弃条数有文字提示
    expect(container.textContent).toContain('原文依据：原文一');
    expect(container.textContent).toContain('已丢弃 1 条');
  });
});

describe('Modal 键盘可达', () => {
  it('role=dialog + aria-modal，Esc 关闭，Tab 焦点陷阱循环', () => {
    let closed = 0;
    render(
      <Modal open title="使用说明" onClose={() => (closed += 1)} confirmLabel="确定" onConfirm={() => undefined}>
        <p>内容</p>
      </Modal>,
    );
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-label')).toBe('使用说明');

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'));
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    // 首个可聚焦元素自动获得焦点
    expect(document.activeElement).toBe(buttons[0]);

    // 焦点陷阱：在最后一个元素上按 Tab 应回到第一个
    act(() => {
      buttons[buttons.length - 1].focus();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    expect(document.activeElement).toBe(buttons[0]);

    // Esc 关闭
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(closed).toBe(1);
  });
});

/** 十六进制颜色 → 0-1 的 sRGB 分量。 */
function parseHex(hex: string): [number, number, number] {
  let v = hex.trim().replace(/^#/, '');
  if (v.length === 3) v = v.split('').map((c) => c + c).join('');
  const n = Number.parseInt(v.slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** WCAG 相对亮度。 */
function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 对比度（前后两色任意顺序，结果 ≥1）。 */
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** 从 baseStyles 中解析深色主题覆盖的 Token。 */
function darkTokens(): Record<string, string> {
  const block = /:host\(\[data-theme="dark"\]\)\{([^}]*)\}/.exec(baseStyles)?.[1] ?? '';
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([\w-]+)\s*:\s*(#[0-9A-Fa-f]{3,8})/g)) out[`--${m[1]}`] = m[2];
  return out;
}

describe('关键组合对比度（WCAG）', () => {
  const dark = darkTokens();

  it('浅色主题：正文 / 主按钮 / 三类状态徽标均 ≥ 4.5:1', () => {
    const pairs: Array<[string, string, string]> = [
      ['--ink', '--surface', '正文'],
      ['--ink2', '--surface', '次级正文'],
      ['--on-primary', '--primary', '主按钮文字'],
      ['--err', '--err-bg', '高风险徽标'],
      ['--warn', '--warn-bg', '中风险徽标'],
      ['--ok', '--ok-bg', '低风险徽标'],
    ];
    for (const [fg, bg, label] of pairs) {
      const ratio = contrast(TOKENS[fg], TOKENS[bg]);
      expect(ratio, `${label} ${fg} on ${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('深色主题覆盖值：对应组合同样 ≥ 4.5:1', () => {
    const pairs: Array<[string, string, string]> = [
      ['--ink', '--surface', '正文'],
      ['--ink2', '--surface', '次级正文'],
      ['--on-primary', '--primary', '主按钮文字'],
      ['--err', '--err-bg', '高风险徽标'],
      ['--warn', '--warn-bg', '中风险徽标'],
      ['--ok', '--ok-bg', '低风险徽标'],
    ];
    for (const [fg, bg, label] of pairs) {
      const f = dark[fg] ?? TOKENS[fg];
      const b = dark[bg] ?? TOKENS[bg];
      const ratio = contrast(f, b);
      expect(ratio, `${label} ${fg} on ${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('深色主题确实覆盖了正文与状态色 Token', () => {
    for (const key of ['--ink', '--ink2', '--surface', '--primary', '--err', '--warn', '--ok']) {
      expect(dark[key], `深色主题缺少 ${key}`).toBeTruthy();
    }
  });
});
