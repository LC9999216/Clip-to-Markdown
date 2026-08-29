import { describe, it, expect, vi } from 'vitest';
import '../src/background/background';
import {
  chromeCalls,
  dispatchRuntimeMessage,
  mockSessionStorage,
  mockStoredSettings,
  permissionsContainsMock,
  tabsQueryMock,
  tabsSendMessageMock,
} from './setup';
import type { ContentDocument } from '../src/core/schema';
import { isFetchJsonRequest } from '../src/types/messages';

const SETTINGS_KEY = 'clip2md.settings';

const DOWNLOAD = {
  type: 'DOWNLOAD',
  payload: { markdown: '# hi', filename: 'tweet.md' },
};

function okJson(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(data),
  } as unknown as Response;
}

describe('background FETCH_JSON handler', () => {
  it('字幕 CDN 请求 credentials=omit → fetch 使用 omit', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ body: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const resp = await dispatchRuntimeMessage(
      {
        type: 'FETCH_JSON',
        url: 'https://aisubtitle.hdslb.com/a.json',
        credentials: 'omit',
      },
      { url: 'https://www.bilibili.com/video/BV1xx411c7mD/' },
    );

    expect(resp).toEqual({ success: true, data: { body: [] } });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://aisubtitle.hdslb.com/a.json',
      expect.objectContaining({ credentials: 'omit' }),
    );
    vi.unstubAllGlobals();
  });

  it('省略 credentials 的 B 站 API 请求默认使用 include', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ code: 0 }));
    vi.stubGlobal('fetch', fetchMock);

    const resp = await dispatchRuntimeMessage(
      { type: 'FETCH_JSON', url: 'https://api.bilibili.com/x/web-interface/view' },
      { url: 'https://www.bilibili.com/video/BV1xx411c7mD/' },
    );

    expect(resp).toEqual({ success: true, data: { code: 0 } });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.bilibili.com/x/web-interface/view',
      expect.objectContaining({ credentials: 'include' }),
    );
    vi.unstubAllGlobals();
  });

  it('credentials=same-origin 被请求守卫拒绝', async () => {
    expect(isFetchJsonRequest({
      type: 'FETCH_JSON',
      url: 'https://aisubtitle.hdslb.com/a.json',
      credentials: 'same-origin',
    })).toBe(false);
  });
});

describe('background DOWNLOAD handler', () => {
  it('受信任 sender（扩展页）→ 执行下载', async () => {
    const resp = await dispatchRuntimeMessage(DOWNLOAD, {
      url: 'chrome-extension://test-extension-id/popup.html',
    });
    expect(resp).toEqual({ success: true, filename: 'tweet.md' });
    expect(chromeCalls.downloads).toHaveLength(1);
    expect(chromeCalls.downloads[0]?.filename).toBe('tweet.md');
    expect(chromeCalls.downloads[0]?.url).toContain('data:text/markdown');
  });

  it('受信任 sender（x.com content script）→ 执行下载', async () => {
    const resp = await dispatchRuntimeMessage(DOWNLOAD, {
      url: 'https://x.com/alice/status/123',
    });
    expect(resp).toEqual({ success: true, filename: 'tweet.md' });
  });

  it('不受信任 sender → 拒绝', async () => {
    const resp = await dispatchRuntimeMessage(DOWNLOAD, {
      url: 'https://evil.example.com/',
    });
    expect(resp).toEqual({ success: false, error: expect.stringContaining('不受信任') });
    expect(chromeCalls.downloads).toHaveLength(0);
  });

  it('非法载荷 → 拒绝', async () => {
    const resp = await dispatchRuntimeMessage(
      { type: 'DOWNLOAD', payload: { markdown: '', filename: '' } },
      { url: 'https://x.com/a' },
    );
    expect(resp).toEqual({ success: false, error: '非法下载载荷。' });
    expect(chromeCalls.downloads).toHaveLength(0);
  });

  it('文件名被 sanitize', async () => {
    const resp = await dispatchRuntimeMessage(
      { type: 'DOWNLOAD', payload: { markdown: 'x', filename: 'a<b>:c.md' } },
      { url: 'chrome-extension://test-extension-id/popup.html' },
    );
    expect(resp).toEqual({ success: true, filename: 'abc.md' });
    expect(chromeCalls.downloads[0]?.filename).toBe('abc.md');
  });

  it('无已存设置：下载到根目录、saveAs 为 false', async () => {
    const resp = await dispatchRuntimeMessage(DOWNLOAD, {
      url: 'chrome-extension://test-extension-id/popup.html',
    });
    expect(resp).toEqual({ success: true, filename: 'tweet.md' });
    expect(chromeCalls.downloads[0]?.filename).toBe('tweet.md');
    expect(chromeCalls.downloads[0]?.saveAs).toBe(false);
  });

  it('设置子目录：下载路径前缀子目录', async () => {
    mockStoredSettings[SETTINGS_KEY] = { subfolder: 'Clip2MD/知乎', saveAs: false };
    const resp = await dispatchRuntimeMessage(DOWNLOAD, {
      url: 'chrome-extension://test-extension-id/popup.html',
    });
    expect(resp).toEqual({ success: true, filename: 'Clip2MD/知乎/tweet.md' });
    expect(chromeCalls.downloads[0]?.filename).toBe('Clip2MD/知乎/tweet.md');
  });

  it('设置 saveAs：下载参数 saveAs 为 true', async () => {
    mockStoredSettings[SETTINGS_KEY] = { subfolder: '', saveAs: true };
    await dispatchRuntimeMessage(DOWNLOAD, {
      url: 'chrome-extension://test-extension-id/popup.html',
    });
    expect(chromeCalls.downloads[0]?.saveAs).toBe(true);
  });

  it('恶意子目录（路径穿越）被清洗', async () => {
    mockStoredSettings[SETTINGS_KEY] = { subfolder: '../../etc', saveAs: false };
    const resp = await dispatchRuntimeMessage(DOWNLOAD, {
      url: 'chrome-extension://test-extension-id/popup.html',
    });
    expect(resp).toEqual({ success: true, filename: 'etc/tweet.md' });
    expect(chromeCalls.downloads[0]?.filename).toBe('etc/tweet.md');
  });

  it('非 DOWNLOAD 消息不处理', async () => {
    const resp = await dispatchRuntimeMessage({ type: 'GET_STATUS' }, { url: 'https://x.com/a' });
    expect(resp).toBeUndefined();
  });
});

