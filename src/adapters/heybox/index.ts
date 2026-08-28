/**
 * 小黑盒 PlatformAdapter。
 */

import { registry } from '../../core/platform-registry';
import { detectHeyboxTitle, detectHeyboxType, extractHeybox } from './extractor';
import { collectHeyboxSourceBlocks, navigateHeyboxSource } from './source';
import type { PlatformAdapter } from '../types';

export const heyboxAdapter: PlatformAdapter = {
  platform: 'heybox',

  matches(url: URL): boolean {
    return url.hostname === 'www.xiaoheihe.cn' || url.hostname === 'xiaoheihe.cn';
  },

  detectType(url: URL) {
    return detectHeyboxType(url);
  },

  extract(doc: Document, url: URL) {
    return extractHeybox(doc, url);
  },

  detectTitle(_url: URL, doc: Document): string | undefined {
    return detectHeyboxTitle(doc);
  },

  extractVisualSource(doc: Document, url: URL) {
    return { document: extractHeybox(doc, url), sourceBlocks: collectHeyboxSourceBlocks(doc, url) };
  },

  navigateToVisualSource(doc, url, anchor) {
    return navigateHeyboxSource(doc, url, anchor);
  },
};

registry.register(heyboxAdapter);
