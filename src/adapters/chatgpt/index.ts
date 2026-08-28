/**
 * ChatGPT PlatformAdapter。
 */

import { registry } from '../../core/platform-registry';
import { detectChatgptTitle, detectChatgptType, extractChatgpt, isChatgptHost } from './extractor';
import { collectChatgptSourceBlocks, navigateChatgptSource } from './source';
import type { PlatformAdapter } from '../types';

export const chatgptAdapter: PlatformAdapter = {
  platform: 'chatgpt',

  matches(url: URL): boolean {
    return isChatgptHost(url);
  },

  detectType(url: URL, doc: Document) {
    return detectChatgptType(url, doc);
  },

  extract(doc: Document, url: URL) {
    return extractChatgpt(doc, url);
  },

  detectTitle(_url: URL, doc: Document): string | undefined {
    return detectChatgptTitle(doc);
  },

  extractVisualSource(doc: Document, url: URL) {
    return { document: extractChatgpt(doc, url), sourceBlocks: collectChatgptSourceBlocks(doc, url) };
  },

  navigateToVisualSource(doc, url, anchor) {
    return navigateChatgptSource(doc, url, anchor);
  },
};

registry.register(chatgptAdapter);
