import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { commandsGetAllMock, mockStoredSettings, runtimeSendMessageMock } from './setup';

const optionsHtml = readFileSync(
  join(process.cwd(), 'src', 'options', 'options.html'),
  'utf8',
).replace('<script src="options.js"></script>', '');

function mountOptionsHtml(): void {
  document.open();
  document.write(optionsHtml);
  document.close();
}

const folderMocks = vi.hoisted(() => ({
  loadDirectoryHandle: vi.fn(),
  saveDirectoryHandle: vi.fn(),
  clearDirectoryHandle: vi.fn(),
}));

vi.mock('../src/core/custom-folder', () => folderMocks);

function fakeDirectoryHandle(name: string): FileSystemDirectoryHandle {
  return { name } as FileSystemDirectoryHandle;
}

async function bootOptions(handle: FileSystemDirectoryHandle | null = null): Promise<void> {
  folderMocks.loadDirectoryHandle.mockResolvedValue(handle);
  folderMocks.saveDirectoryHandle.mockResolvedValue(undefined);
  folderMocks.clearDirectoryHandle.mockResolvedValue(undefined);

  commandsGetAllMock.mockImplementation((callback?: (commands: chrome.commands.Command[]) => void) => {
    const commands = [{ name: 'save-clip', shortcut: 'Ctrl+Shift+S' } as chrome.commands.Command];
    callback?.(commands);
    return Promise.resolve(commands) as never;
  });
  runtimeSendMessageMock.mockImplementation((_message, callback?: (response: unknown) => void) => {
    callback?.({ success: true, service: 'Obsidian Local REST API' });
  });

  await import('../src/options/options');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await vi.waitFor(() => {
    expect(document.getElementById('shortcut-value')?.textContent).toContain('Ctrl+Shift+S');
  });
}

beforeEach(() => {
  vi.resetModules();
  folderMocks.loadDirectoryHandle.mockReset();
  folderMocks.saveDirectoryHandle.mockReset();
  folderMocks.clearDirectoryHandle.mockReset();
  commandsGetAllMock.mockReset();
  runtimeSendMessageMock.mockReset();
  mountOptionsHtml();
  mockStoredSettings['clip2md.settings'] = {
    subfolder: '',
    saveAs: false,
    obsidianApiBaseUrl: 'http://127.0.0.1:27123',
    obsidianApiKey: '',
    noteFolder: 'Clippings',
  };
});

describe('Clip2MD 设置页结构', () => {
  it('按保存位置、快捷键、Obsidian、保存栏的优先级组织页面', () => {
    const form = document.getElementById('settings-form');
    expect(form).not.toBeNull();

    const sectionIds = [...form!.querySelectorAll<HTMLElement>('[data-settings-section]')]
      .map((element) => element.id);
    expect(sectionIds).toEqual([
      'save-location-card',
      'shortcut-card',
      'obsidian-settings',
    ]);

    expect(document.getElementById('fallback-download-settings')).toBeInstanceOf(HTMLDetailsElement);
    expect((document.getElementById('obsidian-settings') as HTMLDetailsElement).open).toBe(false);
    expect(document.querySelector('.save-bar')).not.toBeNull();
  });

  it('保留现有控制器绑定 ID 并提供新增状态控件', () => {
    const requiredIds = [
      'choose-folder',
      'clear-folder',
      'folder-name',
      'folder-status',
      'shortcut-value',
      'shortcut-btn',
      'subfolder',
      'save-as',
      'obsidian-api-base-url',
      'obsidian-api-key',
      'note-folder',
      'test-obsidian-btn',
      'obsidian-status',
      'save-btn',
      'save-status',
      'folder-connection-state',
      'obsidian-summary-state',
      'toggle-api-key',
    ];

    for (const id of requiredIds) {
      expect(document.getElementById(id), `missing #${id}`).not.toBeNull();
    }

    expect((document.getElementById('obsidian-api-key') as HTMLInputElement).type).toBe('password');
    expect(document.getElementById('save-status')?.getAttribute('aria-live')).toBe('polite');
  });
});

describe('保存位置状态', () => {
  it('有自定义目录时显示目录名称并收起备用下载设置', async () => {
    await bootOptions(fakeDirectoryHandle('Clippings'));

    expect(document.getElementById('folder-name')?.textContent).toBe('Clippings');
    expect(document.getElementById('folder-connection-state')?.textContent).toBe('已连接');
    expect(document.getElementById('folder-mode-description')?.textContent)
      .toContain('绕过浏览器下载目录');
    expect((document.getElementById('fallback-download-settings') as HTMLDetailsElement).open).toBe(false);
    expect(document.getElementById('clear-folder')?.hidden).toBe(false);
    expect(document.getElementById('choose-folder')?.textContent).toBe('更改');
  });

  it('没有自定义目录时自动展开备用下载设置', async () => {
    await bootOptions(null);

    expect(document.getElementById('folder-name')?.textContent).toBe('浏览器下载目录');
    expect(document.getElementById('folder-connection-state')?.textContent).toBe('未选择');
    expect((document.getElementById('fallback-download-settings') as HTMLDetailsElement).open).toBe(true);
    expect(document.getElementById('clear-folder')?.hidden).toBe(true);
    expect(document.getElementById('choose-folder')?.textContent).toBe('选择文件夹');
  });

  it('清除自定义目录后立即切回备用下载状态', async () => {
    await bootOptions(fakeDirectoryHandle('Clippings'));
    folderMocks.loadDirectoryHandle.mockResolvedValue(null);

    (document.getElementById('clear-folder') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(folderMocks.clearDirectoryHandle).toHaveBeenCalledOnce();
      expect((document.getElementById('fallback-download-settings') as HTMLDetailsElement).open).toBe(true);
      expect(document.getElementById('folder-status')?.textContent).toContain('浏览器下载目录');
    });
  });
});
