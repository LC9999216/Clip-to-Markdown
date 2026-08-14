/**
 * 知乎 PlatformAdapter。
 */

import { registry } from '../../core/platform-registry';
import { detectZhihuTitle, detectZhihuType, extractZhihu } from './extractor';
import type { PlatformAdapter } from '../types';

export const zhihuAdapter: PlatformAdapter = {
  platform: 'zhihu',

  matches(url: URL): boolean {
    return url.hostname === 'zhihu.com' || url.hostname.endsWith('.zhihu.com');
  },

  detectType(url: URL) {
    return detectZhihuType(url);
  },

  extract(doc: Document, url: URL) {
    return extractZhihu(doc, url);
  },

  detectTitle(url: URL, doc: Document): string | undefined {
    return detectZhihuTitle(url, doc);
  },
};

registry.register(zhihuAdapter);
