import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/background/background';
import { openVisualSummaryPanel } from '../src/background/visual-summary-command';
import { startVisualAnalysis } from '../src/background/visual-summary';
import {
  chromeCalls,
  dispatchCommand,
  dispatchRuntimeMessage,
  mockSessionStorage,
  mockStoredSettings,
  permissionsContainsMock,
  sidePanelOpenMock,
  setRuntimeLastError,
  tabsSendMessageMock,
  tabsQueryMock,
} from './setup';
import { visualSummaryStateKey, type VisualAnalysisState, type VisualSummary } from '../src/analysis/types';
import type { ContentDocument } from '../src/core/schema';

const root = resolve(import.meta.dirname, '..');

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('visual summary phase 1 shell', () => {
  it('declares the side panel, optional hosts, and localized shortcut', () => {
    const manifest = JSON.parse(read('src/manifest.json')) as {
      minimum_chrome_version?: string;
      permissions: string[];
      optional_host_permissions?: string[];
      side_panel?: { default_path?: string };
      commands: Record<string, {
        suggested_key?: { default?: string; mac?: string };
        description?: string;
      }>;
    };

    expect(manifest.minimum_chrome_version).toBe('116');
    expect(manifest.permissions).toContain('sidePanel');
    expect(manifest.side_panel).toEqual({ default_path: 'sidepanel.html' });
    expect(manifest.optional_host_permissions).toEqual([
      'https://*/*',
      'http://localhost/*',
      'http://127.0.0.1/*',
    ]);
    expect(manifest.commands['visual-summary']).toEqual({
      suggested_key: {
        default: 'Ctrl+Shift+Y',
        mac: 'Command+Shift+Y',
      },
      description: '__MSG_visualSummaryCommandDescription__',
    });

    const zh = JSON.parse(read('src/_locales/zh_CN/messages.json')) as Record<string, { message: string }>;
    const en = JSON.parse(read('src/_locales/en/messages.json')) as Record<string, { message: string }>;
    expect(zh.visualSummaryCommandDescription?.message).toBe('打开当前页面的视觉概览');
    expect(en.visualSummaryCommandDescription?.message).toBe('Open a visual summary of the current page');
  });

  it('builds the UI IIFE and the real background entry without generated worker wiring', () => {
    const build = read('build.mjs');
    const background = read('src/background/background.ts');
    const sidepanel = read('src/sidepanel/sidepanel.ts');

    expect(build).toContain("entryPoints: ['src/sidepanel/sidepanel.ts']");
    expect(build).toContain("outfile: 'dist/sidepanel.js'");
    expect(build).toContain("entryPoints: ['src/background/background.ts']");
    expect(build).toContain("['src/sidepanel/sidepanel.html', 'dist/sidepanel.html']");
    expect(build).toContain("['src/sidepanel/sidepanel.css', 'dist/sidepanel.css']");
    expect(build).not.toContain('stdin:');
    expect(background).toContain("import './visual-summary-command';");
    expect(sidepanel).not.toContain('chrome.commands');
  });

  it('provides a nonblank responsive idle shell with dark and reduced-motion styles', () => {
    const htmlPath = resolve(root, 'src/sidepanel/sidepanel.html');
    const cssPath = resolve(root, 'src/sidepanel/sidepanel.css');
    const scriptPath = resolve(root, 'src/sidepanel/sidepanel.ts');

    expect(existsSync(htmlPath)).toBe(true);
    expect(existsSync(cssPath)).toBe(true);
    expect(existsSync(scriptPath)).toBe(true);

    const html = existsSync(htmlPath) ? read('src/sidepanel/sidepanel.html') : '';
    const css = existsSync(cssPath) ? read('src/sidepanel/sidepanel.css') : '';
    expect(html).toContain('视觉概览');
    expect(html).toContain('等待开始');
    expect(html).toContain('sidepanel.css');
    expect(html).toContain('sidepanel.js');
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('min-width: 280px');
  });

  it('real background wiring opens exactly once against the supplied command tab', async () => {
    dispatchCommand('visual-summary', { id: 42 } as chrome.tabs.Tab);

    await vi.waitFor(() => expect(chromeCalls.sidePanelOpens).toEqual([{ tabId: 42 }]));
    expect(tabsQueryMock).not.toHaveBeenCalled();
  });

  it('opens the side panel synchronously for a command tab user gesture', () => {
    dispatchCommand('visual-summary', { id: 42 } as chrome.tabs.Tab);

    expect(sidePanelOpenMock).toHaveBeenCalledWith({ tabId: 42 });
  });

  it('notifies the user when the side panel cannot be opened', async () => {
    sidePanelOpenMock.mockRejectedValueOnce(new Error('side panel unavailable'));

    dispatchCommand('visual-summary', { id: 42 } as chrome.tabs.Tab);

    await vi.waitFor(() => expect(chromeCalls.notifications).toHaveLength(1));
    expect(chromeCalls.notifications[0]).toEqual({
      title: '一图速览无法打开',
      message: '侧栏未能打开，请在 X/Twitter 内容页重试，或点击浏览器侧边栏图标打开。',
    });
  });

  it('real background wiring falls back to the active tab', async () => {
    tabsQueryMock.mockImplementation((_queryInfo, callback) => {
      callback?.([{ id: 7 }] as chrome.tabs.Tab[]);
    });

    dispatchCommand('visual-summary');

    await vi.waitFor(() => expect(chromeCalls.sidePanelOpens).toEqual([{ tabId: 7 }]));
    expect(tabsQueryMock).toHaveBeenCalledWith(
      { active: true, currentWindow: true },
      expect.any(Function),
    );
  });

  it('returns deterministically when the active-tab query is empty', async () => {
    tabsQueryMock.mockImplementation((_queryInfo, callback) => {
      callback?.([]);
    });

    await expect(openVisualSummaryPanel()).resolves.toBe(false);
    expect(chromeCalls.sidePanelOpens).toHaveLength(0);
  });

  it('returns deterministically when the active-tab query reports runtime.lastError', async () => {
    tabsQueryMock.mockImplementation((_queryInfo, callback) => {
      setRuntimeLastError('Unable to query the active tab');
      callback?.([{ id: 99 }] as chrome.tabs.Tab[]);
    });

    await expect(openVisualSummaryPanel()).resolves.toBe(false);
    expect(chromeCalls.sidePanelOpens).toHaveLength(0);
  });

  it('save commands retain their failure notification path and never open the panel', async () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: new URL('https://example.com/unsupported'),
    });

    dispatchCommand('save-clip');
    await vi.waitFor(() => expect(chromeCalls.notifications).toHaveLength(1));
    expect(chromeCalls.notifications[0]?.title).toBe('保存失败');

    dispatchCommand('save-to-obsidian');
    await vi.waitFor(() => expect(chromeCalls.notifications).toHaveLength(2));
    expect(chromeCalls.notifications[1]?.title).toBe('保存失败');
    expect(chromeCalls.sidePanelOpens).toHaveLength(0);
  });
});

