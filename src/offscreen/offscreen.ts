/**
 * Offscreen document：承接 service worker 无法直接使用的 File System Access API。
 * 仅处理 WRITE_CUSTOM 消息：从 IndexedDB 取目录句柄 → 写入 Markdown。
 * 只接受本扩展内部消息（sender.id === chrome.runtime.id）。
 */

import { loadDirectoryHandle, writeMarkdownToDirectory } from '../core/custom-folder';
import { ensureMarkdownFilename, sanitizeFilenamePart } from '../core/filename';
import {
  isWriteCustomRequest,
  type OffscreenReadyMessage,
  type WriteCustomResponse,
} from '../types/messages';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!isWriteCustomRequest(msg)) return false;

  // 只接受本扩展内部消息
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ success: false, error: '不受信任的写入请求。' } satisfies WriteCustomResponse);
    return false;
  }

  void handleWrite(msg.payload).then(sendResponse);
  return true; // 异步响应通道
});

async function handleWrite(payload: { filename: string; markdown: string }): Promise<WriteCustomResponse> {
  try {
    const dir = await loadDirectoryHandle();
    if (!dir) return { success: false, error: '未配置自定义文件夹。' };
    // 防御性 sanitize（正常情况 quick-save 已传入合法文件名）
    const safeBase = sanitizeFilenamePart(payload.filename.replace(/\.md$/i, ''));
    const safeName = safeBase
      ? ensureMarkdownFilename(safeBase)
      : `clip2md-${Date.now()}.md`;
    const written = await writeMarkdownToDirectory(dir, safeName, payload.markdown);
    return { success: true, filename: `${dir.name}/${written}` };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

// 通知 background 就绪（消除 createDocument 与监听注册的竞态）
const ready: OffscreenReadyMessage = { type: 'OFFSCREEN_READY' };
chrome.runtime.sendMessage(ready).catch(() => {});
