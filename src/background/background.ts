/**
 * Background Service Worker：特权枢纽。
 * 处理 DOWNLOAD 消息：校验 sender 与载荷，sanitize 文件名，执行下载。
 */

import { downloadMarkdown } from '../core/downloader';
import { sanitizeFilenamePart } from '../core/filename';
import { loadSettings, resolveDownloadPath } from '../core/settings';
import { saveToObsidian, testObsidian } from './obsidian';
import { testAiConnection } from '../analysis/client';
import { getVisualAnalysisState, startVisualAnalysis } from './visual-summary';
import {
  isDownloadRequest,
  isFetchJsonRequest,
  isGetVisualAnalysisStateRequest,
  isSaveToObsidianRequest,
  isStartVisualAnalysisRequest,
  isTestAiRequest,
  isTestObsidianRequest,
} from '../types/messages';
import './quick-save';
import './visual-summary-command';

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

/** 仅按 type 字段做粗匹配（不校验 payload），用于先拒绝非法载荷再进入正式守卫。 */
function messageType(msg: unknown): string | null {
  if (typeof msg !== 'object' || msg === null) return null;
  const t = (msg as { type?: unknown }).type;
  return typeof t === 'string' ? t : null;
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
        const exists = (e as { code?: string; exists?: boolean } | null)?.code === 'note-exists'
          || (e as { exists?: boolean } | null)?.exists === true;
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

  // ---- 开始一图速览分析（side panel 触发） ----
  if (messageType(msg) === 'START_VISUAL_ANALYSIS') {
    if (!isAllowedSender(sender)) {
      sendResponse({ success: false, error: '来自不受信任页面的一图速览请求已被拒绝。' });
      return false;
    }
    if (!isStartVisualAnalysisRequest(msg)) {
      sendResponse({ success: false, error: '非法一图速览载荷。' });
      return false;
    }
    startVisualAnalysis(msg.payload.tabId, { force: msg.payload.force })
      .then(({ requestId }) => sendResponse({ success: true, requestId }))
      .catch((e) => sendResponse({ success: false, error: String(e) }));
    return true;
  }

  // ---- 读取一图速览状态（side panel 轮询） ----
  if (messageType(msg) === 'GET_VISUAL_ANALYSIS_STATE') {
    if (!isAllowedSender(sender)) {
      sendResponse({ success: false, error: '来自不受信任页面的状态读取已被拒绝。' });
      return false;
    }
    if (!isGetVisualAnalysisStateRequest(msg)) {
      sendResponse({ success: false, error: '非法一图速览载荷。' });
      return false;
    }
    getVisualAnalysisState(msg.payload.tabId)
      .then((state) => sendResponse({ success: true, state }))
      .catch((e) => sendResponse({ success: false, error: String(e) }));
    return true;
  }

  // ---- 测试 AI 连接（options 页「授权并测试」） ----
  if (isTestAiRequest(msg)) {
    if (!isAllowedSender(sender)) {
      sendResponse({ success: false, error: '来自不受信任页面的请求已被拒绝。' });
      return false;
    }
    loadSettings()
      .then((settings) => testAiConnection(settings.ai))
      .then(({ model }) => sendResponse({ success: true, model }))
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
