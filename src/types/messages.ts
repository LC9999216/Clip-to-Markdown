/**
 * 消息协议：popup ↔ content、popup ↔ background。
 * 所有类型集中在单文件，避免三方各自定义。
 */

import type { ContentDocument, PlatformContentType, PlatformId } from '../core/schema';
import type { AnalysisSourceBlock, VisualAnalysisState } from '../analysis/types';
import type { VisualNavigationErrorCode, VisualSourceAnchor } from './visual-source';

// ---------- 请求 ----------

export type StatusRequest = { type: 'GET_STATUS' };
export type ExtractRequest = { type: 'EXTRACT' };

/**
 * 一次读取返回 ContentDocument + Source Blocks（平台适配器可选提供）。
 */
export type ExtractVisualSourceRequest = { type: 'EXTRACT_VISUAL_SOURCE' };
export type DownloadRequest = { type: 'DOWNLOAD'; payload: { markdown: string; filename: string } };

/** 请求 Content Script 将当前页面滚动或跳转到经过校验的原文块。 */
export type NavigateToSourceRequest = {
  type: 'NAVIGATE_TO_SOURCE';
  payload: VisualSourceAnchor;
};

export type NavigationErrorCode = VisualNavigationErrorCode;

/**
 * content script 请求 background 代理抓取 JSON（仅限 B 站相关域名）。
 * B 站字幕需要带用户 cookie + referer，且内容脚本受页面 CORS 限制，故统一走 SW 代理。
 */
export type FetchJsonCredentials = 'include' | 'omit';
export type FetchJsonRequest = { type: 'FETCH_JSON'; url: string; credentials?: FetchJsonCredentials };
export type FetchJsonResponse =
  | { success: true; data: unknown }
  | { success: false; error: string };

/**
 * 保存到 Obsidian（Local REST API）。overwrite 为 true 时跳过「已存在」拦截直接覆盖。
 */
export type SaveToObsidianRequest = {
  type: 'SAVE_TO_OBSIDIAN';
  payload: { markdown: string; filename: string; overwrite?: boolean };
};
export type SaveToObsidianResponse =
  | { success: true; filename: string }
  | { success: false; error: string; exists?: boolean };

/** 测试 Obsidian Local REST API 连通性（options 页「测试连接」）。 */
export type TestObsidianRequest = { type: 'TEST_OBSIDIAN' };
export type TestObsidianResponse = { success: true; service: string } | { success: false; error: string };

/** 开始一图速览分析。force 为 true 时绕过会话缓存。 */
export type StartVisualAnalysisRequest = {
  type: 'START_VISUAL_ANALYSIS';
  payload: { tabId: number; force?: boolean };
};
export type StartVisualAnalysisResponse =
  | { success: true; requestId: string }
  | { success: false; error: string };

/** 读取指定标签页当前的一图速览状态。 */
export type GetVisualAnalysisStateRequest = {
  type: 'GET_VISUAL_ANALYSIS_STATE';
  payload: { tabId: number };
};
export type GetVisualAnalysisStateResponse =
  | { success: true; state: VisualAnalysisState | null }
  | { success: false; error: string };

/** 测试 AI 连接（Options 页「授权并测试」）。 */
export type TestAiRequest = { type: 'TEST_AI' };
export type TestAiResponse =
  | { success: true; model: string }
  | { success: false; error: string };

/** 保存当前标签页为 Markdown（side panel 保存按钮，复用快捷键保存管道）。 */
export type SaveCurrentTabRequest = {
  type: 'SAVE_CURRENT_TAB';
  payload: { tabId: number };
};
export type SaveCurrentTabResponse =
  | { success: true; filename: string }
  | { success: false; error: string };

export type ContentRequest = StatusRequest | ExtractRequest | ExtractVisualSourceRequest | NavigateToSourceRequest;
export type RuntimeMessage =
  | ContentRequest
  | DownloadRequest
  | FetchJsonRequest
  | SaveToObsidianRequest
  | TestObsidianRequest
  | StartVisualAnalysisRequest
  | GetVisualAnalysisStateRequest
  | TestAiRequest
  | SaveCurrentTabRequest;

// ---------- offscreen 消息 ----------

/** offscreen 文档加载完成时发送的就绪信号（消除 createDocument 与监听注册的竞态） */
export type OffscreenReadyMessage = { type: 'OFFSCREEN_READY' };

export type WriteCustomRequest = {
  type: 'WRITE_CUSTOM';
  payload: { filename: string; markdown: string };
};

export type WriteCustomResponse =
  | { success: true; filename: string }
  | { success: false; error: string };

// ---------- 响应 ----------

export interface StatusResponse {
  supported: boolean;
  platform?: PlatformId;
  contentType?: PlatformContentType;
  url: string;
  title?: string;
}

export type ExtractResponse =
  | { success: true; document: ContentDocument }
  | { success: false; error: { code: string; message: string } };

export type ExtractVisualSourceResponse =
  | { success: true; document: ContentDocument; sourceBlocks: AnalysisSourceBlock[] }
  | { success: false; error: { code: string; message: string } };

