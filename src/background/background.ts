/**
 * Background Service Worker：特权枢纽。
 * 处理 DOWNLOAD 消息：校验 sender 与载荷，sanitize 文件名，执行下载。
 */

import { downloadMarkdown } from '../core/downloader';
import { sanitizeFilenamePart } from '../core/filename';
import { loadSettings, resolveDownloadPath } from '../core/settings';
import { saveToObsidian, testObsidian } from './obsidian';
import {
  isDownloadRequest,
  isFetchJsonRequest,
  isSaveToObsidianRequest,
  isTestObsidianRequest,
} from '../types/messages';
import './quick-save';

/** 与 manifest host_permissions 保持一致 */
const ALLOWED_HOSTS = [
  'x.com',
  'twitter.com',
  'zhihu.com',
  'xiaoheihe.cn',
  'chatgpt.com',
  'openai.com',
  'bilibili.com',
] as const;

/** FETCH_JSON 代理仅允许 B 站相关域名（api.bilibili.com 与字幕 CDN *.hdslb.com） */
const FETCH_JSON_ALLOWED_HOSTS = ['api.bilibili.com', 'bilibili.com', 'hdslb.com'] as const;

function hostAllowed(hostname: string): boolean {
  const host = hostname.replace(/^www\./, '').toLowerCase();
  return ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

function fetchJsonHostAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return FETCH_JSON_ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
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
  // ---- 下载 Markdown 文件 ----
  if (isDownloadRequest(msg)) {
    if (!isAllowedSender(sender)) {
      sendResponse({ success: false, error: '来自不受信任页面的下载请求已被拒绝。' });
      return false;
    }

    const { markdown, filename } = msg.payload;
    if (!markdown || !filename) {
      sendResponse({ success: false, error: '非法下载载荷。' });
      return false;
    }

    // background 独立入口：sanitize 后可能为空，兜底避免下载失败
    const safe = sanitizeFilenamePart(filename) || `clip2md-${Date.now()}.md`;
    loadSettings()
      .then((settings) => resolveDownloadPath(safe, settings.save))
      .then(({ filename: path, saveAs }) => downloadMarkdown({ markdown, filename: path, saveAs }))
      .then((r) => sendResponse({ success: true, filename: r.filename }))
      .catch((e) => sendResponse({ success: false, error: String(e) }));
    return true; // 保持异步响应通道
  }

  // ---- B 站 JSON 代理（content script 抓字幕用） ----
  if (isFetchJsonRequest(msg)) {
    if (!isAllowedSender(sender)) {
      sendResponse({ success: false, error: '来自不受信任页面的请求已被拒绝。' });
      return false;
    }
    handleFetchJson(msg.url)
      .then((data) => sendResponse({ success: true, data }))
      .catch((e) => sendResponse({ success: false, error: String(e) }));
    return true;
  }

  // ---- 保存到 Obsidian（Local REST API） ----
  if (isSaveToObsidianRequest(msg)) {
    if (!isAllowedSender(sender)) {
      sendResponse({ success: false, error: '来自不受信任页面的请求已被拒绝。' });
      return false;
    }
    saveToObsidian(msg.payload)
      .then((filename) => sendResponse({ success: true, filename }))
      .catch((e) => {
        const exists = (e as { exists?: boolean } | null)?.exists === true;
        sendResponse({ success: false, error: String(e), ...(exists ? { exists: true } : {}) });
      });
    return true;
  }

  // ---- 测试 Obsidian 连接 ----
  if (isTestObsidianRequest(msg)) {
    if (!isAllowedSender(sender)) {
      sendResponse({ success: false, error: '来自不受信任页面的请求已被拒绝。' });
      return false;
    }
    testObsidian()
      .then((service) => sendResponse({ success: true, service }))
      .catch((e) => sendResponse({ success: false, error: String(e) }));
    return true;
  }

  return false;
});

/**
 * 代理抓取 B 站 JSON：带用户 cookie + referer，绕过内容脚本的页面 CORS 限制。
 * 仅允许 api.bilibili.com / *.hdslb.com 等白名单域名。
 */
async function handleFetchJson(url: string): Promise<unknown> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('非法 URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('仅支持 http/https URL');
  }
  if (!fetchJsonHostAllowed(parsed.hostname)) {
    throw new Error('该域名不在允许抓取范围内');
  }

  const headers = new Headers();
  headers.set('Accept', 'application/json, text/plain, */*');
  headers.set('Accept-Language', 'zh-CN,zh;q=0.9,en;q=0.8');
  headers.set('Cache-Control', 'no-cache');
  headers.set('Pragma', 'no-cache');

  const resp = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers,
    referrer: 'https://www.bilibili.com/',
    referrerPolicy: 'strict-origin-when-cross-origin',
  });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('返回的不是有效 JSON');
  }
}

export {};
