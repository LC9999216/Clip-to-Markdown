import { describe, it, expect } from 'vitest';
import '../src/background/background';
import { chromeCalls, dispatchRuntimeMessage, mockStoredSettings } from './setup';

const SETTINGS_KEY = 'clip2md.settings';

const DOWNLOAD = {
  type: 'DOWNLOAD',
  payload: { markdown: '# hi', filename: 'tweet.md' },
};

describe('background DOWNLOAD handler', () => {
  it('受信任 sender（扩展页）→ 执行下载', async () => {
    const resp = await dispatchRuntimeMessage(DOWNLOAD, {
      url: 'chrome-extension://test-extension-id/popup.html',
    });
    expect(resp).toEqual({ success: true, filename: 'tweet.md' });
    expect(chromeCalls.downloads).toHaveLength(1);
    expect(chromeCalls.downloads[0]?.filename).toBe('tweet.md');
    expect(chromeCalls.downloads[0]?.url).toContain('data:text/markdown');
  });

  it('受信任 sender（x.com content script）→ 执行下载', async () => {
    const resp = await dispatchRuntimeMessage(DOWNLOAD, {
      url: 'https://x.com/alice/status/123',
    });
    expect(resp).toEqual({ success: true, filename: 'tweet.md' });
  });

  it('不受信任 sender → 拒绝', async () => {
    const resp = await dispatchRuntimeMessage(DOWNLOAD, {
      url: 'https://evil.example.com/',
    });
    expect(resp).toEqual({ success: false, error: expect.stringContaining('不受信任') });
    expect(chromeCalls.downloads).toHaveLength(0);
  });

  it('非法载荷 → 拒绝', async () => {
    const resp = await dispatchRuntimeMessage(
      { type: 'DOWNLOAD', payload: { markdown: '', filename: '' } },
      { url: 'https://x.com/a' },
    );
    expect(resp).toEqual({ success: false, error: '非法下载载荷。' });
    expect(chromeCalls.downloads).toHaveLength(0);
  });

  it('文件名被 sanitize', async () => {
    const resp = await dispatchRuntimeMessage(
      { type: 'DOWNLOAD', payload: { markdown: 'x', filename: 'a<b>:c.md' } },
      { url: 'chrome-extension://test-extension-id/popup.html' },
    );
    expect(resp).toEqual({ success: true, filename: 'abc.md' });
    expect(chromeCalls.downloads[0]?.filename).toBe('abc.md');
  });

  it('无已存设置：下载到根目录、saveAs 为 false', async () => {
    const resp = await dispatchRuntimeMessage(DOWNLOAD, {
      url: 'chrome-extension://test-extension-id/popup.html',
    });
    expect(resp).toEqual({ success: true, filename: 'tweet.md' });
    expect(chromeCalls.downloads[0]?.filename).toBe('tweet.md');
    expect(chromeCalls.downloads[0]?.saveAs).toBe(false);
  });

  it('设置子目录：下载路径前缀子目录', async () => {
    mockStoredSettings[SETTINGS_KEY] = { subfolder: 'Clip2MD/知乎', saveAs: false };
    const resp = await dispatchRuntimeMessage(DOWNLOAD, {
      url: 'chrome-extension://test-extension-id/popup.html',
    });
    expect(resp).toEqual({ success: true, filename: 'Clip2MD/知乎/tweet.md' });
    expect(chromeCalls.downloads[0]?.filename).toBe('Clip2MD/知乎/tweet.md');
  });

  it('设置 saveAs：下载参数 saveAs 为 true', async () => {
    mockStoredSettings[SETTINGS_KEY] = { subfolder: '', saveAs: true };
    await dispatchRuntimeMessage(DOWNLOAD, {
      url: 'chrome-extension://test-extension-id/popup.html',
    });
    expect(chromeCalls.downloads[0]?.saveAs).toBe(true);
  });

  it('恶意子目录（路径穿越）被清洗', async () => {
    mockStoredSettings[SETTINGS_KEY] = { subfolder: '../../etc', saveAs: false };
    const resp = await dispatchRuntimeMessage(DOWNLOAD, {
      url: 'chrome-extension://test-extension-id/popup.html',
    });
    expect(resp).toEqual({ success: true, filename: 'etc/tweet.md' });
    expect(chromeCalls.downloads[0]?.filename).toBe('etc/tweet.md');
  });

  it('非 DOWNLOAD 消息不处理', async () => {
    const resp = await dispatchRuntimeMessage({ type: 'GET_STATUS' }, { url: 'https://x.com/a' });
    expect(resp).toBeUndefined();
  });
});
