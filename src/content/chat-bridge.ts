/**
 * 站点聊天输入框桥接（F6）。
 *
 * 硬性约束：只负责「把文本填入输入框」，绝不触发发送 ——
 * 不点击发送按钮、不派发 Enter 键、不提交表单。发送永远由用户自己完成。
 *
 * React 受控输入陷阱：直接 `el.value = x` 时受控组件不回显，
 * 因此必须用原型上的原生 value setter 写入，再派发 input / change 事件。
 */
import { CHAT_SELECTORS, qs } from '../shared/selectors';

/** 站点聊天输入控件：textarea / input，或 contenteditable 元素（真实页面两种形态都存在）。 */
export type ChatInputElement = HTMLTextAreaElement | HTMLInputElement | HTMLElement;

/** 是否为表单类输入控件。 */
function isFormInput(el: HTMLElement): el is HTMLTextAreaElement | HTMLInputElement {
  return el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;
}

/** 取站点聊天输入框：命中容器时向内查找真正的输入控件（textarea → input → contenteditable）。 */
export function getChatInput(): ChatInputElement | null {
  const el = qs<HTMLElement>(document, CHAT_SELECTORS.input);
  if (!el) return null;
  if (isFormInput(el)) return el;
  const inner = el.querySelector<HTMLTextAreaElement | HTMLInputElement>('textarea, input');
  if (inner) return inner;
  // isContentEditable 在 jsdom 中支持不完整，补充属性值判断
  if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return el;
  return el.querySelector<HTMLElement>('[contenteditable="true"]');
}

/** 读取输入框当前文本（textarea/input 取 value，contenteditable 取 textContent）；未命中返回 ''。 */
export function getChatInputText(): string {
  const el = getChatInput();
  if (!el) return '';
  return isFormInput(el) ? (el.value ?? '') : (el.textContent ?? '');
}

/**
 * 把文本写入输入框：原生 setter 写值 → 派发 input 与 change → 聚焦并把光标放到末尾。
 * contenteditable 元素用 textContent 写入并派发 InputEvent（Vue/React 富文本输入区的通用做法）。
 * 返回是否成功写入（未命中输入框返回 false）。
 */
export function insertIntoChatInput(text: string): boolean {
  const el = getChatInput();
  if (!el) return false;

  if (isFormInput(el)) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) {
      setter.call(el, text);
    } else {
      el.value = text;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    el.textContent = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
  }

  try {
    el.focus();
  } catch {
    /* 某些环境不允许聚焦，忽略 */
  }

  try {
    const end = text.length;
    if (isFormInput(el) && typeof el.setSelectionRange === 'function') el.setSelectionRange(end, end);
  } catch {
    /* 部分 input type 不支持选区操作，忽略 */
  }

  return true;
}

/** 取站点发送按钮（仅用于存在性判断，绝不点击）。 */
export function findSendButton(): HTMLElement | null {
  return qs<HTMLElement>(document, CHAT_SELECTORS.sendButton);
}
