// @vitest-environment jsdom
// 聊天输入框桥接单测：写入并派发事件、聚焦，且绝不允许触发发送。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findSendButton, getChatInput, getChatInputText, insertIntoChatInput } from '../chat-bridge';

describe('chat-bridge', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('写入值并派发 input / change，聚焦并把光标放到末尾，且绝不触发发送', () => {
    document.body.innerHTML =
      '<div class="chat-input"><textarea id="chat-input"></textarea></div>' +
      '<button class="btn-send">发送</button>';

    const ta = document.querySelector('textarea') as HTMLTextAreaElement;
    const send = document.querySelector('button') as HTMLButtonElement;
    const text = '你好，方便沟通吗';

    const onClick = vi.fn();
    send.addEventListener('click', onClick);
    const onKeyDown = vi.fn();
    const onKeyPress = vi.fn();
    ta.addEventListener('keydown', onKeyDown);
    ta.addEventListener('keypress', onKeyPress);
    const onInput = vi.fn();
    const onChange = vi.fn();
    ta.addEventListener('input', onInput);
    ta.addEventListener('change', onChange);
    const focusSpy = vi.spyOn(ta, 'focus');

    expect(insertIntoChatInput(text)).toBe(true);
    expect(getChatInputText()).toBe(text);
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(ta.selectionStart).toBe(text.length);
    expect(ta.selectionEnd).toBe(text.length);

    // F6 核心断言：绝不点击发送按钮、绝不派发键盘事件
    expect(onClick).not.toHaveBeenCalled();
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(onKeyPress).not.toHaveBeenCalled();
  });

  it('React 受控 textarea（实例上覆盖 value）仍能正确回显', () => {
    document.body.innerHTML = '<textarea id="chat-input"></textarea>';
    const ta = document.querySelector('textarea') as HTMLTextAreaElement;

    // 模拟 React 在实例上定义 value 存取器：普通赋值被忽略，只有原生 setter 生效
    const nativeDesc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    Object.defineProperty(ta, 'value', {
      configurable: true,
      get() {
        return nativeDesc?.get?.call(ta);
      },
      set() {
        /* 受控组件忽略直接赋值 */
      },
    });

    expect(insertIntoChatInput('受控文本')).toBe(true);
    expect(ta.value).toBe('受控文本');
    expect(getChatInputText()).toBe('受控文本');
  });

  it('未命中输入框时返回 false 且不抛错', () => {
    document.body.innerHTML = '<div class="nothing"></div>';
    expect(getChatInput()).toBeNull();
    expect(insertIntoChatInput('x')).toBe(false);
  });

  it('contenteditable 输入框（真实页面富文本形态）：写入 textContent 并派发 input', () => {
    document.body.innerHTML =
      '<div class="bosschat-chat-input chat-message" contenteditable="true"></div>' +
      '<button class="btn btn-send">发送</button>';
    const editable = document.querySelector('[contenteditable="true"]') as HTMLElement;
    const send = document.querySelector('button') as HTMLButtonElement;

    const onInput = vi.fn();
    editable.addEventListener('input', onInput);
    const onClick = vi.fn();
    send.addEventListener('click', onClick);

    expect(getChatInput()).toBe(editable);
    expect(insertIntoChatInput('你好，方便沟通吗')).toBe(true);
    expect(editable.textContent).toBe('你好，方便沟通吗');
    expect(getChatInputText()).toBe('你好，方便沟通吗');
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('容器内嵌 contenteditable 时向内查找输入控件', () => {
    document.body.innerHTML = '<div class="chat-input"><div contenteditable="true"></div></div>';
    const editable = document.querySelector('[contenteditable="true"]') as HTMLElement;
    expect(getChatInput()).toBe(editable);
    expect(insertIntoChatInput('内嵌文本')).toBe(true);
    expect(getChatInputText()).toBe('内嵌文本');
  });

  it('findSendButton 命中发送按钮', () => {
    document.body.innerHTML = '<button class="btn-send">发送</button>';
    expect(findSendButton()).toBe(document.querySelector('.btn-send'));
  });
});
