import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chromeCalls, runtimeSendMessageMock, tabsSendMessageMock } from './setup';

const popupHtml = readFileSync(
  join(process.cwd(), 'src', 'popup', 'popup.html'),
  'utf8',
).replace('<script src="popup.js"></script>', '');

const folderMocks = vi.hoisted(() => ({
  loadDirectoryHandle: vi.fn(),
  requestDirectoryWritePermission: vi.fn(),
  writeMarkdownToDirectory: vi.fn(),
}));

const saveMocks = vi.hoisted(() => ({
  prepareSave: vi.fn(),
}));

vi.mock('../src/core/custom-folder', () => folderMocks);
vi.mock('../src/core/save-service', () => saveMocks);

function mountPopupHtml(): void {
  document.open();
  document.write(popupHtml);
  document.close();
}

async function bootPopup(): Promise<void> {
  await import('../src/popup/popup');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await vi.waitFor(() => {
    expect((document.getElementById('save-btn') as HTMLButtonElement).disabled).toBe(false);
  });
}

beforeEach(() => {
  vi.resetModules();
  mountPopupHtml();
  const handle = { name: 'AI工具箱' } as FileSystemDirectoryHandle;
  folderMocks.loadDirectoryHandle.mockReset();
  folderMocks.loadDirectoryHandle.mockResolvedValue(handle);
  folderMocks.requestDirectoryWritePermission.mockReset();
  folderMocks.requestDirectoryWritePermission.mockResolvedValue('granted');
  folderMocks.writeMarkdownToDirectory.mockReset();
  folderMocks.writeMarkdownToDirectory.mockResolvedValue('article.md');
  saveMocks.prepareSave.mockReset();
  saveMocks.prepareSave.mockResolvedValue({
    markdown: '# article',
    filename: 'article.md',
    settings: {},
  });
  tabsSendMessageMock.mockReset();
  tabsSendMessageMock.mockImplementation((_tabId, message, callback) => {
    const type = (message as { type?: string }).type;
    if (type === 'GET_STATUS') {
      callback?.({ supported: true, platform: 'x', contentType: 'tweet', title: '文章' });
    } else if (type === 'EXTRACT') {
      callback?.({ success: true, document: {} });
    }
  });
  runtimeSendMessageMock.mockReset();
});

describe('popup 自定义文件夹保存', () => {
  it('用户点击保存时先恢复目录权限，再写入自定义文件夹且不下载', async () => {
    await bootPopup();

    (document.getElementById('save-btn') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(folderMocks.writeMarkdownToDirectory).toHaveBeenCalledOnce());
    expect(folderMocks.requestDirectoryWritePermission).toHaveBeenCalledOnce();
    expect(folderMocks.requestDirectoryWritePermission.mock.invocationCallOrder[0])
      .toBeLessThan(folderMocks.writeMarkdownToDirectory.mock.invocationCallOrder[0]!);
    expect(runtimeSendMessageMock).not.toHaveBeenCalled();
    expect(chromeCalls.downloads).toHaveLength(0);
    expect(document.getElementById('status-text')?.textContent).toContain('AI工具箱/article.md');
  });

  it('用户拒绝目录权限时明确失败且不回退下载', async () => {
    folderMocks.requestDirectoryWritePermission.mockResolvedValue('denied');
    await bootPopup();

    (document.getElementById('save-btn') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(document.getElementById('status-text')?.textContent).toContain('未获得');
    });
    expect(folderMocks.writeMarkdownToDirectory).not.toHaveBeenCalled();
    expect(runtimeSendMessageMock).not.toHaveBeenCalled();
    expect(chromeCalls.downloads).toHaveLength(0);
  });
});
