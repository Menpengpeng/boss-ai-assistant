// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { findCompanyDetailLink, parseCompany } from '../company';
import { loadHtml, parseInline } from './loadHtml';

describe('parseCompany 命中路径', () => {
  it('解析公司名称/简介/规模/行业/融资阶段', () => {
    const info = parseCompany(loadHtml('company.html'));
    expect(info).not.toBeNull();
    expect(info?.name).toBe('合肥中科采象科技');
    expect(info?.intro).toContain('数据采集');
    expect(info?.size).toBe('100-499人');
    expect(info?.industry).toBe('企业服务/数据采集');
    expect(info?.financing).toBe('A 轮');
  });

  it('intro 截断到 2000 字', () => {
    const longIntro = '甲'.repeat(2500);
    const doc = parseInline(
      `<div class="company-info"><div class="name">测试公司</div><div class="text">${longIntro}</div></div>`,
    );
    const info = parseCompany(doc);
    expect(info?.intro.length).toBe(2000);
  });
});

describe('parseCompany 失败路径', () => {
  it('全部字段为空 → null', () => {
    expect(parseCompany(parseInline('<div class="wrapper">无关内容</div>'))).toBeNull();
  });
});

describe('parseCompany 详情页场景（真实结构回归）', () => {
  it('公司名取右侧卡片 ka 链接，而非职位标题容器 / 相似职位 / 导航', () => {
    const info = parseCompany(loadHtml('job-detail.html'));
    expect(info).not.toBeNull();
    expect(info?.name).toBe('合肥中科采象科技');
    expect(info?.name).not.toContain('软件测试高级工程师');
    expect(info?.name).not.toBe('阳光电源股份有限公司');
    expect(info?.name).not.toBe('公司');
  });

  it('规模 / 行业取 .sider-company 卡片内带图标的 p', () => {
    const info = parseCompany(loadHtml('job-detail.html'));
    expect(info?.size).toBe('100-499人');
    expect(info?.industry).toBe('企业服务/数据采集');
  });

  it('公司介绍按「公司介绍」标题定位兜底', () => {
    const info = parseCompany(loadHtml('job-detail.html'));
    expect(info?.intro).toContain('数据采集与测试解决方案');
  });

  it('卡片链接无文本时回退 title 属性', () => {
    const doc = parseInline(
      '<div class="sider-company"><a ka="job-detail-company" title="某某科技"></a></div>',
    );
    expect(parseCompany(doc)?.name).toBe('某某科技');
  });

  it('卡片整体缺失时回退工商信息全称（剥离字段名前缀）', () => {
    const doc = parseInline(
      '<div class="business-info-box"><ul class="level-list">' +
        '<li class="company-name"><span>公司名称</span>合肥中科采象科技有限公司</li>' +
        '</ul></div>',
    );
    expect(parseCompany(doc)?.name).toBe('合肥中科采象科技有限公司');
  });
});

describe('findCompanyDetailLink', () => {
  it('返回公司链接的绝对 URL', () => {
    const link = findCompanyDetailLink(loadHtml('company.html'));
    expect(new URL(link).pathname).toBe('/gongsi/abcd1234.html');
    expect(link.startsWith('http')).toBe(true);
  });

  it('未命中返回空串', () => {
    expect(findCompanyDetailLink(parseInline('<div class="wrapper"></div>'))).toBe('');
  });
});
