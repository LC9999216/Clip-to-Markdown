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
import { isFetchJsonRequest, isTranslateBilibiliSubtitlesRequest } from '../src/types/messages';

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
  settingsVersion: 4,
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
    translateBilibiliSubtitles: true,
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

// ---- B站字幕 AI 翻译 ----

const TRANSLATE = {
  type: 'TRANSLATE_BILIBILI_SUBTITLES',
  payload: {
    sourceTrackId: 'ai-en',
    lines: [{ from: 0, to: 2, content: 'Hello' }],
  },
};

const TRUSTED_SENDER = { url: 'chrome-extension://test-extension-id/subtitle.html' };

function translateSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const fixture = structuredClone(AI_SETTINGS_FIXTURE);
  Object.assign((fixture.ai as Record<string, unknown>), overrides);
  return fixture;
}

describe('TRANSLATE_BILIBILI_SUBTITLES payload guard', () => {
  it('接受合法载荷', () => {
    expect(isTranslateBilibiliSubtitlesRequest(TRANSLATE)).toBe(true);
  });

  it.each([
    { sourceTrackId: '', lines: [{ from: 0, to: 2, content: 'Hello' }] },
    { sourceTrackId: 'ai-en', lines: [] },
    { sourceTrackId: 'ai-en', lines: [{ from: -1, to: 2, content: 'Hello' }] },
    { sourceTrackId: 'ai-en', lines: [{ from: 0, to: 2, content: '' }] },
  ])('拒绝非法字幕翻译载荷 %#', (payload) => {
    expect(isTranslateBilibiliSubtitlesRequest({
      type: 'TRANSLATE_BILIBILI_SUBTITLES',
      payload,
    })).toBe(false);
  });

  it('拒绝带额外字段或行结构不精确的载荷', () => {
    expect(isTranslateBilibiliSubtitlesRequest({
      type: 'TRANSLATE_BILIBILI_SUBTITLES',
      payload: {
        sourceTrackId: 'ai-en',
        lines: [{ from: 0, to: 2, content: 'Hello' }],
        title: '页面标题',
      },
    })).toBe(false);
    expect(isTranslateBilibiliSubtitlesRequest({
      type: 'TRANSLATE_BILIBILI_SUBTITLES',
      payload: {
        sourceTrackId: 'ai-en',
        lines: [{ from: 0, to: 2, content: 'Hello', url: 'https://evil.example.com' }],
      },
    })).toBe(false);
    // 请求顶层也不允许多余字段
    expect(isTranslateBilibiliSubtitlesRequest({
      type: 'TRANSLATE_BILIBILI_SUBTITLES',
      payload: { sourceTrackId: 'ai-en', lines: [{ from: 0, to: 2, content: 'Hello' }] },
      pageUrl: 'https://www.bilibili.com/video/BV1xx/',
    })).toBe(false);
  });

  it('强制行数、字符数、时间与 ID 上限', () => {
    const line = { from: 0, to: 1, content: 'x' };
    expect(isTranslateBilibiliSubtitlesRequest({
      type: 'TRANSLATE_BILIBILI_SUBTITLES',
      payload: { sourceTrackId: 'ai-en', lines: Array.from({ length: 5000 }, () => ({ ...line })) },
    })).toBe(true);
    expect(isTranslateBilibiliSubtitlesRequest({
      type: 'TRANSLATE_BILIBILI_SUBTITLES',
      payload: { sourceTrackId: 'ai-en', lines: Array.from({ length: 5001 }, () => ({ ...line })) },
    })).toBe(false);
    expect(isTranslateBilibiliSubtitlesRequest({
      type: 'TRANSLATE_BILIBILI_SUBTITLES',
      payload: { sourceTrackId: 'ai-en', lines: [{ from: 0, to: 1, content: 'a'.repeat(2000) }] },
    })).toBe(true);
    expect(isTranslateBilibiliSubtitlesRequest({
      type: 'TRANSLATE_BILIBILI_SUBTITLES',
      payload: { sourceTrackId: 'ai-en', lines: [{ from: 0, to: 1, content: 'a'.repeat(2001) }] },
    })).toBe(false);
    expect(isTranslateBilibiliSubtitlesRequest({
      type: 'TRANSLATE_BILIBILI_SUBTITLES',
      payload: { sourceTrackId: 'a'.repeat(128), lines: [{ ...line }] },
    })).toBe(true);
    expect(isTranslateBilibiliSubtitlesRequest({
      type: 'TRANSLATE_BILIBILI_SUBTITLES',
      payload: { sourceTrackId: 'a'.repeat(129), lines: [{ ...line }] },
    })).toBe(false);
    expect(isTranslateBilibiliSubtitlesRequest({
      type: 'TRANSLATE_BILIBILI_SUBTITLES',
      payload: { sourceTrackId: 'ai-en', lines: [{ from: 86400, to: 86400, content: 'x' }] },
    })).toBe(true);
    expect(isTranslateBilibiliSubtitlesRequest({
      type: 'TRANSLATE_BILIBILI_SUBTITLES',
      payload: { sourceTrackId: 'ai-en', lines: [{ from: 0, to: 86401, content: 'x' }] },
    })).toBe(false);
    expect(isTranslateBilibiliSubtitlesRequest({
      type: 'TRANSLATE_BILIBILI_SUBTITLES',
      payload: { sourceTrackId: 'ai-en', lines: [{ from: 3, to: 2, content: 'x' }] },
    })).toBe(false);
  });
});

