// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage, JobInfo } from '../../../shared/types';
import { chatContextOf, parseChat, parseChatMessages, takeRecentMessages } from '../chat';
import { loadHtml, parseInline } from './loadHtml';

function makeMessages(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 1 ? 'me' : 'hr',
    text: `消息${i}`,
    time: '',
  }));
}

describe('parseChatMessages', () => {
  it('角色归属正确且丢弃空文本消息', () => {
    const msgs = parseChatMessages(loadHtml('chat.html'));
    expect(msgs.length).toBe(4);
    expect(msgs.map((m) => m.role)).toEqual(['hr', 'me', 'hr', 'me']);
    expect(msgs[1].text).toContain('团队目前的测试体系');
  });

  it('真实结构：正文取 .message-content .text，时间取 .item-time .time，二者不混入', () => {
    const msgs = parseChatMessages(loadHtml('chat.html'));
    expect(msgs[0].text).toBe('您好，看到您的简历，方便聊聊吗？');
    expect(msgs[0].text).not.toContain('09:12');
    expect(msgs[0].time).toBe('09:12');
  });

  it('回归：输入区容器 class 含 chat-message，不得被当作消息条目', () => {
    const msgs = parseChatMessages(loadHtml('chat.html'));
    // 若 .chat-message 候选复活，输入区容器会被当成消息（其内无 .message-content 正文 → 消息数为 0）
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs.some((m) => m.text.includes('请输入消息'))).toBe(false);
  });

  it('未命中消息节点 → []', () => {
    expect(parseChatMessages(parseInline('<div class="wrapper"></div>'))).toEqual([]);
  });
});

describe('takeRecentMessages', () => {
  it('30 条时返回 20 条，首条为省略提示', () => {
    const taken = takeRecentMessages(makeMessages(30));
    expect(taken.length).toBe(20);
    expect(taken[0].role).toBe('hr');
    expect(taken[0].text).toBe('【前 11 条已省略】');
    expect(taken[19].text).toBe('消息29');
  });

  it('未超限时原样返回', () => {
    const msgs = makeMessages(5);
    expect(takeRecentMessages(msgs)).toEqual(msgs);
  });
});

describe('parseChat', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/web/geek/chat');
  });

  it('命中聊天页并取头部字段', () => {
    const ctx = parseChat(loadHtml('chat.html'));
    expect(ctx).not.toBeNull();
    expect(ctx?.hrName).toBe('王先生');
    expect(ctx?.jobTitle).toBe('软件测试高级工程师');
    expect(ctx?.company).toBe('');
    expect(ctx?.messages.length).toBe(4);
    // 无 URL id → 哈希分支
    expect(ctx?.jobId).toMatch(/^[0-9a-f]{8}$/);
  });

  it('jobId 优先取 URL 查询参数 ?id=', () => {
    window.history.replaceState({}, '', '/web/geek/chat?id=chat-abc123');
    expect(parseChat(loadHtml('chat.html'))?.jobId).toBe('chat-abc123');
  });

  it('非聊天页 → null', () => {
    window.history.replaceState({}, '', '/job_detail/x.html');
    expect(parseChat(loadHtml('chat.html'))).toBeNull();
  });

  it('消息数为 0 → null', () => {
    expect(parseChat(parseInline('<div class="chat-header"></div>'))).toBeNull();
  });
});

describe('chatContextOf', () => {
  it('有 JobInfo 时透传字段', () => {
    const job: JobInfo = {
      id: 'j1',
      title: '软件测试高级工程师',
      company: '合肥中科采象科技',
      salary: '',
      city: '',
      experience: '',
      education: '',
      tags: [],
      jd: [],
      hrName: '王先生',
      url: '',
      source: 'detail',
    };
    const ctx = chatContextOf(job, makeMessages(2));
    expect(ctx.jobId).toBe('j1');
    expect(ctx.company).toBe('合肥中科采象科技');
    expect(ctx.messages.length).toBe(2);
  });

  it('无 JobInfo 时字段为空串', () => {
    const ctx = chatContextOf(null, []);
    expect(ctx).toEqual({ jobId: '', jobTitle: '', company: '', hrName: '', messages: [] });
  });
});