const AI_SETTINGS_FIXTURE: Record<string, unknown> = {
  settingsVersion: 3,
  save: { subfolder: '', saveAs: false },
  filename: { template: '{date}-{title}' },
  obsidian: {
    enabled: false,
    apiUrl: 'http://127.0.0.1:27123',
    apiKey: '',
    noteDirectory: 'Clippings/Inbox',
    frontmatter: {
      sourceUrl: true,
      author: true,
      published: true,
      platform: true,
      clippedAt: true,
      tags: false,
    },
  },
  ai: {
    enabled: true,
    endpoint: 'https://api.deepseek.com/chat/completions',
    apiKey: 'sk-test',
    model: 'deepseek-chat',
    outputLanguage: 'zh-CN',
  },
};

const VALID_SUMMARY = {
  schemaVersion: 2,
  summary: ['总结一', '总结二'],
  keyPoints: [{ title: 'a', description: 'b' }, { title: 'c', description: 'd' }],
  structure: [{ title: '正文', sourceBlockId: 'B001', sourceQuote: '正文' }],
};

function okAiContent(content: string): Response {
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) } as unknown as Response;
}

function extractedDocument(): ContentDocument {
  return {
    version: 1,
    metadata: {
      platform: 'x',
      contentType: 'x-article',
      sourceUrl: 'https://x.com/alice/status/123',
      author: { name: 'Alice', handle: 'alice' },
      published: '',
      title: 'Article title',
    },
    body: {
      type: 'article',
      children: [{ type: 'paragraph', children: [{ type: 'text', value: '正文' }] }],
    },
  };
}

