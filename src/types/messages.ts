/**
 * 消息协议：popup ↔ content、popup ↔ background。
 * 所有类型集中在单文件，避免三方各自定义。
 */

import type { ContentDocument, PlatformContentType, PlatformId } from '../core/schema';

// ---------- 请求 ----------

export type StatusRequest = { type: 'GET_STATUS' };
export type ExtractRequest = { type: 'EXTRACT' };
export type DownloadRequest = { type: 'DOWNLOAD'; payload: { markdown: string; filename: string } };

export type ContentRequest = StatusRequest | ExtractRequest;
export type RuntimeMessage = ContentRequest | DownloadRequest;

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

