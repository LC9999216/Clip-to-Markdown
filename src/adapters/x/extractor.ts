/**
 * X / Twitter 推文提取器。
 * 只取当前这一条推文：按 URL 中的 tweetId 定位 article，排除回复/推广/互动按钮。
 */

import {
  createDomToAstContext,
  elementToBlocks,
  elementToInline,
  type DomToAstContext,
} from '../../core/dom-to-ast';
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

/** 规范化图片 URL：pbs.twimg.com 媒体图统一加 &name=large；非 twimg 直出 */
export function canonicalImageUrl(raw: string): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return null;
    // 仅对 pbs.twimg.com 媒体图统一为 large：无 name 或当前为 small 时升级；已有 large/orig/medium 等保持。
    // 不碰 video.twimg.com / abs.twimg.com 等其他主机（视频、图标不适用 name=large）。
    if (u.hostname === 'pbs.twimg.com') {
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

// ============================================================
// X 长文章（X Articles）
// ============================================================

/**
 * 页面是否渲染了 X 长文章。
 * 长文章标记优先于 URL 判断：同一 /status/{id} URL 根据真实 DOM 区分普通推文与长文章，
 * 兼容 X 的 SPA 页面切换（每次保存时重新判断）。
 */
export function isXArticlePage(doc: Document): boolean {
  return !!(
    doc.querySelector(X_SELECTORS.articleTitle) ||
    doc.querySelector(X_SELECTORS.articleRichView) ||
    doc.querySelector(X_SELECTORS.articleLongform)
  );
}

export function extractXArticle(doc: Document, url: URL): ContentDocument {
  const statusId = STATUS_ID_RE.exec(url.pathname)?.[1];
  if (!statusId) {
    throw new ExtractionError('UNSUPPORTED_PAGE', ERROR_MESSAGES.UNSUPPORTED_PAGE);
  }
  // 登录墙优先于缺正文
  if (isLoginWall(doc)) {
    throw new ExtractionError('LOGIN_REQUIRED', ERROR_MESSAGES.LOGIN_REQUIRED);
  }

  const article = findArticleContainer(doc);
  if (!article) {
    throw new ExtractionError('NOT_FOUND_BODY', ERROR_MESSAGES.NOT_FOUND_BODY);
  }

  const author = extractAuthor(article);
  const published = extractPublished(article, statusId);
  const title = extractArticleTitle(article);

  const ctx = createXArticleContext(url.href);
  // 在克隆上清洗与替换，绝不动真实 DOM
  const clone = cleanClone(article);
  const bodyEl = findArticleBody(clone);
  if (!bodyEl) {
    throw new ExtractionError('NOT_FOUND_BODY', ERROR_MESSAGES.NOT_FOUND_BODY);
  }
  // 标题若同时出现在正文容器内，移除避免与 metadata.title 重复
  bodyEl.querySelector(X_SELECTORS.articleTitle)?.remove();
  // 嵌入内容替换为可转换结构
  replaceEmbeddedTweets(bodyEl, ctx);
  replaceArticleCards(bodyEl, ctx);
  replaceVideos(bodyEl, ctx);
  // 剔除头像/emoji/hashflag/SVG/装饰图片
  removeNonContentImages(bodyEl, ctx);

  const blocks = elementToBlocks(bodyEl, ctx);
  if (blocks.length === 0) {
    throw new ExtractionError('NOT_FOUND_BODY', ERROR_MESSAGES.NOT_FOUND_BODY);
  }

  // 封面图作为正文首个图片节点输出；重复图片按规范化 URL 保留第一次出现的位置
  const cover = extractArticleCover(article, ctx);
  const body = dedupeImages(cover ? [cover, ...blocks] : blocks);

  const canonicalUrl = `https://x.com/${author.handle ?? 'user'}/status/${statusId}`;
  return {
    version: 1,
    metadata: {
      platform: 'x',
      contentType: 'x-article',
      sourceUrl: canonicalUrl,
      author,
      published,
      title: title || undefined,
      id: statusId,
    },
    body: { type: 'article', children: body },
  };
}

/**
 * 找到同时包含富文本正文与作者信息的外层 article。
 * 文档序首个候选即最外层：嵌套的重复文章容器（内嵌推文等）不会造成正文重复。
 */
export function findArticleContainer(doc: Document): Element | null {
  const candidates = Array.from(doc.querySelectorAll(X_SELECTORS.article)).filter((a) => !isPromoted(a));
  const withBody = candidates.filter(
    (a) =>
      a.querySelector(X_SELECTORS.articleRichView) ||
      a.querySelector(X_SELECTORS.articleLongform) ||
      a.querySelector(X_SELECTORS.articleContents),
  );
  for (const a of withBody) {
    if (a.querySelector(X_SELECTORS.userName)) return a;
  }
  return withBody[0] ?? null;
}

/**
 * 正文容器：严格路径 twitterArticleRichTextView → longformRichTextComponent → [data-contents]。
 * 中间层级缺环时兜底在 article 内直接找 [data-contents]，结构变动只改 selectors。
 * 导出供 article-source（Source Block 收集）共享，避免提取器与导航器各自猜正文根。
 */
export function findArticleBody(article: Element): Element | null {
  const rich = article.querySelector(X_SELECTORS.articleRichView);
  const longform = rich
    ? rich.querySelector(X_SELECTORS.articleLongform)
    : article.querySelector(X_SELECTORS.articleLongform);
  const contents = longform?.querySelector(X_SELECTORS.articleContents);
  return contents ?? article.querySelector(X_SELECTORS.articleContents);
}

/** 长文章正式标题（在 metadata.title），取不到返回 '' */
function extractArticleTitle(article: Element): string {
  return article.querySelector(X_SELECTORS.articleTitle)?.textContent?.trim() ?? '';
}

/** 封面图：twitterArticleCover 内首个图片；无封面返回 null */
function extractArticleCover(article: Element, ctx: DomToAstContext): ImageNode | null {
  const img = article.querySelector(`${X_SELECTORS.articleCover} img`);
  if (!img) return null;
  const url = imageUrl(img, ctx);
  if (!url) return null;
  return { type: 'image', url, alt: img.getAttribute('alt') ?? undefined };
}

/** X 长文章专用转换上下文：pbs.twimg.com 媒体图统一 name=large */
function createXArticleContext(baseUrl: string): DomToAstContext {
  const base = createDomToAstContext(baseUrl);
  return {
    resolveUrl(raw: string): string | null {
      const abs = base.resolveUrl(raw);
      return abs ? (canonicalImageUrl(abs) ?? abs) : null;
    },
  };
}

/** 读取图片的有效 src（处理懒加载）并绝对化 */
function imageUrl(img: Element, ctx: DomToAstContext): string | null {
  for (const attr of ['data-original', 'data-actualsrc', 'data-src', 'src'] as const) {
    const raw = img.getAttribute(attr);
    if (raw) {
      const abs = ctx.resolveUrl(raw);
      if (abs) return abs;
    }
  }
  return null;
}

/** 纯 emoji 的 alt（X 把 emoji 渲染为 img 时的 alt） */
const EMOJI_ONLY_RE = /^[\p{Extended_Pictographic}\uFE0F\u200D]+$/u;

/**
 * 是否是可输出的正文图片：
 * - 排除头像（User-Name 内 / alt 以 @ 开头）
 * - 排除 emoji（alt 为纯 emoji）与 hashflag（alt 以 # 开头或路径含 hashflag）
 * - 排除 SVG 与无法解析为 https 的 URL
 * - 非 twimg 的装饰图（无 alt）丢弃；pbs.twimg.com 媒体图一律保留（封面/正文照片）
 */
function isContentImage(img: Element, ctx: DomToAstContext): boolean {
  if (img.closest(X_SELECTORS.userName)) return false;
  const alt = (img.getAttribute('alt') ?? '').trim();
  if (alt && (EMOJI_ONLY_RE.test(alt) || alt.startsWith('@') || alt.startsWith('#'))) return false;
  const url = imageUrl(img, ctx);
  if (!url) return false;
  if (/\/emoji\/|\/hashflag\//i.test(url) || /\.svg(\?|#|$)/i.test(url)) return false;
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  if (host === 'pbs.twimg.com') return true;
  return alt.length > 0;
}

/** 剔除正文中的装饰图片（在克隆上操作） */
function removeNonContentImages(container: Element, ctx: DomToAstContext): void {
  for (const img of Array.from(container.querySelectorAll('img'))) {
    if (!isContentImage(img, ctx)) img.remove();
  }
}

// ---------- 嵌入内容 ----------

/** 内嵌推文 → blockquote（作者 + 正文 + 图片 + 原文链接），复用现有 BlockquoteNode */
function replaceEmbeddedTweets(root: Element, ctx: DomToAstContext): void {
  for (const embed of Array.from(root.querySelectorAll(X_SELECTORS.articleInlineTweet))) {
    const bq = buildEmbeddedTweetBlockquote(embed, ctx);
    if (bq) embed.replaceWith(bq);
    else embed.remove();
  }
}

function buildEmbeddedTweetBlockquote(embed: Element, ctx: DomToAstContext): Element | null {
  const doc = embed.ownerDocument;
  const tweetEl = embed.querySelector(X_SELECTORS.article) ?? embed;
  const bq = doc.createElement('blockquote');

  try {
    const author = extractAuthor(tweetEl);
    const nameP = doc.createElement('p');
    const strong = doc.createElement('strong');
    strong.textContent = `${author.name}${author.handle ? ` (@${author.handle})` : ''}`;
    nameP.appendChild(strong);
    bq.appendChild(nameP);
  } catch {
    // 作者结构缺失时跳过作者行，不阻断嵌入推文
  }

  const textEl = tweetEl.querySelector(X_SELECTORS.tweetText);
  if (textEl) {
    const p = doc.createElement('p');
    p.appendChild(textEl.cloneNode(true));
    bq.appendChild(p);
  }

  for (const img of extractMedia(tweetEl)) {
    const fig = doc.createElement('figure');
    const el = doc.createElement('img');
    el.setAttribute('src', img.url);
    if (img.alt) el.setAttribute('alt', img.alt);
    fig.appendChild(el);
    bq.appendChild(fig);
  }

  const linkEl = tweetEl.querySelector(X_SELECTORS.statusLink);
  const linkUrl = linkEl ? ctx.resolveUrl(linkEl.getAttribute('href') ?? '') : null;
  if (linkUrl) {
    const p = doc.createElement('p');
    const a = doc.createElement('a');
    a.setAttribute('href', linkUrl);
    a.textContent = '查看原文';
    p.appendChild(a);
    bq.appendChild(p);
  }

  return bq.children.length ? bq : null;
}

/** 文章卡片 → 封面图 + 标题链接 + 描述（不新增专用 AST） */
function replaceArticleCards(root: Element, ctx: DomToAstContext): void {
  for (const card of Array.from(root.querySelectorAll(X_SELECTORS.articleCard))) {
    const replacement = buildArticleCardBlocks(card, ctx);
    if (replacement.length === 0) {
      card.remove();
      continue;
    }
    const frag = card.ownerDocument.createDocumentFragment();
    for (const el of replacement) frag.appendChild(el);
    card.replaceWith(frag);
  }
}

function buildArticleCardBlocks(card: Element, ctx: DomToAstContext): Element[] {
  const doc = card.ownerDocument;
  const out: Element[] = [];

  const imgEl = card.querySelector('img');
  const imgUrl = imgEl ? imageUrl(imgEl, ctx) : null;
  if (imgUrl) {
    const fig = doc.createElement('figure');
    const img = doc.createElement('img');
    img.setAttribute('src', imgUrl);
    const alt = imgEl?.getAttribute('alt');
    if (alt) img.setAttribute('alt', alt);
    fig.appendChild(img);
    out.push(fig);
  }

  const linkEl = card.querySelector('a[href]');
  const linkUrl = linkEl ? ctx.resolveUrl(linkEl.getAttribute('href') ?? '') : null;
  const title = cardText(card, X_SELECTORS.articleCardTitle);
  if (linkUrl && title) {
    const p = doc.createElement('p');
    const a = doc.createElement('a');
    a.setAttribute('href', linkUrl);
    a.textContent = title;
    p.appendChild(a);
    out.push(p);
  }

  const desc = cardText(card, X_SELECTORS.articleCardDesc);
  if (desc) {
    const p = doc.createElement('p');
    p.textContent = desc;
    out.push(p);
  }

  return out;
}

/** 卡片文本：优先按选择器读取，兜底取链接内非图片子容器的文本（标题/描述依调用顺序） */
function cardText(card: Element, selector: string): string | undefined {
  const bySel = card.querySelector(selector);
  const text = bySel?.textContent?.trim();
  if (text) return text;
  const link = card.querySelector('a[href]') ?? card;
  for (const el of Array.from(link.children)) {
    if (el.querySelector('img')) continue;
    const t = el.textContent?.trim();
    if (t) return t;
  }
  return undefined;
}

/** 视频 → 海报图降级 + 来源链接（不下载视频本体） */
function replaceVideos(root: Element, ctx: DomToAstContext): void {
  for (const video of Array.from(root.querySelectorAll(X_SELECTORS.articleVideo))) {
    const doc = video.ownerDocument;
    const replacement: Element[] = [];

    const posterEl = video.querySelector('video[poster]');
    const posterUrl = posterEl ? ctx.resolveUrl(posterEl.getAttribute('poster') ?? '') : null;
    if (posterUrl) {
      const fig = doc.createElement('figure');
      const img = doc.createElement('img');
      img.setAttribute('src', posterUrl);
      img.setAttribute('alt', '视频海报');
      fig.appendChild(img);
      replacement.push(fig);
    }

    const sourceEl = video.querySelector('video source[src], video[src]');
    const sourceUrl = sourceEl ? ctx.resolveUrl(sourceEl.getAttribute('src') ?? '') : null;
    if (sourceUrl) {
      const p = doc.createElement('p');
      const a = doc.createElement('a');
      a.setAttribute('href', sourceUrl);
      a.textContent = '查看视频';
      p.appendChild(a);
      replacement.push(p);
    }

    if (replacement.length === 0) {
      video.remove();
      continue;
    }
    const frag = doc.createDocumentFragment();
    for (const el of replacement) frag.appendChild(el);
    video.replaceWith(frag);
  }
}

/** 按规范化 URL 去重顶层图片块：保留第一次出现的位置 */
function dedupeImages(blocks: BlockNode[]): BlockNode[] {
  const seen = new Set<string>();
  const out: BlockNode[] = [];
  for (const block of blocks) {
    if (block.type === 'image') {
      if (seen.has(block.url)) continue;
      seen.add(block.url);
    }
    out.push(block);
  }
  return out;
}

/** 轻量标题探测：长文章读取正式标题 */
export function detectXArticleTitle(doc: Document): string | undefined {
  const text = doc.querySelector(X_SELECTORS.articleTitle)?.textContent?.trim();
  return text || undefined;
}
