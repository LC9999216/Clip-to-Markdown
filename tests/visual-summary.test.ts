import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import '../src/background/background';
import { openVisualSummaryPanel } from '../src/background/visual-summary-command';
import {
  chromeCalls,
  dispatchCommand,
  mockSessionStorage,
  setRuntimeLastError,
  tabsSendMessageMock,
  tabsQueryMock,
} from './setup';
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
        default: 'Ctrl+Shift+V',
        mac: 'Command+Shift+V',
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

describe('visual summary phase 2 preview extraction', () => {
  it('opens the panel, extracts the command tab, and persists a 300-character preview', async () => {
    tabsSendMessageMock.mockImplementation((_tabId, message, callback) => {
      expect(message).toEqual({ type: 'EXTRACT' });
      callback?.({ success: true, document: extractedDocument('甲'.repeat(340), 'x-article') });
    });

    dispatchCommand('visual-summary', { id: 42 } as chrome.tabs.Tab);

    await vi.waitFor(() => {
      expect(mockSessionStorage['clip2md.visualSummary.state.42']).toMatchObject({
        status: 'done',
        preview: {
          title: 'Article title',
          author: 'Alice (@alice)',
          body: '甲'.repeat(300),
          contentType: 'x-article',
          sourceUrl: 'https://x.com/alice/status/123',
        },
      });
    });
    expect(chromeCalls.sidePanelOpens).toEqual([{ tabId: 42 }]);
    expect(tabsSendMessageMock).toHaveBeenCalledTimes(1);
  });

  it('runs a fresh EXTRACT on every shortcut trigger for an X SPA', async () => {
    tabsSendMessageMock
      .mockImplementationOnce((_tabId, _message, callback) => {
        callback?.({ success: true, document: extractedDocument('first route') });
      })
      .mockImplementationOnce((_tabId, _message, callback) => {
        callback?.({ success: true, document: extractedDocument('second route') });
      });

    dispatchCommand('visual-summary', { id: 9 } as chrome.tabs.Tab);
    await vi.waitFor(() => {
      expect(mockSessionStorage['clip2md.visualSummary.state.9']).toMatchObject({
        preview: { body: 'first route' },
      });
    });

    dispatchCommand('visual-summary', { id: 9 } as chrome.tabs.Tab);
    await vi.waitFor(() => {
      expect(mockSessionStorage['clip2md.visualSummary.state.9']).toMatchObject({
        preview: { body: 'second route' },
      });
    });
    expect(tabsSendMessageMock).toHaveBeenCalledTimes(2);
  });

  it('persists an actionable error when extraction cannot reach the page', async () => {
    tabsSendMessageMock.mockImplementation((_tabId, _message, callback) => {
      setRuntimeLastError('Receiving end does not exist');
      callback?.(undefined);
    });

    dispatchCommand('visual-summary', { id: 5 } as chrome.tabs.Tab);

    await vi.waitFor(() => {
      expect(mockSessionStorage['clip2md.visualSummary.state.5']).toMatchObject({
        status: 'error',
        error: expect.stringMatching(/仅支持 X.*刷新|刷新.*仅支持 X/),
      });
    });
  });

  it('persists an actionable error for extracted non-X content', async () => {
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
    tabsSendMessageMock.mockImplementation((_tabId, _message, callback) => {
      callback?.({ success: true, document: nonXDocument });
    });

    dispatchCommand('visual-summary', { id: 6 } as chrome.tabs.Tab);

    await vi.waitFor(() => {
      expect(mockSessionStorage['clip2md.visualSummary.state.6']).toMatchObject({
        status: 'error',
        error: expect.stringMatching(/仅支持 X 推文和 X Article/),
      });
    });
  });
});
