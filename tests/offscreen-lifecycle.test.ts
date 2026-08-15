import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  OFFSCREEN_READY_TIMEOUT_MS,
  ensureOffscreenDocument,
  waitForOffscreenReady,
  writeViaOffscreen,
} from '../src/background/quick-save';
import {
  dispatchRuntimeMessage,
  offscreenCloseDocumentMock,
  offscreenCreateDocumentMock,
  offscreenHasDocumentMock,
  runtimeSendMessageMock,
  setRuntimeLastError,
} from './setup';

/** 让 createDocument mock 模拟 offscreen 页面加载后派发 OFFSCREEN_READY */
function createDocumentDispatchesReady(): void {
  offscreenCreateDocumentMock.mockImplementation(async () => {
    await dispatchRuntimeMessage({ type: 'OFFSCREEN_READY' });
  });
}

function respondWriteSuccess(): void {
  runtimeSendMessageMock.mockImplementation((msg: unknown, cb?: (r: unknown) => void) => {
    cb?.({ success: true, filename: 'notes/x.md' });
  });
}

describe('offscreen 生命周期', () => {
  beforeEach(() => {
    runtimeSendMessageMock.mockReset();
    offscreenHasDocumentMock.mockReset();
    offscreenCreateDocumentMock.mockReset();
    offscreenCloseDocumentMock.mockReset();
    setRuntimeLastError(null);
  });

  it('用例 A：文档已存在 → 不调用 createDocument，直接写入', async () => {
    offscreenHasDocumentMock.mockResolvedValue(true);
    respondWriteSuccess();

    const result = await writeViaOffscreen('x.md', '# hi');
    expect(result).toBe('notes/x.md');
    expect(offscreenCreateDocumentMock).not.toHaveBeenCalled();
    expect(runtimeSendMessageMock).toHaveBeenCalledTimes(1);
  });

  it('用例 B：文档不存在 → createDocument 一次 + ready + 写入成功', async () => {
    offscreenHasDocumentMock.mockResolvedValue(false);
    createDocumentDispatchesReady();
    respondWriteSuccess();

    const result = await writeViaOffscreen('x.md', '# hi');
    expect(result).toBe('notes/x.md');
    expect(offscreenCreateDocumentMock).toHaveBeenCalledTimes(1);
    expect(runtimeSendMessageMock).toHaveBeenCalledTimes(1);
  });

  it('用例 C：并发两次创建 → createDocument 只调用一次，结束后清空 in-flight', async () => {
    offscreenHasDocumentMock.mockResolvedValue(false);
    createDocumentDispatchesReady();

    await Promise.all([ensureOffscreenDocument(), ensureOffscreenDocument()]);
    expect(offscreenCreateDocumentMock).toHaveBeenCalledTimes(1);

    // 创建结束后再次调用：若文档仍「不存在」会重新创建（证明未复用历史就绪状态）
    offscreenHasDocumentMock.mockResolvedValue(false);
    await ensureOffscreenDocument();
    expect(offscreenCreateDocumentMock).toHaveBeenCalledTimes(2);
  });

  it('用例 D：waitForOffscreenReady 超时 reject 且移除 listener', async () => {
    const p = waitForOffscreenReady(10);
    await expect(p).rejects.toThrow('离屏写入组件启动超时。');

    // 超时后 listener 已移除：再派发 OFFSCREEN_READY 无人处理
    const resp = await dispatchRuntimeMessage({ type: 'OFFSCREEN_READY' });
    expect(resp).toBeUndefined();
  });

  it('用例 D：ready 超时 → 重建一次后仍超时 → 抛错（不无限等待）', async () => {
    vi.useFakeTimers();
    try {
      offscreenHasDocumentMock.mockResolvedValue(false);
      // 不派发 OFFSCREEN_READY：waitForOffscreenReady 必然超时
      offscreenCreateDocumentMock.mockResolvedValue(undefined);

      const outcome = writeViaOffscreen('x.md', '# hi').then(
        () => 'resolved',
        (e: unknown) => e,
      );
      await vi.advanceTimersByTimeAsync(OFFSCREEN_READY_TIMEOUT_MS * 2 + 50);
      const result = await outcome;
      expect(result).toBeInstanceOf(Error);
      expect(offscreenCreateDocumentMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('用例 E：历史文档被关闭后再次保存 → 重新 createDocument', async () => {
    let docExists = false;
    offscreenHasDocumentMock.mockImplementation(async () => docExists);
    offscreenCreateDocumentMock.mockImplementation(async () => {
      docExists = true;
      await dispatchRuntimeMessage({ type: 'OFFSCREEN_READY' });
    });
    respondWriteSuccess();

    await writeViaOffscreen('x.md', '# hi');
    expect(offscreenCreateDocumentMock).toHaveBeenCalledTimes(1);

    docExists = false; // 模拟文档被浏览器关闭
    await writeViaOffscreen('y.md', '# hi');
    expect(offscreenCreateDocumentMock).toHaveBeenCalledTimes(2);
  });

  it('用例 F：接收端不存在 → closeDocument + 重建 + 第二次发送成功', async () => {
    let docExists = false;
    offscreenHasDocumentMock.mockImplementation(async () => docExists);
    offscreenCreateDocumentMock.mockImplementation(async () => {
      docExists = true;
      await dispatchRuntimeMessage({ type: 'OFFSCREEN_READY' });
    });
    offscreenCloseDocumentMock.mockImplementation(async () => {
      docExists = false;
    });

    let sendCount = 0;
    runtimeSendMessageMock.mockImplementation((msg: unknown, cb?: (r: unknown) => void) => {
      if (sendCount === 0) {
        sendCount += 1;
        setRuntimeLastError('Could not establish connection. Receiving end does not exist.');
        cb?.(undefined);
      } else {
        setRuntimeLastError(null);
        cb?.({ success: true, filename: 'notes/x.md' });
      }
    });

    const result = await writeViaOffscreen('x.md', '# hi');
    expect(result).toBe('notes/x.md');
    expect(offscreenCloseDocumentMock).toHaveBeenCalledTimes(1);
    expect(offscreenCreateDocumentMock).toHaveBeenCalledTimes(2);
    expect(runtimeSendMessageMock).toHaveBeenCalledTimes(2);
  });
});
