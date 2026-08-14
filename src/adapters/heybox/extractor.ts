/**
 * 小黑盒提取器：通用文章提取器。
 * 结构全部来自 selectors.ts 的可配置对象，不硬编码 class 名。
 */

import { createDomToAstContext, elementToBlocks } from '../../core/dom-to-ast';
import { ExtractionError, ERROR_MESSAGES } from '../../core/error';
import { CONTENT_PATH_BLOCKLIST, HEYBOX_SELECTORS } from './selectors';
import type { AuthorInfo, BlockNode, ContentDocument, PlatformContentType } from '../../core/schema';

export function detectHeyboxType(url: URL): PlatformContentType | null {
  if (url.hostname !== 'www.xiaoheihe.cn' && url.hostname !== 'xiaoheihe.cn') return null;
  const path = url.pathname;
  if (path === '/' || path === '') return null;
  if (CONTENT_PATH_BLOCKLIST.some((re) => re.test(path))) return null;
  return 'heybox-post';
}

export function extractHeybox(doc: Document, url: URL): ContentDocument {
  const type = detectHeyboxType(url);
  if (!type) throw new ExtractionError('UNSUPPORTED_PAGE', ERROR_MESSAGES.UNSUPPORTED_PAGE);
  if (isLoginWall(doc)) {
    throw new ExtractionError('LOGIN_REQUIRED', ERROR_MESSAGES.LOGIN_REQUIRED);
  }

  const item = findFirst(doc, HEYBOX_SELECTORS.item);
  if (!item) {
    throw new ExtractionError(
      'NOT_FOUND_BODY',
      '未找到小黑盒正文容器。可能是页面结构已变化或需要登录，请报告 issue。',
    );
  }

  const title = textOf(firstIn(item, HEYBOX_SELECTORS.title)) ?? undefined;
  const author = extractAuthor(doc, item);
  const published = extractPublished(item);
  const content = extractBody(item, url.href);

  return {
    version: 1,
    metadata: {
      platform: 'heybox',
      contentType: 'heybox-post',
      sourceUrl: url.href,
      author,
      published,
      title,
      id: extractPostId(url),
    },
    body: { type: 'article', children: content },
  };
}

// ---------- 通用提取 ----------

function extractAuthor(doc: Document, item: Element): AuthorInfo {
  const el = firstIn(item, HEYBOX_SELECTORS.author);
  const link = el?.querySelector('a');
  const name = (link?.textContent ?? el?.textContent ?? '').trim();
  if (name) return { name };
  // meta 兜底
  const meta = doc.querySelector('meta[name="author"]')?.getAttribute('content');
  if (meta?.trim()) return { name: meta.trim() };
  throw new ExtractionError('NOT_FOUND_AUTHOR', ERROR_MESSAGES.NOT_FOUND_AUTHOR);
}

/** 发布时间：仅取 datetime 属性（保持 ISO 8601 约定）；取不到返回 ''（不阻断） */
function extractPublished(item: Element): string {
  const el = firstIn(item, HEYBOX_SELECTORS.time);
  return el?.getAttribute('datetime') ?? '';
}

function extractBody(item: Element, baseUrl: string): BlockNode[] {
  const clone = item.cloneNode(true) as Element;
  for (const sel of HEYBOX_SELECTORS.remove) {
    for (const el of Array.from(clone.querySelectorAll(sel))) el.remove();
  }
  const ctx = createDomToAstContext(baseUrl);
  const content: BlockNode[] = [];

  // 图文帖头部图片轮播（位于文本之前，保持原始阅读顺序）
  for (const sel of HEYBOX_SELECTORS.heroImages) {
    for (const el of Array.from(clone.querySelectorAll(sel))) {
      content.push(...elementToBlocks(el, ctx));
    }
  }

  const bodyEl = firstIn(clone, HEYBOX_SELECTORS.body);
  if (bodyEl) {
    content.push(...elementToBlocks(bodyEl, ctx));
  } else if (content.length === 0) {
    // 兜底：没有明确正文容器时用整个 item
    content.push(...elementToBlocks(clone, ctx));
  }

  if (content.length === 0) {
    throw new ExtractionError('NOT_FOUND_BODY', ERROR_MESSAGES.NOT_FOUND_BODY);
  }
  return content;
}

function extractPostId(url: URL): string | undefined {
  const queryId =
    url.searchParams.get('post_id') ??
    url.searchParams.get('article_id') ??
    url.searchParams.get('link_id');
  if (queryId) return queryId;
  const last = url.pathname.split('/').filter(Boolean).pop();
  return last && /^\d+$/.test(last) ? last : undefined;
}

function isLoginWall(doc: Document): boolean {
  return HEYBOX_SELECTORS.loginIndicators.some((sel) => doc.querySelector(sel));
}

/** 轻量标题探测 */
export function detectHeyboxTitle(doc: Document): string | undefined {
  const item = findFirst(doc, HEYBOX_SELECTORS.item);
  return textOf(firstIn(item, HEYBOX_SELECTORS.title));
}

// ---------- 工具 ----------

/** 在 root 内按候选选择器返回第一个命中元素 */
function firstIn(root: Element | null, selectors: readonly string[]): Element | null {
  if (!root) return null;
  for (const sel of selectors) {
    const el = root.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function findFirst(root: Document | Element, selectors: readonly string[]): Element | null {
  for (const sel of selectors) {
    const el = root.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function textOf(el: Element | null): string | undefined {
  const t = el?.textContent?.trim();
  return t ? t : undefined;
}
