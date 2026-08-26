import { describe, it, expect, vi, beforeEach } from 'vitest';
import '../src/background/background';
import '../src/content/content-script';
import {
  chromeCalls,
  dispatchCommand,
  offscreenCloseDocumentMock,
  offscreenCreateDocumentMock,
  offscreenHasDocumentMock,
  runtimeSendMessageMock,
  setRuntimeLastError,
  mockStoredSettings,
  tabsQueryMock,
  tabsSendMessageMock,
} from './setup';
import { mountFixture } from './helpers';
import { runSave } from '../src/background/quick-save';
import { loadDirectoryHandle } from '../src/core/custom-folder';

vi.mock('../src/core/custom-folder', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/custom-folder')>();
  return {
    ...actual,
    loadDirectoryHandle: vi.fn(async () => null),
  };
});

/** jsdom 中重定向 window.location */
function setLocation(url: string): void {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: new URL(url),
  });
}

describe('快捷键保存（save-clip）', () => {
  beforeEach(() => {
    // 普通快捷键测试模拟已完成初始化的旧用户；新用户另行覆盖。
    mockStoredSettings['clip2md.settings'] = {};
    vi.mocked(loadDirectoryHandle).mockReset();
    vi.mocked(loadDirectoryHandle).mockResolvedValue(null);
    runtimeSendMessageMock.mockReset();
    offscreenHasDocumentMock.mockReset();
    offscreenHasDocumentMock.mockResolvedValue(false);
    offscreenCreateDocumentMock.mockReset();
    offscreenCloseDocumentMock.mockReset();
    setRuntimeLastError(null);
  });

  it('支持页面：下载并通知成功', async () => {
    setLocation('https://x.com/alice/status/123456');
    mountFixture('x', 'normal');
    dispatchCommand('save-clip');

    await vi.waitFor(() => expect(chromeCalls.downloads.length).toBe(1));
    expect(chromeCalls.downloads[0]?.filename).toMatch(/\.md$/);
    expect(chromeCalls.notifications.some((n) => n.title === '已保存')).toBe(true);
    expect(chromeCalls.badgeText).toContain('✓');
  });

  it('不支持页面：不下载并通知失败', async () => {
    setLocation('https://example.com/page');
    dispatchCommand('save-clip');

    await vi.waitFor(() => expect(chromeCalls.notifications.length).toBeGreaterThan(0));
    expect(chromeCalls.downloads.length).toBe(0);
    expect(chromeCalls.notifications[0]?.title).toBe('保存失败');
    expect(chromeCalls.badgeText).toContain('!');
  });

  it('新用户未完成初始化：普通保存不下载并提示先选文件夹', async () => {
    delete mockStoredSettings['clip2md.settings'];
    setLocation('https://x.com/alice/status/123456');
    mountFixture('x', 'normal');
    dispatchCommand('save-clip');

    await vi.waitFor(() => expect(chromeCalls.notifications.length).toBeGreaterThan(0));
    expect(chromeCalls.downloads).toHaveLength(0);
    expect(chromeCalls.notifications[0]).toEqual({
      title: '需要完成首次设置',
      message: '请先打开设置页选择自定义保存文件夹。',
    });
  });

  it('配置自定义文件夹：走 offscreen 写入而非下载', async () => {
    setLocation('https://x.com/alice/status/123456');
    mountFixture('x', 'normal');
    vi.mocked(loadDirectoryHandle).mockResolvedValue({ name: 'notes' } as unknown as FileSystemDirectoryHandle);
    offscreenHasDocumentMock.mockResolvedValue(true);
    runtimeSendMessageMock.mockImplementation((msg: unknown, cb?: (resp: unknown) => void) => {
      const m = msg as { type?: string };
      if (m.type === 'WRITE_CUSTOM') cb?.({ success: true, filename: 'notes/@alice-123456.md' });
      else cb?.({});
    });
    dispatchCommand('save-clip');

    await vi.waitFor(() => expect(chromeCalls.notifications.length).toBeGreaterThan(0));
    expect(chromeCalls.downloads.length).toBe(0);
    expect(chromeCalls.notifications[0]?.title).toBe('已保存');
    expect(runtimeSendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'WRITE_CUSTOM' }),
      expect.any(Function),
    );
  });

  it('权限被拒：不重建 offscreen、不重试，直接下载兜底并通知', async () => {
    setLocation('https://x.com/alice/status/123456');
    mountFixture('x', 'normal');
    vi.mocked(loadDirectoryHandle).mockResolvedValue({ name: 'notes' } as unknown as FileSystemDirectoryHandle);
    offscreenHasDocumentMock.mockResolvedValue(true);
    runtimeSendMessageMock.mockImplementation((msg: unknown, cb?: (r: unknown) => void) => {
      const m = msg as { type?: string };
      if (m.type === 'WRITE_CUSTOM') cb?.({ success: false, error: '未获得该文件夹的写入权限。' });
      else cb?.({});
    });
    dispatchCommand('save-clip');

    await vi.waitFor(() => expect(chromeCalls.downloads.length).toBe(1));
    expect(offscreenCreateDocumentMock).not.toHaveBeenCalled();
    expect(runtimeSendMessageMock).toHaveBeenCalledTimes(1); // 不进行第二次发送
    expect(chromeCalls.notifications.some((n) => n.message.includes('自定义文件夹写入失败，已保存到下载目录'))).toBe(
      true,
    );
  });

  it('两次 offscreen 尝试都失败：最多两轮，只下载一次、只发一条最终通知', async () => {
    setLocation('https://x.com/alice/status/123456');
    mountFixture('x', 'normal');
    vi.mocked(loadDirectoryHandle).mockResolvedValue({ name: 'notes' } as unknown as FileSystemDirectoryHandle);
    offscreenHasDocumentMock.mockResolvedValue(true);
    let sendCount = 0;
    runtimeSendMessageMock.mockImplementation((_msg: unknown, cb?: (r: unknown) => void) => {
      sendCount += 1;
      setRuntimeLastError('Receiving end does not exist.');
      cb?.(undefined);
    });
    dispatchCommand('save-clip');

    await vi.waitFor(() => expect(chromeCalls.downloads.length).toBe(1));
    expect(sendCount).toBe(2); // 最多两次发送
    expect(chromeCalls.downloads.length).toBe(1);
    expect(chromeCalls.notifications.length).toBe(1);
    expect(chromeCalls.notifications[0]?.message).toContain('自定义文件夹写入失败，已保存到下载目录');
  });

  it('Obsidian target 复用同一 filename engine 且不回退为下载', async () => {
    setLocation('https://x.com/alice/status/123456');
    mountFixture('x', 'normal');
    mockStoredSettings['clip2md.settings'] = {
      settingsVersion: 2,
      save: { subfolder: '', saveAs: false },
      filename: { template: '{date}-{platform}-{title}' },
      obsidian: {
        enabled: true,
        apiUrl: 'http://127.0.0.1:27123',
        apiKey: 'key',
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
    };
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ status: 404, ok: false, text: async () => '' })
      .mockResolvedValueOnce({ status: 204, ok: true, text: async () => '' }));

    dispatchCommand('save-to-obsidian');

    await vi.waitFor(() => expect(chromeCalls.notifications.length).toBeGreaterThan(0));

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/vault/Clippings/Inbox/2026-'),
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(chromeCalls.downloads).toHaveLength(0);
    expect(chromeCalls.notifications.some((n) => n.title === '已保存到 Obsidian')).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe('runSave(target, tabId?) 指定标签页保存（Phase 8）', () => {
  beforeEach(() => {
    setLocation('https://x.com/alice/status/123456');
    mountFixture('x', 'normal');
    mockStoredSettings['clip2md.settings'] = {};
  });

  it('提供 tabId 时直接使用该标签页，不再查询活动标签', async () => {
    tabsQueryMock.mockClear();

    const outcome = await runSave('default', 5);

    expect(tabsQueryMock).not.toHaveBeenCalled();
    expect(tabsSendMessageMock).toHaveBeenCalledWith(5, { type: 'EXTRACT' }, expect.any(Function));
    expect(outcome.ok).toBe(true);
    expect(chromeCalls.downloads).toHaveLength(1);
  });

  it('省略 tabId 时仍查询活动标签页（快捷键路径不变）', async () => {
    await runSave('default');

    expect(tabsQueryMock).toHaveBeenCalled();
    expect(chromeCalls.downloads).toHaveLength(1);
  });
});
