import { collectDomSourceBlocksWithElements, navigateDomSource } from '../dom-source';
import type { AnalysisSourceBlock } from '../../analysis/types';
import type { VisualNavigationResult, VisualSourceAnchor } from '../../types/visual-source';
import { CONTENT_PATH_BLOCKLIST, HEYBOX_SELECTORS } from './selectors';

function item(doc: Document): Element | null {
  for (const selector of HEYBOX_SELECTORS.item) {
    const found = doc.querySelector(selector);
    if (found) return found;
  }
  return null;
}

function firstIn(root: Element, selectors: readonly string[]): Element | null {
  for (const selector of selectors) {
    const found = root.querySelector(selector);
    if (found) return found;
  }
  return null;
}

function body(doc: Document, url: URL): Element | null {
  if (url.hostname !== 'www.xiaoheihe.cn' && url.hostname !== 'xiaoheihe.cn') return null;
  if (url.pathname === '/' || CONTENT_PATH_BLOCKLIST.some((re) => re.test(url.pathname))) return null;
  const post = item(doc);
  return post ? firstIn(post, HEYBOX_SELECTORS.body) ?? post : null;
}

export function collectHeyboxSourceEntries(doc: Document, url: URL) {
  const root = body(doc, url);
  if (!root) return [];
  return collectDomSourceBlocksWithElements(root, { includeRootText: true });
}

export function collectHeyboxSourceBlocks(doc: Document, url: URL): AnalysisSourceBlock[] {
  return collectHeyboxSourceEntries(doc, url).map((entry) => entry.block);
}

function postIdentity(url: URL): string | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'xiaoheihe.cn') return null;
  const queryId = url.searchParams.get('post_id') ?? url.searchParams.get('article_id') ?? url.searchParams.get('link_id');
  if (queryId) return queryId;
  const last = url.pathname.split('/').filter(Boolean).pop();
  return last && /^\d+$/.test(last) ? last : null;
}

export function navigateHeyboxSource(doc: Document, url: URL, anchor: VisualSourceAnchor): VisualNavigationResult {
  const current = postIdentity(url);
  let expected: string | null = null;
  try { expected = postIdentity(new URL(anchor.expectedSourceUrl)); } catch { /* invalid request is filtered earlier */ }
  if (!current) return { success: false, error: { code: 'UNSUPPORTED_PAGE', message: '当前页面不是可定位的小黑盒内容页。' } };
  if (!expected || expected !== current) return { success: false, error: { code: 'SOURCE_CHANGED', message: '当前页面内容已变化，请重新生成一图速览。' } };
  return navigateDomSource(anchor, collectHeyboxSourceEntries(doc, url));
}
