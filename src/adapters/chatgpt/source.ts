import { collectDomSourceBlocksWithElements, type DomSourceEntry, navigateDomSource } from '../dom-source';
import { normalizeBlockText, sourceBlockId } from '../../analysis/source-blocks';
import { getSupportedMessages, isChatgptHost, normalizeMarkdownText } from './extractor';
import { CHATGPT_SELECTORS, CHAT_ID_RE } from './selectors';
import type { AnalysisSourceBlock } from '../../analysis/types';
import type { VisualNavigationResult, VisualSourceAnchor } from '../../types/visual-source';

function userEntry(message: Element, index: number): DomSourceEntry | null {
  const content = message.querySelector(CHATGPT_SELECTORS.userContent) ?? message;
  const text = normalizeBlockText(normalizeMarkdownText(content.textContent ?? ''));
  if (!text) return null;
  return { block: { id: sourceBlockId(index), kind: 'paragraph', text }, element: message };
}

export function collectChatgptSourceEntries(doc: Document, _url: URL): DomSourceEntry[] {
  const entries: DomSourceEntry[] = [];
  let index = 0;
  for (const message of getSupportedMessages(doc)) {
    const role = message.getAttribute(CHATGPT_SELECTORS.role);
    if (role === 'user') {
      const entry = userEntry(message, index);
      if (entry) { entries.push(entry); index += 1; }
      continue;
    }
    const content = message.querySelector(CHATGPT_SELECTORS.assistantContent) ?? message;
    const nested = collectDomSourceBlocksWithElements(content, {
      includeRootText: true,
      removeSelector: CHATGPT_SELECTORS.remove.join(','),
    });
    for (const entry of nested) {
      entries.push({ block: { ...entry.block, id: sourceBlockId(index++) }, element: entry.element });
    }
  }
  return entries;
}

export function collectChatgptSourceBlocks(doc: Document, url: URL): AnalysisSourceBlock[] {
  return collectChatgptSourceEntries(doc, url).map((entry) => entry.block);
}

function identity(url: URL): string | null {
  if (!isChatgptHost(url) || /^\/(auth|login|settings)(\/|$)/.test(url.pathname)) return null;
  const id = CHAT_ID_RE.exec(url.pathname)?.[1];
  return id ? `chat:${id}` : `page:${url.hostname}${url.pathname.replace(/\/$/, '') || '/'}`;
}

export function navigateChatgptSource(doc: Document, url: URL, anchor: VisualSourceAnchor): VisualNavigationResult {
  const current = identity(url);
  let expected: string | null = null;
  try { expected = identity(new URL(anchor.expectedSourceUrl)); } catch { /* invalid request is filtered earlier */ }
  if (!current) return { success: false, error: { code: 'UNSUPPORTED_PAGE', message: '当前页面不是可定位的 ChatGPT 对话页。' } };
  if (!expected || expected !== current) return { success: false, error: { code: 'SOURCE_CHANGED', message: '当前对话内容已变化，请重新生成一图速览。' } };
  return navigateDomSource(anchor, collectChatgptSourceEntries(doc, url));
}
