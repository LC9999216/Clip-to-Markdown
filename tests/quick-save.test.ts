import { describe, it, expect, vi, beforeEach } from 'vitest';
import '../src/background/background';
import '../src/content/content-script';
import {
  chromeCalls,
  dispatchCommand,
  offscreenHasDocumentMock,
  runtimeSendMessageMock,
} from './setup';
import { mountFixture } from './helpers';
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
    vi.mocked(loadDirectoryHandle).mockReset();
    vi.mocked(loadDirectoryHandle).mockResolvedValue(null);
    runtimeSendMessageMock.mockReset();
    offscreenHasDocumentMock.mockReset();
    offscreenHasDocumentMock.mockResolvedValue(false);
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
});
