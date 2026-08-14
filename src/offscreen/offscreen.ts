/**
 * Offscreen document：承接 service worker 无法直接使用的 File System Access API。
 * 仅处理 WRITE_CUSTOM 消息：从 IndexedDB 取目录句柄 → 写入 Markdown。
 */

import { loadDirectoryHandle, writeMarkdownToDirectory } from '../core/custom-folder';

interface WriteCustomRequest {
  type: 'WRITE_CUSTOM';
  payload: { filename: string; markdown: string };
}

interface WriteCustomResponse {
  success: boolean;
  filename?: string;
  error?: string;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const m = msg as WriteCustomRequest;
  if (!m || m.type !== 'WRITE_CUSTOM') return false;
  void handleWrite(m.payload).then(sendResponse);
  return true; // 异步响应通道
});

async function handleWrite(payload: { filename: string; markdown: string }): Promise<WriteCustomResponse> {
  try {
    const dir = await loadDirectoryHandle();
    if (!dir) return { success: false, error: '未配置自定义文件夹。' };
    const written = await writeMarkdownToDirectory(dir, payload.filename, payload.markdown);
    return { success: true, filename: `${dir.name}/${written}` };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

// 通知 background 就绪（消除 createDocument 与监听注册的竞态）
chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY' }).catch(() => {});
