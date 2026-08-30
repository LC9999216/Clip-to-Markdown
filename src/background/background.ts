/**
 * Background Service Worker：特权枢纽。
 * 处理 DOWNLOAD 消息：校验 sender 与载荷，sanitize 文件名，执行下载。
 */

import { downloadMarkdown } from '../core/downloader';
import { getAiOriginPattern } from '../core/ai-settings';
import { sanitizeFilenamePart } from '../core/filename';
import { loadSettings, resolveDownloadPath } from '../core/settings';
import { saveToObsidian, testObsidian } from './obsidian';
import { completeText, testAiConnection, VisualAnalysisRequestError } from '../analysis/client';
import {
  translateBilibiliSubtitleLines,
  type SubtitleTranslationHooks,
} from '../analysis/subtitle-translation';
import type { BiliSubtitleLine } from '../adapters/bilibili/subtitle-types';
import { getVisualAnalysisState, startVisualAnalysis } from './visual-summary';
import { runSave } from './quick-save';
import {
  isDownloadRequest,
  isFetchJsonRequest,
  isGetVisualAnalysisStateRequest,
  isSaveCurrentTabRequest,
  isSaveToObsidianRequest,
  isStartVisualAnalysisRequest,
  isTestAiRequest,
  isTestObsidianRequest,
  isTranslateBilibiliSubtitlesRequest,
  type FetchJsonCredentials,
  type TranslateBilibiliSubtitlesResponse,
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

/**
 * 字幕翻译只接受当前扩展自身的页面（side panel / options / popup）。
 * 不复用 isAllowedSender 的宽松判定，网页 content script 与其他扩展一律拒绝。
 */
function isTrustedExtensionSender(sender: chrome.runtime.MessageSender): boolean {
  const url = sender.url ?? '';
  try {
    const u = new URL(url);
    return u.protocol === 'chrome-extension:' && u.hostname === chrome.runtime.id;
  } catch {
    return false;
  }
}

/** 查询运行时主机权限是否已授予（不发起权限申请）。 */
function hasOriginPermission(pattern: string): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.permissions.contains({ origins: [pattern] }, (granted) => {
      resolve(!chrome.runtime.lastError && granted === true);
    });
  });
}

/** Service Worker 生命周期内的批次翻译备忘：重试时避免为同一批内容重复付费。 */
const subtitleBatchMemo = new Map<string, BiliSubtitleLine[]>();

function batchMemoKey(sourceTrackId: string, batchStart: number, batch: BiliSubtitleLine[]): string {
  const fingerprint = batch.map((line) => `${line.from}-${line.to}-${line.content}`).join('|');
  return `${sourceTrackId}:${batchStart}:${batch.length}:${fingerprint}`;
}

function subtitleTranslationHooks(sourceTrackId: string): SubtitleTranslationHooks {
  return {
    loadBatch: (batchStart, batch) => subtitleBatchMemo.get(batchMemoKey(sourceTrackId, batchStart, batch)),
    saveBatch: (batchStart, batch, translated) => {
      subtitleBatchMemo.set(batchMemoKey(sourceTrackId, batchStart, batch), translated);
    },
  };
}

/**
 * 受信任扩展页的字幕翻译管道：
 * 开关 → 配置完整性 → 主机权限 → 分批 AI 翻译。绝不返回 provider 原始错误正文。
 */
async function handleTranslateBilibiliSubtitles(payload: {
  sourceTrackId: string;
  lines: Array<{ from: number; to: number; content: string }>;
}): Promise<TranslateBilibiliSubtitlesResponse> {
  const settings = await loadSettings();
  const { ai } = settings;
  if (ai.enabled !== true || ai.translateBilibiliSubtitles !== true) {
    return {
      success: false,
      code: 'AI_TRANSLATION_DISABLED',
      error: 'B站字幕自动翻译未开启，请在设置中开启。',
    };
  }
  if (ai.endpoint === '' || ai.apiKey === '' || ai.model === '') {
    return { success: false, code: 'AI_NOT_CONFIGURED', error: '字幕翻译需要先配置并启用AI服务。' };
  }
  const pattern = getAiOriginPattern(ai.endpoint);
  if (pattern === null) {
    return { success: false, code: 'AI_NOT_CONFIGURED', error: 'AI Endpoint 非法，请检查设置。' };
  }
  if (!(await hasOriginPermission(pattern))) {
    return { success: false, code: 'AI_HOST_NOT_GRANTED', error: 'AI接口尚未授权，请在设置中授权并测试。' };
  }
  try {
    const lines = await translateBilibiliSubtitleLines(payload.lines, ai, completeText, subtitleTranslationHooks(payload.sourceTrackId));
    return { success: true, lines };
  } catch (error) {
    if (error instanceof VisualAnalysisRequestError) {
      return { success: false, code: error.code, error: error.message };
    }
    return { success: false, code: 'AI_PROVIDER_ERROR', error: 'AI字幕翻译服务暂时不可用。' };
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
    handleFetchJson(msg.url, msg.credentials)
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

  // ---- 保存当前标签页（side panel 保存按钮，复用快捷键保存管道） ----
  if (messageType(msg) === 'SAVE_CURRENT_TAB') {
    if (!isAllowedSender(sender)) {
      sendResponse({ success: false, error: '来自不受信任页面的保存请求已被拒绝。' });
      return false;
    }
    if (!isSaveCurrentTabRequest(msg)) {
      sendResponse({ success: false, error: '非法保存载荷。' });
      return false;
    }
    runSave('default', msg.payload.tabId)
      .then((outcome) => {
        if (outcome.ok) sendResponse({ success: true, filename: outcome.filename });
        else sendResponse({ success: false, error: outcome.error });
      })
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

  // ---- B站字幕 AI 翻译（仅当前扩展自身页面可发起） ----
  if (messageType(msg) === 'TRANSLATE_BILIBILI_SUBTITLES') {
    if (!isTranslateBilibiliSubtitlesRequest(msg)) {
      sendResponse({ success: false, code: 'AI_INVALID_RESPONSE', error: '非法字幕翻译载荷。' });
      return false;
    }
    if (!isTrustedExtensionSender(sender)) {
      sendResponse({
        success: false,
        code: 'AI_PROVIDER_ERROR',
        error: '来自不受信任页面的字幕翻译请求已被拒绝。',
      });
      return false;
    }
    handleTranslateBilibiliSubtitles(msg.payload)
      .then((resp) => sendResponse(resp))
      .catch(() => sendResponse({
        success: false,
        code: 'AI_PROVIDER_ERROR',
        error: 'AI字幕翻译服务暂时不可用。',
      }));
    return true;
  }

  return false;
});

/**
 * 代理抓取 B 站 JSON：带用户 cookie + referer，绕过内容脚本的页面 CORS 限制。
 * 仅允许 api.bilibili.com / *.hdslb.com 等白名单域名。
 */
async function handleFetchJson(url: string, credentials: FetchJsonCredentials = 'include'): Promise<unknown> {
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
    credentials,
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