export type NavigateToSourceResponse =
  | { success: true }
  | { success: false; error: { code: NavigationErrorCode; message: string } };

export type DownloadResponse = { success: true; filename: string } | { success: false; error: string };

// ---------- 类型守卫 ----------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function isDownloadRequest(m: unknown): m is DownloadRequest {
  if (!isRecord(m)) return false;
  if (m.type !== 'DOWNLOAD') return false;
  if (!isRecord(m.payload)) return false;
  return typeof m.payload.markdown === 'string' && typeof m.payload.filename === 'string';
}

/**
 * 校验 WRITE_CUSTOM 请求：type 严格等于 WRITE_CUSTOM，payload 含非空 filename/markdown，
 * 且 filename 不接受路径分隔符或绝对路径。Markdown 只作为文本写入，不解释为 HTML。
 */
export function isWriteCustomRequest(m: unknown): m is WriteCustomRequest {
  if (!isRecord(m)) return false;
  if (m.type !== 'WRITE_CUSTOM') return false;
  if (!isRecord(m.payload)) return false;
  const { filename, markdown } = m.payload;
  if (typeof filename !== 'string' || filename === '') return false;
  if (typeof markdown !== 'string' || markdown === '') return false;
  if (/[/\\]/.test(filename)) return false;
  return true;
}

export function isExtractVisualSourceRequest(m: unknown): m is ExtractVisualSourceRequest {
  return isRecord(m) && m.type === 'EXTRACT_VISUAL_SOURCE';
}

const SOURCE_BLOCK_ID_RE = /^B\d{3,}$/;

function isNavigableSourceUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    return host === 'x.com'
      || host === 'twitter.com'
      || host === 'zhihu.com'
      || host.endsWith('.zhihu.com')
      || host === 'xiaoheihe.cn'
      || host.endsWith('.xiaoheihe.cn')
      || host === 'chatgpt.com'
      || host === 'chat.openai.com'
      || host === 'bilibili.com';
  } catch {
    return false;
  }
}

export function isNavigateToSourceRequest(m: unknown): m is NavigateToSourceRequest {
  if (!isRecord(m) || m.type !== 'NAVIGATE_TO_SOURCE' || !isRecord(m.payload)) return false;
  const { expectedSourceUrl, sourceBlockId, sourceQuote } = m.payload;
  return isNavigableSourceUrl(expectedSourceUrl)
    && typeof sourceBlockId === 'string'
    && SOURCE_BLOCK_ID_RE.test(sourceBlockId)
    && typeof sourceQuote === 'string'
    && sourceQuote.trim() !== ''
    && Array.from(sourceQuote).length <= 140;
}

export function isFetchJsonRequest(m: unknown): m is FetchJsonRequest {
  if (!isRecord(m)) return false;
  return m.type === 'FETCH_JSON'
    && typeof m.url === 'string'
    && m.url !== ''
    && (m.credentials === undefined || m.credentials === 'include' || m.credentials === 'omit');
}

export function isSaveToObsidianRequest(m: unknown): m is SaveToObsidianRequest {
  if (!isRecord(m)) return false;
  if (m.type !== 'SAVE_TO_OBSIDIAN') return false;
  if (!isRecord(m.payload)) return false;
  const { markdown, filename } = m.payload;
  return typeof markdown === 'string' && markdown !== '' && typeof filename === 'string' && filename !== '';
}

export function isTestObsidianRequest(m: unknown): m is TestObsidianRequest {
  if (!isRecord(m)) return false;
  return m.type === 'TEST_OBSIDIAN';
}

export function isStartVisualAnalysisRequest(m: unknown): m is StartVisualAnalysisRequest {
  if (!isRecord(m)) return false;
  if (m.type !== 'START_VISUAL_ANALYSIS') return false;
  if (!isRecord(m.payload)) return false;
  if (typeof m.payload.tabId !== 'number' || !Number.isInteger(m.payload.tabId)) return false;
  if (m.payload.force !== undefined && typeof m.payload.force !== 'boolean') return false;
  return true;
}

export function isGetVisualAnalysisStateRequest(m: unknown): m is GetVisualAnalysisStateRequest {
  if (!isRecord(m)) return false;
  if (m.type !== 'GET_VISUAL_ANALYSIS_STATE') return false;
  if (!isRecord(m.payload)) return false;
  return typeof m.payload.tabId === 'number' && Number.isInteger(m.payload.tabId);
}

export function isTestAiRequest(m: unknown): m is TestAiRequest {
  if (!isRecord(m)) return false;
  return m.type === 'TEST_AI';
}

export function isSaveCurrentTabRequest(m: unknown): m is SaveCurrentTabRequest {
  if (!isRecord(m)) return false;
  if (m.type !== 'SAVE_CURRENT_TAB') return false;
  if (!isRecord(m.payload)) return false;
  return typeof m.payload.tabId === 'number' && Number.isInteger(m.payload.tabId);
}

