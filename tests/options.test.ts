import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { commandsGetAllMock, mockStoredSettings, runtimeSendMessageMock, setRuntimeLastError } from './setup';

const optionsHtml = readFileSync(
  join(process.cwd(), 'src', 'options', 'options.html'),
  'utf8',
).replace('<script src="options.js"></script>', '');

const optionsCss = readFileSync(
  join(process.cwd(), 'src', 'options', 'options.css'),
  'utf8',
);

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
    const commands = [
      { name: 'save-clip', shortcut: 'Ctrl+Shift+S' },
      { name: 'save-to-obsidian', shortcut: 'Alt+Shift+S' },
    ] as chrome.commands.Command[];
    callback?.(commands);
    return Promise.resolve(commands) as never;
  });
  if (runtimeSendMessageMock.getMockImplementation() === undefined) {
    runtimeSendMessageMock.mockImplementation((_message, callback?: (response: unknown) => void) => {
      callback?.({ success: true, service: 'Obsidian Local REST API' });
    });
  }

  await import('../src/options/options');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await vi.waitFor(() => {
    expect(document.getElementById('shortcut-value')?.textContent).toContain('Ctrl+Shift+S');
    expect(document.getElementById('obsidian-shortcut-value')?.textContent).toContain('Alt+Shift+S');
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
      'obsidian-shortcut-value',
      'obsidian-shortcut-btn',
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

describe('表单保存状态', () => {
  it('初始化时禁用保存按钮，用户修改后启用，保存成功后再次禁用', async () => {
    await bootOptions(null);
    const input = document.getElementById('subfolder') as HTMLInputElement;
    const saveButton = document.getElementById('save-btn') as HTMLButtonElement;

    expect(saveButton.disabled).toBe(true);
    input.value = 'Clip2MD/知乎';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(saveButton.disabled).toBe(false);

    saveButton.click();
    await vi.waitFor(() => {
      expect(document.getElementById('save-status')?.textContent).toBe('设置已保存');
      expect(saveButton.disabled).toBe(true);
      expect(mockStoredSettings['clip2md.settings']).toMatchObject({
        settingsVersion: 2,
        save: {
          subfolder: 'Clip2MD/知乎',
        },
      });
    });
  });

  it('保存失败时保留可重试状态', async () => {
    await bootOptions(null);
    const input = document.getElementById('note-folder') as HTMLInputElement;
    const saveButton = document.getElementById('save-btn') as HTMLButtonElement;

    input.value = 'Clippings/Bilibili';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    setRuntimeLastError('storage unavailable');
    saveButton.click();

    await vi.waitFor(() => {
      expect(document.getElementById('save-status')?.textContent).toContain('保存失败');
      expect(saveButton.disabled).toBe(false);
    });
    setRuntimeLastError(null);
  });
});

describe('Obsidian 高级设置', () => {
  it('默认收起并允许显示或隐藏 API Key，但不把显示状态视为表单修改', async () => {
    await bootOptions(null);
    const details = document.getElementById('obsidian-settings') as HTMLDetailsElement;
    const input = document.getElementById('obsidian-api-key') as HTMLInputElement;
    const toggle = document.getElementById('toggle-api-key') as HTMLButtonElement;
    const saveButton = document.getElementById('save-btn') as HTMLButtonElement;

    expect(details.open).toBe(false);
    expect(input.type).toBe('password');
    toggle.click();
    expect(input.type).toBe('text');
    expect(toggle.textContent).toBe('隐藏');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(saveButton.disabled).toBe(true);

    toggle.click();
    expect(input.type).toBe('password');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('测试连接时保存当前字段、更新摘要并就近显示成功', async () => {
    await bootOptions(null);
    const apiKey = document.getElementById('obsidian-api-key') as HTMLInputElement;
    apiKey.value = 'secret-key';
    apiKey.dispatchEvent(new Event('input', { bubbles: true }));

    (document.getElementById('test-obsidian-btn') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(runtimeSendMessageMock).toHaveBeenCalledWith(
        { type: 'TEST_OBSIDIAN' },
        expect.any(Function),
      );
      expect(mockStoredSettings['clip2md.settings']).toMatchObject({
        settingsVersion: 2,
        obsidian: { apiKey: 'secret-key' },
      });
      expect(document.getElementById('obsidian-status')?.textContent)
        .toContain('连接成功');
      expect(document.getElementById('obsidian-summary-state')?.textContent).toBe('已配置');
      expect((document.getElementById('save-btn') as HTMLButtonElement).disabled).toBe(true);
    });
  });

  it('连接失败时给出可操作提示', async () => {
    runtimeSendMessageMock.mockImplementation((_message, callback?: (response: unknown) => void) => {
      callback?.({ success: false });
    });
    await bootOptions(null);

    (document.getElementById('test-obsidian-btn') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(document.getElementById('obsidian-status')?.textContent)
        .toBe('连接失败，请检查地址或 API Key。');
      expect(document.getElementById('obsidian-status')?.dataset.kind).toBe('error');
    });
  });
});

describe('设置页视觉契约', () => {
  it('包含已确认的设计令牌、密码框、键盘焦点和窄屏规则', () => {
    expect(optionsCss).toContain('--page-bg: #f6f8fb');
    expect(optionsCss).toContain('max-width: 680px');
    expect(optionsCss).toMatch(/input\[type="text"\][\s\S]*input\[type="password"\]/);
    expect(optionsCss).toContain(':focus-visible');
    expect(optionsCss).toContain('@media (max-width: 540px)');
    expect(optionsCss).toContain('.settings-card');
    expect(optionsCss).toContain('.save-bar');
  });
});