describe('background TRANSLATE_BILIBILI_SUBTITLES handler', () => {
  it('非扩展 sender 被拒绝且不调用 AI fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const resp = await dispatchRuntimeMessage(TRANSLATE, { url: 'https://www.bilibili.com/video/BV1xx/' });

    expect(resp).toEqual({ success: false, code: 'AI_PROVIDER_ERROR', error: expect.stringContaining('不受信任') });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('另一个扩展的 sender 被拒绝且不调用 AI fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const resp = await dispatchRuntimeMessage(TRANSLATE, { url: 'chrome-extension://evil-extension/subtitle.html' });

    expect(resp).toEqual({ success: false, code: 'AI_PROVIDER_ERROR', error: expect.stringContaining('不受信任') });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('翻译开关关闭 → AI_TRANSLATION_DISABLED 且不调用 AI fetch', async () => {
    mockStoredSettings['clip2md.settings'] = translateSettings({ translateBilibiliSubtitles: false });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const resp = await dispatchRuntimeMessage(TRANSLATE, TRUSTED_SENDER);

    expect(resp).toEqual({ success: false, code: 'AI_TRANSLATION_DISABLED', error: expect.any(String) });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('AI 总开关关闭 → AI_TRANSLATION_DISABLED', async () => {
    mockStoredSettings['clip2md.settings'] = translateSettings({ enabled: false });
    const resp = await dispatchRuntimeMessage(TRANSLATE, TRUSTED_SENDER);
    expect(resp).toMatchObject({ success: false, code: 'AI_TRANSLATION_DISABLED' });
  });

  it('AI 字段不完整 → AI_NOT_CONFIGURED 且不调用 AI fetch', async () => {
    mockStoredSettings['clip2md.settings'] = translateSettings({ apiKey: '' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const resp = await dispatchRuntimeMessage(TRANSLATE, TRUSTED_SENDER);

    expect(resp).toEqual({ success: false, code: 'AI_NOT_CONFIGURED', error: expect.any(String) });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('Endpoint 主机权限未授予 → AI_HOST_NOT_GRANTED 且不调用 AI fetch', async () => {
    mockStoredSettings['clip2md.settings'] = translateSettings();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    // permissionsContainsMock 默认返回 false

    const resp = await dispatchRuntimeMessage(TRANSLATE, TRUSTED_SENDER);

    expect(resp).toEqual({ success: false, code: 'AI_HOST_NOT_GRANTED', error: expect.any(String) });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('已开启、已配置、已授权 → 只调用一次 AI 并返回保留时间码的中文行', async () => {
    mockStoredSettings['clip2md.settings'] = translateSettings();
    permissionsContainsMock.mockImplementation((_permissions, callback) => callback?.(true));
    const fetchMock = vi.fn().mockResolvedValue(okAiContent(JSON.stringify({
      translations: [{ id: 'L0001', text: '你好' }],
    })));
    vi.stubGlobal('fetch', fetchMock);

    const resp = await dispatchRuntimeMessage(TRANSLATE, TRUSTED_SENDER);

    expect(resp).toEqual({ success: true, lines: [{ from: 0, to: 2, content: '你好' }] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('同批次重试命中 Background 内存备忘，不重复调用 AI', async () => {
    mockStoredSettings['clip2md.settings'] = translateSettings();
    permissionsContainsMock.mockImplementation((_permissions, callback) => callback?.(true));
    const fetchMock = vi.fn().mockResolvedValue(okAiContent(JSON.stringify({
      translations: [{ id: 'L0001', text: '你好' }],
    })));
    vi.stubGlobal('fetch', fetchMock);

    expect(await dispatchRuntimeMessage(TRANSLATE, TRUSTED_SENDER)).toMatchObject({ success: true });
    fetchMock.mockClear();

    const retry = await dispatchRuntimeMessage(TRANSLATE, TRUSTED_SENDER);

    expect(retry).toEqual({ success: true, lines: [{ from: 0, to: 2, content: '你好' }] });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it.each([
    [401, 'AI_AUTH_FAILED'],
    [404, 'AI_ENDPOINT_OR_MODEL_NOT_FOUND'],
    [429, 'AI_RATE_LIMITED'],
    [503, 'AI_PROVIDER_ERROR'],
  ])('HTTP %i 映射到稳定错误码且不返回 provider 原始正文', async (status, code) => {
    mockStoredSettings['clip2md.settings'] = translateSettings();
    permissionsContainsMock.mockImplementation((_permissions, callback) => callback?.(true));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status,
      json: async () => ({ error: { message: 'secret-provider-detail sk-internal-key' } }),
    }));
    // 每个用例使用独立 sourceTrackId，避免命中前序测试写入的批次备忘
    const message = {
      type: 'TRANSLATE_BILIBILI_SUBTITLES',
      payload: { sourceTrackId: `ai-en-error-${status}`, lines: [{ from: 0, to: 2, content: 'Hello' }] },
    };

    const resp = await dispatchRuntimeMessage(message, TRUSTED_SENDER);

    expect(resp).toMatchObject({ success: false, code });
    expect(JSON.stringify(resp)).not.toContain('secret-provider-detail');
    expect(JSON.stringify(resp)).not.toContain('sk-internal-key');
    vi.unstubAllGlobals();
  });

  it('超时与网络错误映射到 AI_TIMEOUT / AI_NETWORK_ERROR', async () => {
    mockStoredSettings['clip2md.settings'] = translateSettings();
    permissionsContainsMock.mockImplementation((_permissions, callback) => callback?.(true));

    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new DOMException('aborted', 'AbortError'))
      .mockRejectedValueOnce(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);

    const timeoutMessage = {
      type: 'TRANSLATE_BILIBILI_SUBTITLES',
      payload: { sourceTrackId: 'ai-en-timeout', lines: [{ from: 0, to: 2, content: 'Hello' }] },
    };
    const networkMessage = {
      type: 'TRANSLATE_BILIBILI_SUBTITLES',
      payload: { sourceTrackId: 'ai-en-network', lines: [{ from: 0, to: 2, content: 'Hello' }] },
    };

    const timeoutResp = await dispatchRuntimeMessage(timeoutMessage, TRUSTED_SENDER);
    expect(timeoutResp).toMatchObject({ success: false, code: 'AI_TIMEOUT' });

    const networkResp = await dispatchRuntimeMessage(networkMessage, TRUSTED_SENDER);
    expect(networkResp).toMatchObject({ success: false, code: 'AI_NETWORK_ERROR' });
    vi.unstubAllGlobals();
  });

  it('AI 两次输出均非法 → AI_INVALID_RESPONSE', async () => {
    mockStoredSettings['clip2md.settings'] = translateSettings();
    permissionsContainsMock.mockImplementation((_permissions, callback) => callback?.(true));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okAiContent('not-json')));
    const message = {
      type: 'TRANSLATE_BILIBILI_SUBTITLES',
      payload: { sourceTrackId: 'ai-en-invalid', lines: [{ from: 0, to: 2, content: 'Hello' }] },
    };

    const resp = await dispatchRuntimeMessage(message, TRUSTED_SENDER);

    expect(resp).toMatchObject({ success: false, code: 'AI_INVALID_RESPONSE' });
    vi.unstubAllGlobals();
  });
});
