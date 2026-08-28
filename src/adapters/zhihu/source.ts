import { collectDomSourceBlocksWithElements, navigateDomSource } from '../dom-source';
import type { AnalysisSourceBlock } from '../../analysis/types';
import type { VisualNavigationResult, VisualSourceAnchor } from '../../types/visual-source';
import { ANSWER_RE, ARTICLE_RE, ZHIHU_SELECTORS } from './selectors';

function answerItem(doc: Document, aid: string): Element | null {
  const items = Array.from(doc.querySelectorAll(ZHIHU_SELECTORS.answer.item));
  const exact = items.find((item) => {
    const zop = item.getAttribute('data-zop') ?? '';
    return zop.includes(`"itemId":"${aid}"`)
      || Array.from(item.querySelectorAll(ZHIHU_SELECTORS.answerIdLink)).some((a) => (a.getAttribute('href') ?? '').includes(`/answer/${aid}`));
  });
  return exact ?? (items.length === 1 ? items[0] ?? null : null);
}

function bodyContainer(doc: Document, url: URL): Element | null {
  const answer = ANSWER_RE.exec(url.pathname)?.[2];
  if (answer) return answerItem(doc, answer)?.querySelector(ZHIHU_SELECTORS.answer.body) ?? null;
  if (ARTICLE_RE.test(url.pathname)) return doc.querySelector(ZHIHU_SELECTORS.article.item)?.querySelector(ZHIHU_SELECTORS.article.body) ?? null;
  return null;
}

function removeSelector(url: URL): string {
  return ANSWER_RE.test(url.pathname)
    ? ZHIHU_SELECTORS.answer.remove.join(',')
    : ZHIHU_SELECTORS.article.remove.join(',');
}

export function collectZhihuSourceEntries(doc: Document, url: URL) {
  const body = bodyContainer(doc, url);
  if (!body) return [];
  return collectDomSourceBlocksWithElements(body, { includeRootText: true, removeSelector: removeSelector(url) });
}

export function collectZhihuSourceBlocks(doc: Document, url: URL): AnalysisSourceBlock[] {
  return collectZhihuSourceEntries(doc, url).map((entry) => entry.block);
}

function identity(url: URL): string | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!host.endsWith('zhihu.com')) return null;
  const answer = ANSWER_RE.exec(url.pathname);
  if (answer) return `answer:${answer[2]}`;
  const article = ARTICLE_RE.exec(url.pathname);
  return article ? `article:${article[1]}` : null;
}

export function navigateZhihuSource(doc: Document, url: URL, anchor: VisualSourceAnchor): VisualNavigationResult {
  const current = identity(url);
  const expected = (() => { try { return identity(new URL(anchor.expectedSourceUrl)); } catch { return null; } })();
  if (!current) return { success: false, error: { code: 'UNSUPPORTED_PAGE', message: '当前页面不是可定位的知乎内容页。' } };
  if (!expected || expected !== current) return { success: false, error: { code: 'SOURCE_CHANGED', message: '当前页面内容已变化，请重新生成一图速览。' } };
  return navigateDomSource(anchor, collectZhihuSourceEntries(doc, url));
}
