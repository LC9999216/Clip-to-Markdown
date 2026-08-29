/**
 * Content Script：在受支持平台页面注入。
 * 处理 GET_STATUS（探测当前页面）、EXTRACT（提取为 ContentDocument）
 * 与 EXTRACT_VISUAL_SOURCE（同时返回 Source Blocks 供原文定位）。
 * 消息触发时即时读取 DOM，不缓存状态（应对 SPA 导航）。
 */

import '../adapters/index';
import { registry } from '../core/platform-registry';
import { ExtractionError } from '../core/error';
import type {
  ExtractResponse,
  ExtractVisualSourceResponse,
  SeekBilibiliVideoResponse,
  NavigateToSourceResponse,
  StatusResponse,
} from '../types/messages';
import {
  isGetBilibiliPlaybackStateRequest,
  isNavigateToSourceRequest,
  isSeekBilibiliVideoRequest,
} from '../types/messages';
import { readBilibiliPlaybackState, seekBilibiliVideo } from '../adapters/bilibili/playback';
import type { PlatformAdapter } from '../adapters/types';
import type { PlatformContentType } from '../core/schema';
import type { VisualSourceExtraction } from '../types/visual-source';

function currentUrl(): URL {
  return new URL(window.location.href);
}

/** 轻量探测标题（非必需，失败返回 undefined） */
function probeTitle(adapter: PlatformAdapter, url: URL, contentType: PlatformContentType): string | undefined {
  try {
    return adapter.detectTitle?.(url, document, contentType) ?? undefined;
  } catch {
    return undefined;
  }
}

function handleGetStatus(): StatusResponse {
  const url = currentUrl();
  const adapter = registry.match(url);
  if (!adapter) return { supported: false, url: url.href };
  const contentType = adapter.detectType(url, document);
  if (!contentType) return { supported: false, url: url.href };
  return {
    supported: true,
    platform: adapter.platform,
    contentType,
    url: url.href,
    title: probeTitle(adapter, url, contentType),
  };
}

function toExtractError(e: unknown): ExtractResponse {
  if (e instanceof ExtractionError) {
    return { success: false, error: { code: e.code, message: e.message } };
  }
  return { success: false, error: { code: 'UNKNOWN', message: `发生未知错误：${String(e)}` } };
}

/** EXTRACT 保持原路径，不受 EXTRACT_VISUAL_SOURCE 影响 */
function handleExtract(): ExtractResponse | Promise<ExtractResponse> {
  try {
    const url = currentUrl();
    const adapter = registry.match(url);
    if (!adapter) {
      throw new ExtractionError('UNSUPPORTED_PAGE', '当前页面不是受支持的帖子/文章页面。');
    }
    if (adapter.extractAsync) {
      return adapter
        .extractAsync(document, url)
        .then((contentDoc): ExtractResponse => ({ success: true, document: contentDoc }))
        .catch(toExtractError);
    }
    return { success: true, document: adapter.extract(document, url) };
  } catch (e) {
    return toExtractError(e);
  }
}

/** EXTRACT_VISUAL_SOURCE：由平台适配器返回文档与可定位来源块 */
function handleExtractVisualSource(): ExtractVisualSourceResponse | Promise<ExtractVisualSourceResponse> {
  try {
    const url = currentUrl();
    const adapter = registry.match(url);
    if (!adapter) {
      throw new ExtractionError('UNSUPPORTED_PAGE', '当前页面不是受支持的帖子/文章页面。');
    }

    const custom = adapter.extractVisualSource?.(document, url);
    if (custom) {
      const resolveCustom = (value: VisualSourceExtraction): ExtractVisualSourceResponse => ({
        success: true,
        document: value.document,
        sourceBlocks: Array.isArray(value.sourceBlocks) ? value.sourceBlocks : [],
      });
      if (custom instanceof Promise) return custom.then(resolveCustom).catch((e) => toExtractError(e) as ExtractVisualSourceResponse);
      return resolveCustom(custom);
    }

    if (adapter.extractAsync) {
      return adapter
        .extractAsync(document, url)
        .then((contentDoc): ExtractVisualSourceResponse => ({ success: true, document: contentDoc, sourceBlocks: [] }))
        .catch((e) => toExtractError(e) as ExtractVisualSourceResponse);
    }
    return { success: true, document: adapter.extract(document, url), sourceBlocks: [] };
  } catch (e) {
    return toExtractError(e) as ExtractVisualSourceResponse;
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (typeof msg === 'object' && msg !== null) {
    const type = (msg as { type?: string }).type;
    if (type === 'GET_BILIBILI_PLAYBACK_STATE') {
      if (!isGetBilibiliPlaybackStateRequest(msg)) {
        sendResponse({
          success: false,
          error: { code: 'INVALID_REQUEST', message: '播放状态请求无效。' },
        });
        return false;
      }
      sendResponse(readBilibiliPlaybackState(document, currentUrl()));
      return false;
    }
    if (type === 'SEEK_BILIBILI_VIDEO') {
      if (!isSeekBilibiliVideoRequest(msg)) {
        sendResponse({
          success: false,
          error: { code: 'INVALID_REQUEST', message: '视频跳转请求无效。' },
        } satisfies SeekBilibiliVideoResponse);
        return false;
      }
      sendResponse(seekBilibiliVideo(document, currentUrl(), msg.payload));
      return false;
    }
    if (type === 'GET_STATUS') {
      sendResponse(handleGetStatus());
      return false;
    }
    if (type === 'EXTRACT') {
      const result = handleExtract();
      if (result instanceof Promise) {
        result.then((resp) => sendResponse(resp));
        return true; // 保持异步响应通道（B 站等需网络请求的平台）
      }
      sendResponse(result);
      return false;
    }
    if (type === 'EXTRACT_VISUAL_SOURCE') {
      const result = handleExtractVisualSource();
      if (result instanceof Promise) {
        result.then((resp) => sendResponse(resp));
        return true;
      }
      sendResponse(result);
      return false;
    }
    if (type === 'NAVIGATE_TO_SOURCE') {
      if (!isNavigateToSourceRequest(msg)) {
        sendResponse({
          success: false,
          error: { code: 'INVALID_REQUEST', message: '原文导航请求无效。' },
        } satisfies NavigateToSourceResponse);
        return false;
      }
      const adapter = registry.match(currentUrl());
      if (!adapter?.navigateToVisualSource) {
        sendResponse({ success: false, error: { code: 'UNSUPPORTED_PAGE', message: '当前页面暂不支持原文定位。' } });
        return false;
      }
      try {
        const result = adapter.navigateToVisualSource(document, currentUrl(), msg.payload);
        if (result instanceof Promise) {
          result.then(sendResponse).catch((error) => sendResponse({
            success: false,
            error: { code: 'TARGET_NOT_FOUND', message: String(error) },
          }));
          return true;
        }
        sendResponse(result);
      } catch (error) {
        sendResponse({ success: false, error: { code: 'TARGET_NOT_FOUND', message: String(error) } });
      }
      return false;
    }
  }
  return false;
});

export {};
