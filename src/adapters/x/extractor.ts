/**
 * X / Twitter 推文提取器。
 * 只取当前这一条推文：按 URL 中的 tweetId 定位 article，排除回复/推广/互动按钮。
 */

import { createDomToAstContext, elementToInline } from '../../core/dom-to-ast';
import { ExtractionError, ERROR_MESSAGES } from '../../core/error';
import { STATUS_ID_RE, X_SELECTORS } from './selectors';
import type { AuthorInfo, BlockNode, ContentDocument, ImageNode, TweetNode } from '../../core/schema';

export function extractTweet(doc: Document, url: URL): ContentDocument {
  const tweetId = STATUS_ID_RE.exec(url.pathname)?.[1];
  if (!tweetId) {
    throw new ExtractionError('UNSUPPORTED_PAGE', ERROR_MESSAGES.UNSUPPORTED_PAGE);
  }

  const article = findFocusedArticle(doc, tweetId);
  if (!article) {
    if (isLoginWall(doc)) {
      throw new ExtractionError('LOGIN_REQUIRED', ERROR_MESSAGES.LOGIN_REQUIRED);
    }
    throw new ExtractionError('NOT_FOUND_BODY', ERROR_MESSAGES.NOT_FOUND_BODY);
  }

  const author = extractAuthor(article);
  const published = extractPublished(article, tweetId);
  const quotedTweet = extractQuotedTweet(article, url.href);

  // 在克隆上清洗，避免改动真实 DOM；移除引用容器后再取正文/媒体
  const clone = cleanClone(article);
  removeQuoteContainers(clone);
  const content = extractContent(clone, url.href);
  const media = extractMedia(clone);

  const canonicalUrl = `https://x.com/${author.handle ?? 'user'}/status/${tweetId}`;
  const body: TweetNode = {
    type: 'tweet',
    author,
    published,
    id: tweetId,
    content,
    media,
    ...(quotedTweet ? { quotedTweet } : {}),
  };

  return {
    version: 1,
    metadata: {
      platform: 'x',
      contentType: 'tweet',
      sourceUrl: canonicalUrl,
      author,
      published,
      id: tweetId,
    },
    body,
  };
}

/** 按 tweetId 定位焦点推文；排除推广；兜底取唯一的 article */
export function findFocusedArticle(doc: Document, tweetId: string): Element | null {
  const articles = Array.from(doc.querySelectorAll(X_SELECTORS.article)).filter((a) => !isPromoted(a));
  const byLink = articles.find((a) =>
    Array.from(a.querySelectorAll(X_SELECTORS.statusLink)).some((link) =>
      (link.getAttribute('href') ?? '').includes(`/status/${tweetId}`),
    ),
  );
  if (byLink) return byLink;
  return articles.length === 1 ? (articles[0] ?? null) : null;
}

export function isPromoted(article: Element): boolean {
  if (article.querySelector(X_SELECTORS.promotedIndicators)) return true;
  const userNameText = article.querySelector(X_SELECTORS.userName)?.textContent ?? '';
  return /(广告|推广|Promoted|Sponsored|広告)/i.test(userNameText);
}

export function extractAuthor(article: Element): AuthorInfo {
  const userName = article.querySelector(X_SELECTORS.userName);
  if (!userName) {
    throw new ExtractionError('NOT_FOUND_AUTHOR', ERROR_MESSAGES.NOT_FOUND_AUTHOR);
  }
  const fullText = userName.textContent ?? '';
  const anchors = Array.from(userName.querySelectorAll('a'));
  const handleAnchor = anchors.find((a) => (a.textContent ?? '').trim().startsWith('@'));
  const nameAnchor = anchors.find((a) => {
    const t = (a.textContent ?? '').trim();
    return t.length > 0 && !t.startsWith('@') && !a.querySelector('time');
  });
  const handle = handleAnchor
    ? (handleAnchor.textContent ?? '').trim().slice(1)
    : (fullText.match(/@([A-Za-z0-9_]+)/)?.[1] ?? '');
  const name = nameAnchor
    ? (nameAnchor.textContent ?? '').trim()
    : (fullText.split('@')[0] ?? '').trim();

  if (!name && !handle) {
    throw new ExtractionError('NOT_FOUND_AUTHOR', ERROR_MESSAGES.NOT_FOUND_AUTHOR);
  }
  return { name: name || handle, handle: handle || undefined };
}

