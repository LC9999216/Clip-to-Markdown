import { describe, it, expect } from 'vitest';
import '../src/background/background';
import { chromeCalls, dispatchRuntimeMessage } from './setup';

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

  it('非 DOWNLOAD 消息不处理', async () => {
    const resp = await dispatchRuntimeMessage({ type: 'GET_STATUS' }, { url: 'https://x.com/a' });
    expect(resp).toBeUndefined();
  });
});