function extractedDocument(text: string, contentType: 'tweet' | 'x-article' = 'tweet'): ContentDocument {
  return {
    version: 1,
    metadata: {
      platform: 'x',
      contentType,
      sourceUrl: 'https://x.com/alice/status/123',
      author: { name: 'Alice', handle: 'alice' },
      published: '',
      ...(contentType === 'x-article' ? { title: 'Article title' } : {}),
    },
    body: contentType === 'tweet'
      ? {
          type: 'tweet',
          author: { name: 'Alice', handle: 'alice' },
          published: '',
          id: '123',
          content: [{ type: 'paragraph', children: [{ type: 'text', value: text }] }],
          media: [],
        }
      : {
          type: 'article',
          children: [{ type: 'paragraph', children: [{ type: 'text', value: text }] }],
        },
  };
}

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

const VALID_SUMMARY: VisualSummary = {
  schemaVersion: 1,
  articleType: 'comparison',
  confidence: 0.93,
  classificationReason: '文章主要比较两个 AI 工具。',
  summary: '文章比较了两种 AI 开发环境。',
  keyPoints: [
    { title: '完成度', description: 'DeepSeek Harness 完成度更高。' },
    { title: '成本', description: 'DeepSeek Harness 成本更低。' },
  ],
  structure: { label: '对比', children: [{ label: 'DeepSeek Harness' }, { label: 'Claude Code' }] },
  takeaways: ['看重成本选 DeepSeek Harness。'],
};

