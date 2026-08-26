import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commandsGetAllMock,
  mockStoredSettings,
  permissionsContainsMock,
  permissionsRequestMock,
  runtimeSendMessageMock,
  setRuntimeLastError,
} from './setup';
import { INITIAL_SETUP_KEY } from '../src/core/setup-state';

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
  delete mockStoredSettings[INITIAL_SETUP_KEY];
  Object.defineProperty(window, 'showDirectoryPicker', {
    configurable: true,
    value: undefined,
  });
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
  it('按保存位置、快捷键、AI 一图速览、Obsidian、保存栏的优先级组织页面', () => {
    const form = document.getElementById('settings-form');
    expect(form).not.toBeNull();

    const sectionIds = [...form!.querySelectorAll<HTMLElement>('[data-settings-section]')]
      .map((element) => element.id);
    expect(sectionIds).toEqual([
      'save-location-card',
      'shortcut-card',
      'ai-settings',
      'obsidian-settings',
    ]);

    expect(document.getElementById('fallback-download-settings')).toBeInstanceOf(HTMLDetailsElement);
    expect((document.getElementById('obsidian-settings') as HTMLDetailsElement).open).toBe(true);
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
      'filename-template',
      'filename-template-error',
      'obsidian-api-base-url',
      'obsidian-api-key',
      'note-folder',
      'frontmatter-source-url',
      'frontmatter-author',
      'frontmatter-published',
      'frontmatter-platform',
      'frontmatter-clipped-at',
      'frontmatter-tags',
      'test-obsidian-btn',
      'obsidian-status',
      'save-btn',
      'save-status',
      'folder-connection-state',
  'obsidian-summary-state',
  'toggle-api-key',
  'about-card',
  'app-version',
  'initial-setup-guide',
  'ai-settings',
  'ai-enabled',
  'ai-endpoint',
  'ai-api-key',
  'toggle-ai-api-key',
  'ai-model',
  'ai-authorize-btn',
  'ai-test-btn',
  'ai-status',
    ];

    for (const id of requiredIds) {
      expect(document.getElementById(id), `missing #${id}`).not.toBeNull();
    }

    expect((document.getElementById('obsidian-api-key') as HTMLInputElement).type).toBe('password');
    expect(document.getElementById('save-status')?.getAttribute('aria-live')).toBe('polite');
  });

  it('展示 V0.2 品牌、默认文件名模板、About 链接与运行时版本', async () => {
    await bootOptions(null);
    expect(document.querySelector('h1')?.textContent).toBe('Clip to Markdown 设置');
    expect(document.querySelector('.brand-icon')?.getAttribute('src')).toBe('icons/icon-32.png');
    expect((document.getElementById('filename-template') as HTMLInputElement).value).toBe('{date}-{title}');
    expect((document.getElementById('frontmatter-source-url') as HTMLInputElement).checked).toBe(true);
    expect(document.getElementById('app-version')?.textContent).toBe('v0.2.0');
    expect(document.querySelector('a[href="https://github.com/LC9999216/clip2md"]')).not.toBeNull();
    expect(document.querySelector('a[href="https://github.com/LC9999216/clip2md/issues"]')).not.toBeNull();
    expect(document.querySelector('a[href="mailto:luochengco_0707@qq.com"]')).not.toBeNull();
    expect(document.querySelector('a[href="https://github.com/LC9999216/clip2md/blob/main/LICENSE"]')).not.toBeNull();
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

  it('新用户显示首次初始化引导，选择文件夹后解除普通保存门禁', async () => {
    delete mockStoredSettings['clip2md.settings'];
    delete mockStoredSettings[INITIAL_SETUP_KEY];
    await bootOptions(null);

    const picker = vi.fn(async () => fakeDirectoryHandle('Clippings'));
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: picker,
    });

    expect(document.getElementById('initial-setup-guide')?.hidden).toBe(false);
    expect(document.getElementById('settings-form')?.dataset.initialSetupComplete).toBe('false');
    expect((document.getElementById('save-btn') as HTMLButtonElement).disabled).toBe(true);

    (document.getElementById('choose-folder') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(picker).toHaveBeenCalledOnce();
      expect(folderMocks.saveDirectoryHandle).toHaveBeenCalledOnce();
      expect(mockStoredSettings[INITIAL_SETUP_KEY]).toBe(true);
      expect(document.getElementById('initial-setup-guide')?.hidden).toBe(true);
      expect(document.getElementById('settings-form')?.dataset.initialSetupComplete).toBe('true');
    });
  });

  it('新用户拒绝文件夹权限时保持初始化未完成', async () => {
    delete mockStoredSettings['clip2md.settings'];
    delete mockStoredSettings[INITIAL_SETUP_KEY];
    await bootOptions(null);

    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: vi.fn(async () => ({
        name: 'Clippings',
        queryPermission: vi.fn(async () => 'denied'),
      } as unknown as FileSystemDirectoryHandle)),
    });

    (document.getElementById('choose-folder') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(folderMocks.saveDirectoryHandle).not.toHaveBeenCalled();
      expect(mockStoredSettings[INITIAL_SETUP_KEY]).toBe(false);
      expect(document.getElementById('folder-status')?.textContent)
        .toBe('未获得该文件夹的写入权限。');
      expect(document.getElementById('initial-setup-guide')?.hidden).toBe(false);
    });
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
        settingsVersion: 3,
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

  it('未知文件名变量阻止保存并显示具体提示', async () => {
    await bootOptions(null);
    const input = document.getElementById('filename-template') as HTMLInputElement;
    const saveButton = document.getElementById('save-btn') as HTMLButtonElement;

    input.value = '{hello}-{title}';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    saveButton.click();

    expect(document.getElementById('filename-template-error')?.textContent)
      .toBe('不支持的变量：{hello}');
    expect(saveButton.disabled).toBe(false);
  });
});

