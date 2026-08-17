/**
 * 知乎提取器：回答（/question/{qid}/answer/{aid}）与文章（/p/{id}）。
 * URL 判断优先（比 DOM 稳定）。评论/其他回答/推荐绝不混入。
 */

import { createDomToAstContext, elementToBlocks } from '../../core/dom-to-ast';
import { ExtractionError, ERROR_MESSAGES } from '../../core/error';
import { ANSWER_RE, ARTICLE_RE, ZHIHU_SELECTORS } from './selectors';
import type { AuthorInfo, BlockNode, ContentDocument, PlatformContentType } from '../../core/schema';

export function detectZhihuType(url: URL): PlatformContentType | null {
  if (ANSWER_RE.test(url.pathname)) return 'zhihu-answer';
  if (ARTICLE_RE.test(url.pathname)) return 'zhihu-article';
  return null;
}

export function extractZhihu(doc: Document, url: URL): ContentDocument {
  const type = detectZhihuType(url);
  if (!type) throw new ExtractionError('UNSUPPORTED_PAGE', ERROR_MESSAGES.UNSUPPORTED_PAGE);
  if (!hasReadableContent(doc, type, url) && isLoginWall(doc)) {
    throw new ExtractionError('LOGIN_REQUIRED', ERROR_MESSAGES.LOGIN_REQUIRED);
  }
  return type === 'zhihu-answer' ? extractAnswer(doc, url) : extractArticle(doc, url);
}

// ---------- 回答 ----------

function extractAnswer(doc: Document, url: URL): ContentDocument {
  const aid = ANSWER_RE.exec(url.pathname)?.[2];
  const item = aid ? findFocusedAnswer(doc, aid) : null;
  if (!item) {
    throw new ExtractionError('NOT_FOUND_BODY', ERROR_MESSAGES.NOT_FOUND_BODY);
  }

  const title = textOf(doc.querySelector(ZHIHU_SELECTORS.answer.title)) ?? undefined;
  const author = extractAuthor(item, ZHIHU_SELECTORS.answer.author);
  const published = extractPublished(doc);
  const content = extractBody(item, ZHIHU_SELECTORS.answer.body, ZHIHU_SELECTORS.answer.remove, url.href);

  return {
    version: 1,
    metadata: {
      platform: 'zhihu',
      contentType: 'zhihu-answer',
      sourceUrl: url.href,
      author,
      published,
      title,
      id: aid,
    },
    body: { type: 'article', children: content },
  };
}

/** 按 answerId 定位焦点回答（data-zop 或 /answer/{aid} 链接）；兜底取唯一回答 */
function findFocusedAnswer(doc: Document, aid: string): Element | null {
  const items = Array.from(doc.querySelectorAll(ZHIHU_SELECTORS.answer.item));
  const byId = items.find((el) => {
    const zop = el.getAttribute('data-zop') ?? '';
    if (zop.includes(`"itemId":"${aid}"`)) return true;
    return Array.from(el.querySelectorAll(ZHIHU_SELECTORS.answerIdLink)).some((a) =>
      (a.getAttribute('href') ?? '').includes(`/answer/${aid}`),
    );
  });
  if (byId) return byId;
  return items.length === 1 ? (items[0] ?? null) : null;
}

// ---------- 文章 ----------

function extractArticle(doc: Document, url: URL): ContentDocument {
  const postId = ARTICLE_RE.exec(url.pathname)?.[1];
  const item = doc.querySelector(ZHIHU_SELECTORS.article.item);
  if (!item) {
    throw new ExtractionError('NOT_FOUND_BODY', ERROR_MESSAGES.NOT_FOUND_BODY);
  }

  const title = textOf(doc.querySelector(ZHIHU_SELECTORS.article.title)) ?? undefined;
  const author = extractAuthor(item, ZHIHU_SELECTORS.article.author);
  const published = extractPublished(doc);
  const content = extractBody(item, ZHIHU_SELECTORS.article.body, ZHIHU_SELECTORS.article.remove, url.href);

  return {
    version: 1,
    metadata: {
      platform: 'zhihu',
      contentType: 'zhihu-article',
      sourceUrl: url.href,
      author,
      published,
      title,
      id: postId,
    },
    body: { type: 'article', children: content },
  };
}

// ---------- 共用 ----------

function extractAuthor(item: Element, authorSelector: string): AuthorInfo {
  for (const el of Array.from(item.querySelectorAll(authorSelector))) {
    const link = el.querySelector('a');
    const name = (link?.textContent ?? el.textContent ?? '').trim();
    if (name) return { name };
  }
  throw new ExtractionError('NOT_FOUND_AUTHOR', ERROR_MESSAGES.NOT_FOUND_AUTHOR);
}

/** 发布时间：meta 兜底，不可靠时返回 ''（不阻断流程） */
function extractPublished(doc: Document): string {
  for (const sel of ZHIHU_SELECTORS.publishedMeta) {
    const content = doc.querySelector(sel)?.getAttribute('content');
    if (content) return content;
  }
  return '';
}

/** 在克隆上剔除干扰后取正文块 */
function extractBody(item: Element, bodySelector: string, removeSelectors: readonly string[], baseUrl: string): BlockNode[] {
  const clone = item.cloneNode(true) as Element;
  for (const sel of removeSelectors) {
    for (const el of Array.from(clone.querySelectorAll(sel))) el.remove();
  }
  const bodyEl = clone.querySelector(bodySelector) ?? clone;
  const ctx = createDomToAstContext(baseUrl);
  const content = elementToBlocks(bodyEl, ctx);
  if (content.length === 0) {
    throw new ExtractionError('NOT_FOUND_BODY', ERROR_MESSAGES.NOT_FOUND_BODY);
  }
  return content;
}

function hasReadableContent(doc: Document, type: PlatformContentType, url: URL): boolean {
  if (type === 'zhihu-article') {
    const item = doc.querySelector(ZHIHU_SELECTORS.article.item);
    return Boolean(item?.querySelector(ZHIHU_SELECTORS.article.body));
  }

  if (type === 'zhihu-answer') {
    const aid = ANSWER_RE.exec(url.pathname)?.[2];
    const item = aid ? findFocusedAnswer(doc, aid) : null;
    return Boolean(item?.querySelector(ZHIHU_SELECTORS.answer.body));
  }

  return false;
}

function isLoginWall(doc: Document): boolean {
  return !!doc.querySelector(ZHIHU_SELECTORS.loginIndicators);
}

/** 轻量标题探测 */
export function detectZhihuTitle(url: URL, doc: Document): string | undefined {
  if (ANSWER_RE.test(url.pathname)) {
    return textOf(doc.querySelector(ZHIHU_SELECTORS.answer.title));
  }
  return textOf(doc.querySelector(ZHIHU_SELECTORS.article.title));
}

function textOf(el: Element | null): string | undefined {
  const t = el?.textContent?.trim();
  return t ? t : undefined;
}
