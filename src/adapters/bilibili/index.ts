/**
 * B 站 PlatformAdapter。
 * 仅覆盖视频页（/video/BV...）与稍后再看列表页（/list/watchlater）。
 * 提取为异步（需调用 B 站 API 获取字幕）。
 */

import { registry } from '../../core/platform-registry';
import { ExtractionError, ERROR_MESSAGES } from '../../core/error';
import { BVID_RE } from './selectors';
import { detectBilibiliTitle, extractBilibiliAsync, extractBilibiliVisualSourceAsync } from './extractor';
import { navigateBilibiliSource, rememberBilibiliSource } from './source';
import type { PlatformAdapter } from '../types';
import type { PlatformContentType } from '../../core/schema';

export const bilibiliAdapter: PlatformAdapter = {
  platform: 'bilibili',

  matches(url: URL): boolean {
    if (url.hostname !== 'www.bilibili.com') return false;
    const p = url.pathname;
    return p === '/list/watchlater' || p === '/list/watchlater/' || p.startsWith('/video/');
  },

  detectType(url: URL, _doc: Document): PlatformContentType | null {
    return BVID_RE.test(url.pathname) ? 'bilibili-video' : null;
  },

  extract(_doc: Document, _url: URL) {
    // 同步路径不被使用：content-script 检测到 extractAsync 后走异步提取。
    throw new ExtractionError('UNSUPPORTED_PAGE', ERROR_MESSAGES.UNSUPPORTED_PAGE);
  },

  extractAsync(doc: Document, url: URL) {
    return extractBilibiliAsync(doc, url);
  },

  detectTitle(_url: URL, doc: Document): string | undefined {
    return detectBilibiliTitle(doc);
  },

  async extractVisualSource(doc: Document, url: URL) {
    const extracted = await extractBilibiliVisualSourceAsync(doc, url);
    rememberBilibiliSource(url, extracted.sourceEntries);
    return {
      document: extracted.document,
      sourceBlocks: extracted.sourceEntries.map((entry) => entry.block),
    };
  },

  navigateToVisualSource(doc, url, anchor) {
    return navigateBilibiliSource(doc, url, anchor);
  },
};

registry.register(bilibiliAdapter);