describe('Obsidian 高级设置', () => {
  it('默认收起并允许显示或隐藏 API Key，但不把显示状态视为表单修改', async () => {
    await bootOptions(null);
    const details = document.getElementById('obsidian-settings') as HTMLDetailsElement;
    const input = document.getElementById('obsidian-api-key') as HTMLInputElement;
    const toggle = document.getElementById('toggle-api-key') as HTMLButtonElement;
    const saveButton = document.getElementById('save-btn') as HTMLButtonElement;

    expect(details.open).toBe(true);
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
        settingsVersion: 3,
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

describe('AI 一图速览设置', () => {
  it('AI API Key 支持显示/隐藏，且不把显示状态视为表单修改', async () => {
    await bootOptions(null);
    const input = document.getElementById('ai-api-key') as HTMLInputElement;
    const toggle = document.getElementById('toggle-ai-api-key') as HTMLButtonElement;
    const saveButton = document.getElementById('save-btn') as HTMLButtonElement;

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

  it('授权并测试：由用户按钮手势请求 Endpoint 对应的运行时主机权限并保存配置', async () => {
    await bootOptions(null);
    (document.getElementById('ai-enabled') as HTMLInputElement).checked = true;
    (document.getElementById('ai-endpoint') as HTMLInputElement).value = 'https://api.deepseek.com/chat/completions';
    (document.getElementById('ai-api-key') as HTMLInputElement).value = 'sk-secret';
    (document.getElementById('ai-model') as HTMLInputElement).value = 'deepseek-chat';

    (document.getElementById('ai-authorize-btn') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(permissionsContainsMock).toHaveBeenCalledWith(
        { origins: ['https://api.deepseek.com/*'] },
        expect.any(Function),
      );
      expect(permissionsRequestMock).toHaveBeenCalledWith(
        { origins: ['https://api.deepseek.com/*'] },
        expect.any(Function),
      );
      expect(mockStoredSettings['clip2md.settings']).toMatchObject({
        settingsVersion: 3,
        ai: {
          enabled: true,
          endpoint: 'https://api.deepseek.com/chat/completions',
          apiKey: 'sk-secret',
          model: 'deepseek-chat',
        },
      });
    });
  });

  it('拒绝普通远程 HTTP endpoint，不发起权限请求并给出可操作提示', async () => {
    await bootOptions(null);
    (document.getElementById('ai-endpoint') as HTMLInputElement).value = 'http://example.com/chat/completions';

    (document.getElementById('ai-authorize-btn') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(permissionsRequestMock).not.toHaveBeenCalled();
      expect(document.getElementById('ai-status')?.textContent).toContain('不支持');
    });
  });

  it('允许 localhost HTTP endpoint 并请求 http://localhost/* 权限', async () => {
    await bootOptions(null);
    (document.getElementById('ai-endpoint') as HTMLInputElement).value = 'http://localhost:11434/v1/chat/completions';

    (document.getElementById('ai-authorize-btn') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(permissionsContainsMock).toHaveBeenCalledWith(
        { origins: ['http://localhost/*'] },
        expect.any(Function),
      );
      expect(permissionsRequestMock).toHaveBeenCalledWith(
        { origins: ['http://localhost/*'] },
        expect.any(Function),
      );
    });
  });

  it('已授权域名不再重复请求权限，直接进入连接测试', async () => {
    permissionsContainsMock.mockImplementation((_permissions, cb?: (result: boolean) => void) => {
      cb?.(true);
    });
    await bootOptions(null);
    (document.getElementById('ai-endpoint') as HTMLInputElement).value = 'https://api.openai.com/v1/chat/completions';

    (document.getElementById('ai-authorize-btn') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(permissionsRequestMock).not.toHaveBeenCalled();
      expect(runtimeSendMessageMock).toHaveBeenCalledWith(
        { type: 'TEST_AI' },
        expect.any(Function),
      );
    });
  });

  it('测试 AI 保存当前字段并发起 TEST_AI 消息，就近显示成功', async () => {
    runtimeSendMessageMock.mockImplementation((_message, callback?: (response: unknown) => void) => {
      callback?.({ success: true, model: 'deepseek-chat' });
    });
    await bootOptions(null);
    (document.getElementById('ai-endpoint') as HTMLInputElement).value = 'https://api.deepseek.com/chat/completions';
    (document.getElementById('ai-api-key') as HTMLInputElement).value = 'sk-secret';
    (document.getElementById('ai-model') as HTMLInputElement).value = 'deepseek-chat';

    (document.getElementById('ai-test-btn') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(runtimeSendMessageMock).toHaveBeenCalledWith(
        { type: 'TEST_AI' },
        expect.any(Function),
      );
      expect(document.getElementById('ai-status')?.textContent).toContain('连接成功');
      expect(document.getElementById('ai-status')?.textContent).toContain('deepseek-chat');
      expect(mockStoredSettings['clip2md.settings']).toMatchObject({
        settingsVersion: 3,
        ai: { apiKey: 'sk-secret', model: 'deepseek-chat' },
      });
    });
  });

  it('测试 AI 失败时给出可操作提示', async () => {
    runtimeSendMessageMock.mockImplementation((_message, callback?: (response: unknown) => void) => {
      callback?.({ success: false, error: 'API Key 无效' });
    });
    await bootOptions(null);
    (document.getElementById('ai-endpoint') as HTMLInputElement).value = 'https://api.deepseek.com/chat/completions';

    (document.getElementById('ai-test-btn') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(document.getElementById('ai-status')?.textContent).toContain('API Key 无效');
      expect(document.getElementById('ai-status')?.dataset.kind).toBe('error');
    });
  });
});

describe('设置页视觉契约', () => {
  it('包含已确认的设计令牌、密码框、键盘焦点和窄屏规则', () => {
    expect(optionsCss).toContain('--page-bg: #f7f9fc');
    expect(optionsCss).toContain('max-width: 1024px');
    expect(optionsCss).toMatch(/input\[type="text"\][\s\S]*input\[type="password"\]/);
    expect(optionsCss).toContain(':focus-visible');
    expect(optionsCss).toContain('@media (max-width: 540px)');
    expect(optionsCss).toContain('.settings-card');
    expect(optionsCss).toContain('.save-bar');
    expect(optionsCss).toContain('.about-list');
    expect(optionsCss).toContain('.obsidian-grid');
  });
});
