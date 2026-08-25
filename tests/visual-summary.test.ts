import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as sidepanel from '../src/sidepanel/sidepanel';

const root = resolve(import.meta.dirname, '..');

type Tab = { id?: number };
type CommandListener = (command: string, tab?: Tab) => void;
type VisualSummaryApi = {
  commands: { onCommand: { addListener: (listener: CommandListener) => void } };
  tabs: { query: (queryInfo: { active: boolean; currentWindow: boolean }, callback: (tabs: Tab[]) => void) => void };
  sidePanel: { open: (options: { tabId: number }) => Promise<void> };
};

const moduleUnderTest = sidepanel as unknown as {
  openVisualSummaryPanel?: (tab: Tab | undefined, api: VisualSummaryApi) => Promise<boolean>;
  installVisualSummaryCommandHandler?: (api: VisualSummaryApi) => void;
};

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

  it('builds the side panel IIFE and copies its static assets', () => {
    const build = read('build.mjs');

    expect(build).toContain("entryPoints: ['src/sidepanel/sidepanel.ts']");
    expect(build).toContain("outfile: 'dist/sidepanel.js'");
    expect(build).toContain("['src/sidepanel/sidepanel.html', 'dist/sidepanel.html']");
    expect(build).toContain("['src/sidepanel/sidepanel.css', 'dist/sidepanel.css']");
    expect(build).toContain('installVisualSummaryCommandHandler');
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

  it('opens against the command tab immediately without querying again', async () => {
    const open = vi.fn(async () => {});
    const query = vi.fn();
    const api = {
      commands: { onCommand: { addListener: vi.fn() } },
      tabs: { query },
      sidePanel: { open },
    } as unknown as VisualSummaryApi;

    expect(typeof moduleUnderTest.openVisualSummaryPanel).toBe('function');
    if (!moduleUnderTest.openVisualSummaryPanel) return;

    await expect(moduleUnderTest.openVisualSummaryPanel({ id: 42 }, api)).resolves.toBe(true);
    expect(query).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith({ tabId: 42 });
  });

  it('queries the active tab when the command has no valid tab id', async () => {
    const open = vi.fn(async () => {});
    const query = vi.fn((_queryInfo, callback: (tabs: Tab[]) => void) => callback([{ id: 7 }]));
    const api = {
      commands: { onCommand: { addListener: vi.fn() } },
      tabs: { query },
      sidePanel: { open },
    } as unknown as VisualSummaryApi;

    expect(typeof moduleUnderTest.openVisualSummaryPanel).toBe('function');
    if (!moduleUnderTest.openVisualSummaryPanel) return;

    await expect(moduleUnderTest.openVisualSummaryPanel({ id: -1 }, api)).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(
      { active: true, currentWindow: true },
      expect.any(Function),
    );
    expect(open).toHaveBeenCalledWith({ tabId: 7 });
  });

  it('registers only the visual-summary command and preserves other command behavior', async () => {
    let listener: CommandListener | undefined;
    const open = vi.fn(async () => {});
    const api: VisualSummaryApi = {
      commands: { onCommand: { addListener: (value) => { listener = value; } } },
      tabs: { query: (_queryInfo, callback) => callback([{ id: 9 }]) },
      sidePanel: { open },
    };

    expect(typeof moduleUnderTest.installVisualSummaryCommandHandler).toBe('function');
    if (!moduleUnderTest.installVisualSummaryCommandHandler) return;

    moduleUnderTest.installVisualSummaryCommandHandler(api);
    expect(listener).toBeTypeOf('function');
    listener?.('save-clip', { id: 3 });
    expect(open).not.toHaveBeenCalled();

    listener?.('visual-summary', { id: 11 });
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith({ tabId: 11 }));
  });
});
