/**
 * Background Service Worker：特权枢纽。
 * 处理 DOWNLOAD 消息：校验 sender 与载荷，sanitize 文件名，执行下载。
 */

import { downloadMarkdown } from '../core/downloader';
import { sanitizeFilenamePart } from '../core/filename';
import { loadSettings, resolveDownloadPath } from '../core/settings';
import { isDownloadRequest } from '../types/messages';
import './quick-save';

/** 与 manifest host_permissions 保持一致 */
const ALLOWED_HOSTS = ['x.com', 'twitter.com', 'zhihu.com', 'xiaoheihe.cn'] as const;

function hostAllowed(hostname: string): boolean {
  const host = hostname.replace(/^www\./, '').toLowerCase();
  return ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** 只接受来自受支持平台页面（content script）或扩展页面的下载请求 */
function isAllowedSender(sender: chrome.runtime.MessageSender): boolean {
  const url = sender.url;
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol === 'chrome-extension:') {
      return true;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return hostAllowed(u.hostname);
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!isDownloadRequest(msg)) return false;

  if (!isAllowedSender(sender)) {
    sendResponse({ success: false, error: '来自不受信任页面的下载请求已被拒绝。' });
    return false;
  }

  const { markdown, filename } = msg.payload;
  if (typeof markdown !== 'string' || typeof filename !== 'string' || !markdown || !filename) {
    sendResponse({ success: false, error: '非法下载载荷。' });
    return false;
  }

  // background 独立入口：sanitize 后可能为空，兜底避免下载失败
  const safe = sanitizeFilenamePart(filename) || `clip2md-${Date.now()}.md`;
  loadSettings()
    .then((settings) => resolveDownloadPath(safe, settings))
    .then(({ filename: path, saveAs }) => downloadMarkdown({ markdown, filename: path, saveAs }))
    .then((r) => sendResponse({ success: true, filename: r.filename }))
    .catch((e) => sendResponse({ success: false, error: String(e) }));
  return true; // 保持异步响应通道
});

export {};