describe('background visual summary message handlers', () => {
  it('START_VISUAL_ANALYSIS 受信任 sender → 返回 requestId 并执行分析', async () => {
    mockStoredSettings['clip2md.settings'] = AI_SETTINGS_FIXTURE;
    permissionsContainsMock.mockImplementation((_permissions, callback) => callback?.(true));
    tabsSendMessageMock.mockImplementation((_tabId, _message, callback) => {
      callback?.({
        success: true,
        document: extractedDocument(),
        sourceBlocks: [{ id: 'B001', kind: 'paragraph', text: '正文' }],
      });
    });
    const fetchMock = vi.fn().mockResolvedValue(okAiContent(JSON.stringify(VALID_SUMMARY)));
    vi.stubGlobal('fetch', fetchMock);

    const resp = await dispatchRuntimeMessage(
      { type: 'START_VISUAL_ANALYSIS', payload: { tabId: 42 } },
      { url: 'chrome-extension://test-extension-id/sidepanel.html' },
    );

    expect(resp).toEqual({ success: true, requestId: expect.any(String) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockSessionStorage['clip2md.visualSummary.state.42']).toMatchObject({ status: 'done' });
    vi.unstubAllGlobals();
  });

  it('START_VISUAL_ANALYSIS 不受信任 sender → 拒绝', async () => {
    const resp = await dispatchRuntimeMessage(
      { type: 'START_VISUAL_ANALYSIS', payload: { tabId: 42 } },
      { url: 'https://evil.example.com/' },
    );
    expect(resp).toEqual({ success: false, error: expect.stringContaining('不受信任') });
  });

  it('START_VISUAL_ANALYSIS 非法载荷 → 拒绝', async () => {
    const resp = await dispatchRuntimeMessage(
      { type: 'START_VISUAL_ANALYSIS', payload: { tabId: 'not-a-number' } },
      { url: 'https://x.com/a' },
    );
    expect(resp).toEqual({ success: false, error: '非法一图速览载荷。' });
  });

  it('GET_VISUAL_ANALYSIS_STATE 受信任 sender → 返回当前状态', async () => {
    mockSessionStorage['clip2md.visualSummary.state.7'] = { status: 'extracting', tabId: 7, requestId: 'r1', updatedAt: 1 };
    const resp = await dispatchRuntimeMessage(
      { type: 'GET_VISUAL_ANALYSIS_STATE', payload: { tabId: 7 } },
      { url: 'chrome-extension://test-extension-id/sidepanel.html' },
    );
    expect(resp).toEqual({
      success: true,
      state: expect.objectContaining({ status: 'extracting', tabId: 7 }),
    });
  });

  it('GET_VISUAL_ANALYSIS_STATE 无状态 → 返回 null', async () => {
    const resp = await dispatchRuntimeMessage(
      { type: 'GET_VISUAL_ANALYSIS_STATE', payload: { tabId: 99 } },
      { url: 'chrome-extension://test-extension-id/sidepanel.html' },
    );
    expect(resp).toEqual({ success: true, state: null });
  });

  it('TEST_AI 受信任 sender → 返回模型名', async () => {
    mockStoredSettings['clip2md.settings'] = AI_SETTINGS_FIXTURE;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okAiContent('OK')));
    const resp = await dispatchRuntimeMessage(
      { type: 'TEST_AI' },
      { url: 'chrome-extension://test-extension-id/options.html' },
    );
    expect(resp).toEqual({ success: true, model: 'deepseek-chat' });
    vi.unstubAllGlobals();
  });

  it('TEST_AI 不受信任 sender → 拒绝', async () => {
    const resp = await dispatchRuntimeMessage({ type: 'TEST_AI' }, { url: 'https://evil.example.com/' });
    expect(resp).toEqual({ success: false, error: expect.stringContaining('不受信任') });
  });

  it('TEST_AI AI 失败 → 返回可操作错误', async () => {
    mockStoredSettings['clip2md.settings'] = AI_SETTINGS_FIXTURE;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
    const resp = await dispatchRuntimeMessage(
      { type: 'TEST_AI' },
      { url: 'chrome-extension://test-extension-id/options.html' },
    );
    expect(resp).toEqual({ success: false, error: expect.stringContaining('API Key') });
    vi.unstubAllGlobals();
  });
});

describe('background SAVE_CURRENT_TAB handler (Phase 8)', () => {
  it('受信任 sender → 以指定标签页保存并返回文件名，不查询活动标签', async () => {
    mockStoredSettings['clip2md.settings'] = {};
    tabsSendMessageMock.mockImplementation((_tabId, _message, callback) => {
      callback?.({ success: true, document: extractedDocument() });
    });
    tabsQueryMock.mockClear();

    const resp = await dispatchRuntimeMessage(
      { type: 'SAVE_CURRENT_TAB', payload: { tabId: 5 } },
      { url: 'chrome-extension://test-extension-id/sidepanel.html' },
    );

    expect(resp).toEqual({ success: true, filename: expect.stringMatching(/\.md$/) });
    expect(tabsQueryMock).not.toHaveBeenCalled();
    expect(tabsSendMessageMock).toHaveBeenCalledWith(5, { type: 'EXTRACT' }, expect.any(Function));
    expect(chromeCalls.downloads).toHaveLength(1);
  });

  it('非法载荷 → 拒绝', async () => {
    const resp = await dispatchRuntimeMessage(
      { type: 'SAVE_CURRENT_TAB', payload: { tabId: 'not-a-number' } },
      { url: 'chrome-extension://test-extension-id/sidepanel.html' },
    );
    expect(resp).toEqual({ success: false, error: '非法保存载荷。' });
  });

  it('不受信任 sender → 拒绝', async () => {
    const resp = await dispatchRuntimeMessage(
      { type: 'SAVE_CURRENT_TAB', payload: { tabId: 5 } },
      { url: 'https://evil.example.com/' },
    );
    expect(resp).toEqual({ success: false, error: expect.stringContaining('不受信任') });
  });
});
