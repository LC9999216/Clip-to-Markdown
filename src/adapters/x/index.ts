/**
 * X / Twitter PlatformAdapter。
 * 同一 /status/{id} URL 根据真实 DOM 区分普通推文与长文章（X Articles），
 * 每次保存时重新判断，兼容 X 的 SPA 页面切换。
 */

import { registry } from '../../core/platform-registry';
import { STATUS_ID_RE } from './selectors';
import {
  detectXArticleTitle,
  detectXTitle,
  extractTweet,
  extractXArticle,
  isXArticlePage,
} from './extractor';
import type { PlatformAdapter } from '../types';
import type { PlatformContentType } from '../../core/schema';

export const xAdapter: PlatformAdapter = {
  platform: 'x',

  matches(url: URL): boolean {
    return url.hostname === 'x.com' || url.hostname === 'twitter.com';
  },

  detectType(url: URL, doc: Document): PlatformContentType | null {
    if (!STATUS_ID_RE.test(url.pathname)) return null;
    return isXArticlePage(doc) ? 'x-article' : 'tweet';
  },

  extract(doc: Document, url: URL) {
    return isXArticlePage(doc) ? extractXArticle(doc, url) : extractTweet(doc, url);
  },

  detectTitle(url: URL, doc: Document, contentType: PlatformContentType): string | undefined {
    return contentType === 'x-article' ? detectXArticleTitle(doc) : detectXTitle(url, doc);
  },
};

registry.register(xAdapter);
