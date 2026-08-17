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
} from './setup';
import { mountFixture } from './helpers';
import { loadDirectoryHandle } from '../src/core/custom-folder';
import { runSave } from '../src/background/quick-save';

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

    await runSave('obsidian');

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
