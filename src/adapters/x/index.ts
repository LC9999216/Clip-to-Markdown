/**
 * X / Twitter PlatformAdapter。
 */

import { registry } from '../../core/platform-registry';
import { STATUS_ID_RE } from './selectors';
import { detectXTitle, extractTweet } from './extractor';
import type { PlatformAdapter } from '../types';
import type { PlatformContentType } from '../../core/schema';

export const xAdapter: PlatformAdapter = {
  platform: 'x',

  matches(url: URL): boolean {
    return url.hostname === 'x.com' || url.hostname === 'twitter.com';
  },

  detectType(url: URL): PlatformContentType | null {
    return STATUS_ID_RE.test(url.pathname) ? 'tweet' : null;
  },

  extract(doc: Document, url: URL) {
    return extractTweet(doc, url);
  },

  detectTitle(url: URL, doc: Document): string | undefined {
    return detectXTitle(url, doc);
  },
};

registry.register(xAdapter);
