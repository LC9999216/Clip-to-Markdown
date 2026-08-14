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

export function isDownloadRequest(m: unknown): m is DownloadRequest {
  return (
    typeof m === 'object' &&
    m !== null &&
    (m as Record<string, unknown>).type === 'DOWNLOAD' &&
    typeof (m as Record<string, unknown>).payload === 'object' &&
    (m as Record<string, unknown>).payload !== null
  );
}