function aiReadyFixture(document: ContentDocument = extractedDocument('正文', 'x-article')): void {
  mockStoredSettings['clip2md.settings'] = AI_SETTINGS_FIXTURE;
  permissionsContainsMock.mockImplementation((_permissions, callback) => callback?.(true));
  tabsSendMessageMock.mockImplementation((_tabId, _message, callback) => {
    callback?.({ success: true, document });
  });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => payload } as unknown as Response;
}

function okAiContent(content: string): Response {
  return jsonResponse({ choices: [{ message: { content } }] });
}

function stateFor(tabId: number): VisualAnalysisState | undefined {
  return mockSessionStorage[visualSummaryStateKey(tabId)] as VisualAnalysisState | undefined;
}

describe('visual summary phase 5 background orchestration', () => {
  it('runs the full pipeline and persists a validated done state', async () => {
    aiReadyFixture();
    const fetchMock = vi.fn().mockResolvedValue(okAiContent(JSON.stringify(VALID_SUMMARY)));
    vi.stubGlobal('fetch', fetchMock);

    const { requestId } = await startVisualAnalysis(42);

    const state = stateFor(42);
    expect(state?.status).toBe('done');
    expect(state?.requestId).toBe(requestId);
    expect(state?.source).toEqual({
      url: 'https://x.com/alice/status/123',
      title: 'Article title',
      author: 'Alice (@alice)',
    });
    expect(state?.result).toEqual(VALID_SUMMARY);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('persists an actionable UNSUPPORTED_VISUAL_PLATFORM error for non-X content', async () => {
    const nonXDocument: ContentDocument = {
      version: 1,
      metadata: {
        platform: 'zhihu',
        contentType: 'zhihu-article',
        sourceUrl: 'https://zhuanlan.zhihu.com/p/1',
        author: { name: '作者' },
        published: '',
        title: '知乎文章',
      },
      body: {
        type: 'article',
        children: [{ type: 'paragraph', children: [{ type: 'text', value: '正文' }] }],
      },
    };
    mockStoredSettings['clip2md.settings'] = AI_SETTINGS_FIXTURE;
    tabsSendMessageMock.mockImplementation((_tabId, _message, callback) => {
      callback?.({ success: true, document: nonXDocument });
    });

    const { requestId } = await startVisualAnalysis(6);

    const state = stateFor(6);
    expect(state?.status).toBe('error');
    expect(state?.error?.code).toBe('UNSUPPORTED_VISUAL_PLATFORM');
    expect(state?.error?.message).toMatch(/仅支持 X/);
    expect(state?.requestId).toBe(requestId);
  });

  it('persists an actionable AI_NOT_CONFIGURED error when AI settings are missing', async () => {
    tabsSendMessageMock.mockImplementation((_tabId, _message, callback) => {
      callback?.({ success: true, document: extractedDocument('正文') });
    });

    const { requestId } = await startVisualAnalysis(7);

    const state = stateFor(7);
    expect(state?.status).toBe('error');
    expect(state?.error?.code).toBe('AI_NOT_CONFIGURED');
    expect(state?.error?.message).toMatch(/还没有配置 AI|请.*配置/);
    expect(state?.requestId).toBe(requestId);
  });

  it('persists an actionable AI_HOST_NOT_GRANTED error when the AI host is not authorized', async () => {
    mockStoredSettings['clip2md.settings'] = AI_SETTINGS_FIXTURE;
    // permissions.contains 保持默认 false（未授权）
    tabsSendMessageMock.mockImplementation((_tabId, _message, callback) => {
      callback?.({ success: true, document: extractedDocument('正文') });
    });

    const { requestId } = await startVisualAnalysis(8);

    const state = stateFor(8);
    expect(state?.status).toBe('error');
    expect(state?.error?.code).toBe('AI_HOST_NOT_GRANTED');
    expect(state?.error?.message).toMatch(/授权/);
    expect(state?.requestId).toBe(requestId);
  });

  it('serves a cached summary without a second AI call', async () => {
    aiReadyFixture();
    const fetchMock = vi.fn().mockResolvedValue(okAiContent(JSON.stringify(VALID_SUMMARY)));
    vi.stubGlobal('fetch', fetchMock);

    await startVisualAnalysis(9);
    await startVisualAnalysis(9);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(stateFor(9)?.status).toBe('done');
    vi.unstubAllGlobals();
  });

  it('force:true bypasses the session cache and calls AI again', async () => {
    aiReadyFixture();
    const fetchMock = vi.fn().mockResolvedValue(okAiContent(JSON.stringify(VALID_SUMMARY)));
    vi.stubGlobal('fetch', fetchMock);

    await startVisualAnalysis(10);
    await startVisualAnalysis(10, { force: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it('writes extracting → analyzing → done state transitions in order', async () => {
    aiReadyFixture();
    const statuses: string[] = [];
    const sessionSet = chrome.storage.session.set as unknown as ReturnType<typeof vi.fn>;
    const original = sessionSet.getMockImplementation() as
      | ((items: Record<string, unknown>, cb?: () => void) => void)
      | undefined;
    sessionSet.mockImplementation((items: Record<string, unknown>, cb?: () => void) => {
      const state = Object.values(items)[0] as { status?: string } | undefined;
      if (state?.status) statuses.push(state.status);
      original?.(items, cb);
    });
    const fetchMock = vi.fn().mockResolvedValue(okAiContent(JSON.stringify(VALID_SUMMARY)));
    vi.stubGlobal('fetch', fetchMock);

    await startVisualAnalysis(42);

    expect(statuses).toEqual(['extracting', 'analyzing', 'done']);
    vi.unstubAllGlobals();
  });

  it('maps AI HTTP failures to an actionable error state', async () => {
    aiReadyFixture();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'bad key' }, 401)));

    const { requestId } = await startVisualAnalysis(11);

    const state = stateFor(11);
    expect(state?.status).toBe('error');
    expect(state?.error?.code).toBe('AI_AUTH_FAILED');
    expect(state?.error?.message).toMatch(/API Key/);
    expect(state?.requestId).toBe(requestId);
    vi.unstubAllGlobals();
  });

  it('keeps newer result when an older request errors later', async () => {
    mockStoredSettings['clip2md.settings'] = AI_SETTINGS_FIXTURE;
    permissionsContainsMock.mockImplementation((_permissions, callback) => callback?.(true));
    const responses: Array<(response: unknown) => void> = [];
    tabsSendMessageMock.mockImplementation((_tabId, _message, callback) => {
      if (callback) responses.push(callback);
    });
    const fetchMock = vi.fn().mockResolvedValue(okAiContent(JSON.stringify(VALID_SUMMARY)));
    vi.stubGlobal('fetch', fetchMock);

    const older = startVisualAnalysis(71);
    await vi.waitFor(() => expect(responses).toHaveLength(1));
    const newer = startVisualAnalysis(71);
    await vi.waitFor(() => expect(responses).toHaveLength(2));

    responses[1]?.({ success: true, document: extractedDocument('newer content') });
    await newer;
    setRuntimeLastError('The old page is gone');
    responses[0]?.(undefined);
    await older;

    expect(stateFor(71)?.status).toBe('done');
    expect(stateFor(71)?.result).toEqual(VALID_SUMMARY);
    vi.unstubAllGlobals();
  });

  it('keeps newer result when an older extraction succeeds later', async () => {
    mockStoredSettings['clip2md.settings'] = AI_SETTINGS_FIXTURE;
    permissionsContainsMock.mockImplementation((_permissions, callback) => callback?.(true));
    const responses: Array<(response: unknown) => void> = [];
    tabsSendMessageMock.mockImplementation((_tabId, _message, callback) => {
      if (callback) responses.push(callback);
    });
    const fetchMock = vi.fn().mockResolvedValue(okAiContent(JSON.stringify(VALID_SUMMARY)));
    vi.stubGlobal('fetch', fetchMock);

    const older = startVisualAnalysis(72);
    await vi.waitFor(() => expect(responses).toHaveLength(1));
    const newer = startVisualAnalysis(72);
    await vi.waitFor(() => expect(responses).toHaveLength(2));

    responses[1]?.({ success: true, document: extractedDocument('newer content') });
    await newer;
    responses[0]?.({ success: true, document: extractedDocument('stale content') });
    await older;

    expect(stateFor(72)?.status).toBe('done');
    expect(stateFor(72)?.result).toEqual(VALID_SUMMARY);
    vi.unstubAllGlobals();
  });
});

describe('visual summary phase 7 cache key and error mapping', () => {
  it('different body content misses the session cache (key covers body)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okAiContent(JSON.stringify(VALID_SUMMARY)));
    vi.stubGlobal('fetch', fetchMock);

    aiReadyFixture(extractedDocument('第一版正文', 'x-article'));
    await startVisualAnalysis(81);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(stateFor(81)?.status).toBe('done');

    // 同一 URL、不同正文 → 缓存键不同 → 应再次调用 AI
    aiReadyFixture(extractedDocument('完全不同的正文', 'x-article'));
    await startVisualAnalysis(81);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(stateFor(81)?.status).toBe('done');
    vi.unstubAllGlobals();
  });

  it('different model produces a different cache key (key covers model)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okAiContent(JSON.stringify(VALID_SUMMARY)));
    vi.stubGlobal('fetch', fetchMock);

    aiReadyFixture(extractedDocument('同一正文', 'x-article'));
    await startVisualAnalysis(82);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 同一正文、不同模型 → 缓存键不同 → 应再次调用 AI
    mockStoredSettings['clip2md.settings'] = {
      ...AI_SETTINGS_FIXTURE,
      ai: { ...(AI_SETTINGS_FIXTURE.ai as Record<string, unknown>), model: 'deepseek-reasoner' },
    };
    await startVisualAnalysis(82);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it('maps every AI failure status to an actionable error state', async () => {
    const cases: Array<[number, string, RegExp]> = [
      [401, 'AI_AUTH_FAILED', /API Key|权限/],
      [403, 'AI_AUTH_FAILED', /API Key|权限/],
      [404, 'AI_ENDPOINT_OR_MODEL_NOT_FOUND', /Endpoint|模型/],
      [429, 'AI_RATE_LIMITED', /稍后重试/],
      [500, 'AI_PROVIDER_ERROR', /稍后重试/],
    ];

    for (const [status, expectedCode, messagePattern] of cases) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'x' }, status)));
      aiReadyFixture(extractedDocument('正文', 'x-article'));
      await startVisualAnalysis(83);

      const state = stateFor(83);
      expect(state?.status).toBe('error');
      expect(state?.error?.code).toBe(expectedCode);
      expect(state?.error?.message).toMatch(messagePattern);
    }
    vi.unstubAllGlobals();
  });
});
