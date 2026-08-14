import { describe, it, expect } from 'vitest';
import '../src/content/content-script';
import { dispatchRuntimeMessage } from './setup';
import { mountFixture } from './helpers';
import type { ExtractResponse, StatusResponse } from '../src/types/messages';

/** jsdom 中重定向 window.location（jsdom 默认 origin 不匹配，用 defineProperty 覆盖） */
function setLocation(url: string): void {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: new URL(url),
  });
}

describe('content script 消息路由', () => {
  it('GET_STATUS：支持页面返回平台与类型', async () => {
    setLocation('https://x.com/alice/status/123456');
    mountFixture('x', 'normal');
    const resp = (await dispatchRuntimeMessage({ type: 'GET_STATUS' })) as StatusResponse;
    expect(resp.supported).toBe(true);
    expect(resp.platform).toBe('x');
    expect(resp.contentType).toBe('tweet');
    expect(resp.title).toBe('今天天气不错，分享一张照片，#test。');
  });

  it('GET_STATUS：知乎文章页面', async () => {
    setLocation('https://zhuanlan.zhihu.com/p/889');
    mountFixture('zhihu', 'article');
    const resp = (await dispatchRuntimeMessage({ type: 'GET_STATUS' })) as StatusResponse;
    expect(resp.supported).toBe(true);
    expect(resp.platform).toBe('zhihu');
    expect(resp.contentType).toBe('zhihu-article');
  });

  it('GET_STATUS：不支持的页面', async () => {
    setLocation('https://example.com/page');
    const resp = (await dispatchRuntimeMessage({ type: 'GET_STATUS' })) as StatusResponse;
    expect(resp.supported).toBe(false);
  });

  it('EXTRACT：返回成功文档，可用于渲染', async () => {
    setLocation('https://x.com/alice/status/123456');
    mountFixture('x', 'normal');
    const resp = (await dispatchRuntimeMessage({ type: 'EXTRACT' })) as ExtractResponse;
    expect(resp.success).toBe(true);
    if (resp.success) {
      expect(resp.document.metadata.platform).toBe('x');
      expect(resp.document.metadata.sourceUrl).toBe('https://x.com/alice/status/123456');
    }
  });

  it('EXTRACT：不支持的页面返回错误', async () => {
    setLocation('https://example.com/page');
    const resp = (await dispatchRuntimeMessage({ type: 'EXTRACT' })) as ExtractResponse;
    expect(resp.success).toBe(false);
    if (!resp.success) {
      expect(resp.error.code).toBe('UNSUPPORTED_PAGE');
    }
  });
});