function extractPublished(article: Element, tweetId: string): string {
  // 优先取指向当前 tweetId 的链接内时间（避免误取引用推文的时间）
  const statusTime = article.querySelector(`a[href*="/status/${tweetId}"] ${X_SELECTORS.time}`);
  const timeEl = statusTime ?? article.querySelector(X_SELECTORS.time);
  // 缺时间时返回 ''（结构变化/受限状态不阻断保存），与 zhihu/heybox 对齐
  return timeEl?.getAttribute('datetime') ?? '';
}

function extractContent(article: Element, baseUrl: string): BlockNode[] {
  const textEl = article.querySelector(X_SELECTORS.tweetText);
  if (!textEl) {
    throw new ExtractionError('NOT_FOUND_BODY', ERROR_MESSAGES.NOT_FOUND_BODY);
  }
  const ctx = createDomToAstContext(baseUrl);
  const inline = elementToInline(textEl, ctx);
  return inline.length ? [{ type: 'paragraph', children: inline }] : [];
}

function extractMedia(article: Element): ImageNode[] {
  const media: ImageNode[] = [];
  for (const photo of Array.from(article.querySelectorAll(X_SELECTORS.tweetPhoto))) {
    const img = photo.querySelector('img');
    const url = canonicalImageUrl(img?.getAttribute('src') ?? '');
    if (!url) continue;
    media.push({ type: 'image', url, alt: img?.getAttribute('alt') ?? undefined });
  }
  return media;
}

/** 规范化图片 URL：pbs.twimg.com 统一加 &name=large；非 twimg 直出 */
export function canonicalImageUrl(raw: string): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return null;
    // 统一为 large：无 name 或当前为 small 时升级；已有 large/orig/medium 等保持
    if (u.hostname.includes('twimg.com')) {
      const name = u.searchParams.get('name');
      if (!name || name === 'small') u.searchParams.set('name', 'large');
    }
    return u.href;
  } catch {
    return null;
  }
}

/** 引用推文（V0.1 尽力而为，失败返回 undefined 而非阻断主流程） */
function extractQuotedTweet(article: Element, baseUrl: string): TweetNode | undefined {
  let quoteEl: Element | null = null;
  for (const sel of X_SELECTORS.quoteSelectors) {
    quoteEl = article.querySelector(sel);
    if (quoteEl) break;
  }
  if (!quoteEl) return undefined;

  try {
    const author = extractAuthor(quoteEl);
    const published = quoteEl.querySelector(X_SELECTORS.time)?.getAttribute('datetime') ?? '';
    const idLink = quoteEl.querySelector(X_SELECTORS.statusLink);
    const id = STATUS_ID_RE.exec(idLink?.getAttribute('href') ?? '')?.[1] ?? '';
    const textEl = quoteEl.querySelector(X_SELECTORS.tweetText);
    const ctx = createDomToAstContext(baseUrl);
    const inline = textEl ? elementToInline(textEl, ctx) : [];
    const content: BlockNode[] = inline.length ? [{ type: 'paragraph', children: inline }] : [];
    const media = extractMedia(quoteEl);
    return { type: 'tweet', author, published, id, content, media };
  } catch {
    return undefined;
  }
}

/** 克隆并移除互动/装饰节点（不改动真实 DOM） */
function cleanClone(article: Element): Element {
  const clone = article.cloneNode(true) as Element;
  for (const sel of X_SELECTORS.removeSelectors) {
    for (const el of Array.from(clone.querySelectorAll(sel))) el.remove();
  }
  return clone;
}

/** 从克隆中移除引用容器，确保正文/媒体只取自当前推文 */
function removeQuoteContainers(article: Element): void {
  for (const sel of X_SELECTORS.quoteSelectors) {
    for (const el of Array.from(article.querySelectorAll(sel))) el.remove();
  }
}

function isLoginWall(doc: Document): boolean {
  return !!doc.querySelector(X_SELECTORS.loginIndicators);
}

/** 轻量标题探测：焦点推文正文前 50 字符 */
export function detectXTitle(url: URL, doc: Document): string | undefined {
  const tweetId = STATUS_ID_RE.exec(url.pathname)?.[1];
  const article = tweetId ? findFocusedArticle(doc, tweetId) : null;
  const text = article?.querySelector(X_SELECTORS.tweetText)?.textContent?.trim();
  if (!text) return undefined;
  return Array.from(text).slice(0, 50).join('');
}
