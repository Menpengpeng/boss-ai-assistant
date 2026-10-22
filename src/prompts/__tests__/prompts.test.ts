import { describe, expect, it } from 'vitest';
import type { LLMPayload } from '../../shared/protocol';
import type { ChatContext, JobInfo, LLMTask } from '../../shared/types';
import { COMMON_RULES, getPrompt, isJsonTask, PROMPTS, PROMPT_VERSION } from '../index';

/** 全部 8 类任务。 */
const TASKS: LLMTask[] = [
  'jobAnalysis',
  'match',
  'greeting',
  'chatReply',
  'chatRisk',
  'company',
  'interview',
  'quickReview',
];

/** 样例岗位。 */
const job: JobInfo = {
  id: 'j1',
  title: '前端工程师',
  company: '示例科技',
  salary: '20-40K',
  city: '上海',
  experience: '3-5年',
  education: '本科',
  tags: ['React', 'TypeScript'],
  jd: ['负责前端开发', '要求抗压能力强'],
  hrName: '王女士',
  url: 'https://example.com/job/1',
  source: 'detail',
};

/** 样例会话。 */
const context: ChatContext = {
  jobId: 'j1',
  jobTitle: '前端工程师',
  company: '示例科技',
  hrName: '王女士',
  messages: [
    { role: 'hr', text: '你好，方便加个微信吗', time: '10:00' },
    { role: 'me', text: '您好，想先了解下岗位', time: '10:02' },
  ],
};

/** 各任务的完整 payload。 */
const payloadByTask: Record<LLMTask, LLMPayload> = {
  jobAnalysis: { job },
  match: { job },
  greeting: { job },
  chatReply: { context },
  chatRisk: { context },
  company: { job },
  interview: { job },
  quickReview: { job },
};

describe('PROMPTS 覆盖', () => {
  it('覆盖全部 8 个 LLMTask', () => {
    expect(Object.keys(PROMPTS).sort()).toEqual([...TASKS].sort());
    for (const task of TASKS) {
      expect(PROMPTS[task].task).toBe(task);
    }
  });

  it('导出 Prompt 版本常量', () => {
    expect(PROMPT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('getPrompt 取出对应任务，未知 task 抛错', () => {
    expect(getPrompt('greeting').output).toBe('text');
    expect(() => getPrompt('nope' as LLMTask)).toThrow();
  });

  it('isJsonTask 与 output 一致', () => {
    for (const task of TASKS) {
      expect(isJsonTask(task)).toBe(PROMPTS[task].output === 'json');
    }
    expect(isJsonTask('greeting')).toBe(false);
    expect(isJsonTask('jobAnalysis')).toBe(true);
  });
});

describe('system 公共约束', () => {
  it('每个 system 都原样包含 COMMON_RULES 及其关键约束', () => {
    for (const task of TASKS) {
      const system = PROMPTS[task].system;
      expect(system).toContain(COMMON_RULES);
      for (const keyword of ['未提供', '原样复制', '60 字', '非权威核实']) {
        expect(system).toContain(keyword);
      }
    }
  });
});

describe('buildUser', () => {
  it('传入完整 payload 时输出包含岗位标题与公司名', () => {
    for (const task of TASKS) {
      const out = PROMPTS[task].buildUser(payloadByTask[task]);
      expect(out).toContain('前端工程师');
      expect(out).toContain('示例科技');
    }
  });

  it('未提供简历时写明「未提供简历」', () => {
    expect(PROMPTS.jobAnalysis.buildUser({ job })).toContain('未提供简历');
  });

  it('读取 payload 上的 resumeText 扩展字段', () => {
    const out = PROMPTS.greeting.buildUser({ job, resumeText: '三年 React 开发经验' } as LLMPayload);
    expect(out).toContain('三年 React 开发经验');
  });

  it('JD 超长（>12000 字）时输出长度被控制', () => {
    const longPayload = { job: { ...job, jd: ['A'.repeat(20000)] } } as LLMPayload;
    const out = PROMPTS.jobAnalysis.buildUser(longPayload);
    expect(out.length).toBeLessThan(13000);
    expect(out.length).toBeGreaterThan(11000);
  });
});

describe('evidencePools', () => {
  it('jobAnalysis 返回含 JD / 薪资 / 标签 三个来源的文本池', () => {
    const pools = PROMPTS.jobAnalysis.evidencePools?.({ job }) ?? {};
    expect(Object.keys(pools).sort()).toEqual(['JD', '标签', '薪资']);
    expect(pools.JD).toContain('抗压能力强');
    expect(pools['薪资']).toBe('20-40K');
    expect(pools['标签']).toContain('React');
  });

  it('chatReply 返回聊天文本池', () => {
    const pools = PROMPTS.chatReply.evidencePools?.({ context }) ?? {};
    expect(pools['聊天']).toContain('方便加个微信');
  });
});
