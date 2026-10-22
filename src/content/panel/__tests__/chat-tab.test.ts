// @vitest-environment jsdom
// 聊天助手纯函数单测：强制高风险归一化 / 聊天原文池构造 / 最近消息截取 / 错误动作映射。
import { describe, expect, it } from 'vitest';
import { LIMITS } from '../../../shared/constants';
import type { ChatContext, ChatMessage, RiskItem } from '../../../shared/types';
import {
  chatTextOf,
  FORCED_HIGH_NOTE,
  normalizeRiskLevel,
  recentMessages,
  runErrorAction,
  withDirection,
} from '../tabs/chat';

/** 构造一条风险条目。 */
function risk(type: string, conclusion: string, level: RiskItem['level'] = '低'): RiskItem {
  return { level, type, conclusion, evidence: '原文', src: '聊天' };
}

/** 构造一段会话。 */
function messages(): ChatMessage[] {
  return [
    { role: 'hr', text: '你好，方便聊聊吗？', time: '昨天' },
    { role: 'me', text: '您好，可以的。', time: '昨天' },
  ];
}

describe('chat-tab 纯函数', () => {
  it('chatTextOf 拼接聊天原文；无消息时返回空串', () => {
    expect(chatTextOf(messages())).toBe('你好，方便聊聊吗？\n您好，可以的。');
    expect(chatTextOf(undefined)).toBe('');
  });

  it('recentMessages 默认只取最近 LIMITS.chatTake 条', () => {
    const many: ChatMessage[] = Array.from({ length: LIMITS.chatTake + 5 }, (_, i) => ({
      role: 'hr',
      text: `m${i}`,
      time: '',
    }));
    const recent = recentMessages(many);
    expect(recent.length).toBe(LIMITS.chatTake);
    expect(recent[0].text).toBe('m5');
    expect(recentMessages(messages()).length).toBe(2);
  });

  it('normalizeRiskLevel 命中证件 / 私人联系方式关键词时强制为「高」并追加说明', () => {
    const out = normalizeRiskLevel([
      risk('索要身份证 / 银行卡', '要求提供证件照片', '中'),
      risk('转移到微信', '建议加私人微信详聊', '低'),
      risk('薪资含糊', '薪资范围不明确', '低'),
    ]);
    expect(out[0].level).toBe('高');
    expect(out[0].type).toContain(FORCED_HIGH_NOTE);
    expect(out[1].level).toBe('高');
    expect(out[2].level).toBe('低');
    expect(out[2].type).not.toContain(FORCED_HIGH_NOTE);
  });

  it('withDirection 仅在末尾追加本地指示，不修改原上下文', () => {
    const ctx: ChatContext = {
      jobId: 'j1',
      jobTitle: '前端开发',
      company: '某公司',
      hrName: 'HR',
      messages: messages(),
    };
    const next = withDirection(ctx, '（请以婉拒为方向给出回复）');
    expect(next.messages.length).toBe(3);
    expect(next.messages[2]).toEqual({ role: 'me', text: '（请以婉拒为方向给出回复）', time: '' });
    expect(ctx.messages.length).toBe(2);
  });

  it('runErrorAction 把 ERROR_TIPS 的动作映射到宿主能力', () => {
    const calls: string[] = [];
    const host = {
      openOptions: (hash?: string) => calls.push(`opts:${hash}`),
      requestLogin: () => calls.push('login'),
    };
    runErrorAction('opts-api', host as never, () => calls.push('retry'));
    runErrorAction('grant', host as never, () => calls.push('retry'));
    runErrorAction('login', host as never, () => calls.push('retry'));
    runErrorAction('retry', host as never, () => calls.push('retry'));
    runErrorAction('none', host as never, () => calls.push('retry'));
    expect(calls).toEqual(['opts:api', 'opts:api', 'login', 'retry']);
  });
});
