/**
 * Content Script：在受支持平台页面注入。
 * 处理 GET_STATUS（探测当前页面）与 EXTRACT（提取为 ContentDocument）。
 * 消息触发时即时读取 DOM，不缓存状态（应对 SPA 导航）。
 */

import '../adapters/index';
import { registry } from '../core/platform-registry';
import { ExtractionError } from '../core/error';
import type { ExtractResponse, StatusResponse } from '../types/messages';
import type { PlatformAdapter } from '../adapters/types';
import type { PlatformContentType } from '../core/schema';

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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (typeof msg === 'object' && msg !== null) {
    const type = (msg as { type?: string }).type;
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
  }
  return false;
});

export {};
