import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import '../src/background/background';
import { openVisualSummaryPanel } from '../src/background/visual-summary-command';
import {
  chromeCalls,
  dispatchCommand,
  setRuntimeLastError,
  tabsQueryMock,
} from './setup';

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
