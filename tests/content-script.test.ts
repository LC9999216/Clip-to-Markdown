import { describe, it, expect, vi } from 'vitest';
import '../src/content/content-script';
import { dispatchRuntimeMessage } from './setup';
import { mountFixture } from './helpers';
import type { ExtractResponse, ExtractVisualSourceResponse, StatusResponse } from '../src/types/messages';

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

  it('GET_STATUS：X 长文章返回 x-article 类型与正式标题', async () => {
    setLocation('https://x.com/deepseek_ai/status/8888');
    mountFixture('x', 'article');
    const resp = (await dispatchRuntimeMessage({ type: 'GET_STATUS' })) as StatusResponse;
    expect(resp.supported).toBe(true);
    expect(resp.platform).toBe('x');
    expect(resp.contentType).toBe('x-article');
    expect(resp.title).toBe('从0到1带你速通DeepSeek-Harness');
  });

  it('EXTRACT：X 长文章返回 ArticleNode 文档', async () => {
    setLocation('https://x.com/deepseek_ai/status/8888');
    mountFixture('x', 'article');
    const resp = (await dispatchRuntimeMessage({ type: 'EXTRACT' })) as ExtractResponse;
    expect(resp.success).toBe(true);
    if (resp.success) {
      expect(resp.document.metadata.platform).toBe('x');
      expect(resp.document.metadata.contentType).toBe('x-article');
      expect(resp.document.body.type).toBe('article');
    }
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

describe('content script：ChatGPT', () => {
  it('GET_STATUS：正式对话返回支持', async () => {
    setLocation('https://chatgpt.com/c/abc');
    mountFixture('chatgpt', 'chat');
    const resp = (await dispatchRuntimeMessage({ type: 'GET_STATUS' })) as StatusResponse;
    expect(resp.supported).toBe(true);
    expect(resp.platform).toBe('chatgpt');
    expect(resp.contentType).toBe('chatgpt-chat');
  });

  it('GET_STATUS：空首页返回不支持', async () => {
    setLocation('https://chatgpt.com/');
    document.body.innerHTML = '<div>空页面</div>';
    const resp = (await dispatchRuntimeMessage({ type: 'GET_STATUS' })) as StatusResponse;
    expect(resp.supported).toBe(false);
  });

  it('GET_STATUS：首页临时对话返回支持', async () => {
    setLocation('https://chatgpt.com/');
    mountFixture('chatgpt', 'chat');
    const resp = (await dispatchRuntimeMessage({ type: 'GET_STATUS' })) as StatusResponse;
    expect(resp.supported).toBe(true);
    expect(resp.contentType).toBe('chatgpt-chat');
  });

  it('EXTRACT：ChatGPT 富文本用户消息返回合法 ContentDocument', async () => {
    setLocation('https://chatgpt.com/c/rich-user');
    mountFixture('chatgpt', 'rich-user');
    const resp = (await dispatchRuntimeMessage({ type: 'EXTRACT' })) as ExtractResponse;
    expect(resp.success).toBe(true);
    if (resp.success) expect(resp.document.metadata.platform).toBe('chatgpt');
  });

  it('EXTRACT：正式路由未加载返回 NOT_FOUND_BODY', async () => {
    setLocation('https://chatgpt.com/c/abc');
    document.body.innerHTML = '<div>空页面</div>';
    const resp = (await dispatchRuntimeMessage({ type: 'EXTRACT' })) as ExtractResponse;
    expect(resp.success).toBe(false);
    if (!resp.success) expect(resp.error.code).toBe('NOT_FOUND_BODY');
  });

  it('system/tool 消息不出现在支持判定（无 user/assistant → 不支持）', async () => {
    setLocation('https://chatgpt.com/');
    document.body.innerHTML =
      '<div data-message-author-role="system">系统</div><div data-message-author-role="tool">工具</div>';
    const resp = (await dispatchRuntimeMessage({ type: 'GET_STATUS' })) as StatusResponse;
    expect(resp.supported).toBe(false);
  });
});

describe('content script EXTRACT_VISUAL_SOURCE', () => {
  it('X 长文章返回 ContentDocument + Source Blocks', async () => {
    setLocation('https://x.com/deepseek_ai/status/8888');
    mountFixture('x', 'article');
    const resp = (await dispatchRuntimeMessage({ type: 'EXTRACT_VISUAL_SOURCE' })) as ExtractVisualSourceResponse;
    expect(resp.success).toBe(true);
    if (resp.success) {
      expect(resp.document.metadata.platform).toBe('x');
      expect(resp.document.metadata.contentType).toBe('x-article');
      expect(resp.document.body.type).toBe('article');
      expect(resp.sourceBlocks.length).toBeGreaterThan(0);
      expect(resp.sourceBlocks[0]!.id).toBe('B001');
      expect(resp.sourceBlocks.every((b) => /^B\d{3,}$/.test(b.id))).toBe(true);
    }
  });

  it('X 普通推文返回空 Source Blocks', async () => {
    setLocation('https://x.com/alice/status/123456');
    mountFixture('x', 'normal');
    const resp = (await dispatchRuntimeMessage({ type: 'EXTRACT_VISUAL_SOURCE' })) as ExtractVisualSourceResponse;
    expect(resp.success).toBe(true);
    if (resp.success) {
      expect(resp.document.metadata.contentType).toBe('tweet');
      expect(resp.sourceBlocks).toEqual([]);
    }
  });

  it('不支持的页面返回 UNSUPPORTED_PAGE', async () => {
    setLocation('https://example.com/page');
    const resp = (await dispatchRuntimeMessage({ type: 'EXTRACT_VISUAL_SOURCE' })) as ExtractVisualSourceResponse;
    expect(resp.success).toBe(false);
    if (!resp.success) expect(resp.error.code).toBe('UNSUPPORTED_PAGE');
  });

  it('原 EXTRACT 路径不受影响（X 长文章仍返回 ContentDocument）', async () => {
    setLocation('https://x.com/deepseek_ai/status/8888');
    mountFixture('x', 'article');
    const resp = (await dispatchRuntimeMessage({ type: 'EXTRACT' })) as ExtractResponse;
    expect(resp.success).toBe(true);
    if (resp.success) expect(resp.document.metadata.contentType).toBe('x-article');
  });
});

describe('content script NAVIGATE_TO_SOURCE', () => {
  it('routes a valid navigation request to the X Article engine', async () => {
    setLocation('https://x.com/deepseek_ai/status/8888');
    mountFixture('x', 'article');
    const target = document.querySelector('[data-contents="true"] p') as HTMLElement;
    target.scrollIntoView = vi.fn();

    const response = await dispatchRuntimeMessage({
      type: 'NAVIGATE_TO_SOURCE',
      payload: {
        expectedSourceUrl: 'https://x.com/deepseek_ai/status/8888',
        sourceBlockId: 'B001',
        sourceQuote: '这是一篇介绍 DeepSeek-Harness 的长文章，作者在 这里 首发。',
      },
    });

    expect(response).toEqual({ success: true });
    expect(target.scrollIntoView).toHaveBeenCalled();
  });

  it('returns a stable INVALID_REQUEST response for malformed navigation payloads', async () => {
    const response = await dispatchRuntimeMessage({
      type: 'NAVIGATE_TO_SOURCE',
      payload: { expectedSourceUrl: 'https://evil.example/', sourceBlockId: 'bad', sourceQuote: '' },
    });

    expect(response).toEqual({
      success: false,
      error: { code: 'INVALID_REQUEST', message: '原文导航请求无效。' },
    });
  });

  it('知乎文章返回带来源块的 V2 提取结果', async () => {
    setLocation('https://zhuanlan.zhihu.com/p/889');
    mountFixture('zhihu', 'article');
    const resp = (await dispatchRuntimeMessage({ type: 'EXTRACT_VISUAL_SOURCE' })) as ExtractVisualSourceResponse;
    expect(resp.success).toBe(true);
    if (resp.success) {
      expect(resp.sourceBlocks[0]?.id).toBe('B001');
      expect(resp.sourceBlocks.map((b) => b.text)).not.toContain('评论区内容，绝不能保存。');
    }
  });

  it('小黑盒帖子返回带来源块的 V2 提取结果', async () => {
    setLocation('https://www.xiaoheihe.cn/app/bbs/link/187550351');
    mountFixture('heybox', 'normal-post');
    const resp = (await dispatchRuntimeMessage({ type: 'EXTRACT_VISUAL_SOURCE' })) as ExtractVisualSourceResponse;
    expect(resp.success).toBe(true);
    if (resp.success) expect(resp.sourceBlocks.length).toBeGreaterThan(4);
  });

  it('ChatGPT 对话返回带来源块的 V2 提取结果', async () => {
    setLocation('https://chatgpt.com/c/test-conversation-id');
    mountFixture('chatgpt', 'chat');
    const resp = (await dispatchRuntimeMessage({ type: 'EXTRACT_VISUAL_SOURCE' })) as ExtractVisualSourceResponse;
    expect(resp.success).toBe(true);
    if (resp.success) {
      expect(resp.sourceBlocks.length).toBeGreaterThan(4);
      expect(resp.sourceBlocks.map((b) => b.text).join('\n')).not.toContain('系统提示');
    }
  });

  it('routes a valid Zhihu source anchor to the platform adapter', async () => {
    setLocation('https://zhuanlan.zhihu.com/p/889');
    mountFixture('zhihu', 'article');
    const target = document.querySelector('.RichText p') as HTMLElement;
    target.scrollIntoView = vi.fn();
    const response = await dispatchRuntimeMessage({
      type: 'NAVIGATE_TO_SOURCE',
      payload: {
        expectedSourceUrl: 'https://zhuanlan.zhihu.com/p/889',
        sourceBlockId: 'B001',
        sourceQuote: '这是一篇关于 React 渲染机制的文章。',
      },
    });
    expect(response).toEqual({ success: true });
    expect(target.scrollIntoView).toHaveBeenCalled();
  });

  it('routes a valid Xiaoheihe source anchor to the platform adapter', async () => {
    setLocation('https://www.xiaoheihe.cn/app/bbs/link/187550351');
    mountFixture('heybox', 'normal-post');
    const target = document.querySelector('.hb-article p') as HTMLElement;
    target.scrollIntoView = vi.fn();
    const response = await dispatchRuntimeMessage({
      type: 'NAVIGATE_TO_SOURCE',
      payload: {
        expectedSourceUrl: 'https://www.xiaoheihe.cn/app/bbs/link/187550351',
        sourceBlockId: 'B002',
        sourceQuote: '本人是大二升大三的一名双非计算机学生',
      },
    });
    expect(response).toEqual({ success: true });
    expect(target.scrollIntoView).toHaveBeenCalled();
  });

  it('routes a valid ChatGPT source anchor to the platform adapter', async () => {
    setLocation('https://chatgpt.com/c/test-conversation-id');
    mountFixture('chatgpt', 'chat');
    const target = document.querySelector('[data-message-id="u1"]') as HTMLElement;
    target.scrollIntoView = vi.fn();
    const response = await dispatchRuntimeMessage({
      type: 'NAVIGATE_TO_SOURCE',
      payload: {
        expectedSourceUrl: 'https://chatgpt.com/c/test-conversation-id',
        sourceBlockId: 'B001',
        sourceQuote: '有没有什么方法可以将D盘的剩余空间一部分转移到C盘当中吗?',
      },
    });
    expect(response).toEqual({ success: true });
    expect(target.scrollIntoView).toHaveBeenCalled();
  });
});
