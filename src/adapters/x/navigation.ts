/**
 * X Article 原文导航：只允许确定性的 ID + Quote 匹配，拒绝歧义跳转。
 * 导航时重新运行 Phase 1 Source Block 收集器，避免分析与导航各自猜正文。
 */

import { collectArticleSourceBlocksWithElements } from './article-source';
import { normalizeBlockText } from '../../analysis/source-blocks';
import {
  isNavigateToSourceRequest,
  type NavigateToSourceRequest,
  type NavigateToSourceResponse,
} from '../../types/messages';

const STATUS_ID_RE = /\/status\/(\d+)(?:\/|$)/;
const SOURCE_HIGHLIGHT_CLASS = 'clip2md-source-highlight';
const SOURCE_HIGHLIGHT_STYLE_ID = 'clip2md-source-highlight-style';
const HIGHLIGHT_DURATION_MS = 1_800;

let activeHighlight: { element: Element; timer: number } | undefined;

function error(
  code: Exclude<NavigateToSourceResponse, { success: true }>['error']['code'],
  message: string,
): NavigateToSourceResponse {
  return { success: false, error: { code, message } };
}

function sourceStatusId(value: string): string | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'x.com' && host !== 'twitter.com') return null;
    return STATUS_ID_RE.exec(url.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

function clearActiveHighlight(): void {
  if (!activeHighlight) return;
  activeHighlight.element.classList.remove(SOURCE_HIGHLIGHT_CLASS);
  window.clearTimeout(activeHighlight.timer);
  document.getElementById(SOURCE_HIGHLIGHT_STYLE_ID)?.remove();
  activeHighlight = undefined;
}

function highlight(element: Element): void {
  clearActiveHighlight();
  const style = document.createElement('style');
  style.id = SOURCE_HIGHLIGHT_STYLE_ID;
  style.textContent = `.${SOURCE_HIGHLIGHT_CLASS} { background: rgba(255, 205, 64, 0.34); outline: 2px solid rgba(202, 142, 0, 0.65); outline-offset: 3px; }`;
  document.head.appendChild(style);
  element.classList.add(SOURCE_HIGHLIGHT_CLASS);
  const timer = window.setTimeout(() => {
    element.classList.remove(SOURCE_HIGHLIGHT_CLASS);
    style.remove();
    activeHighlight = undefined;
  }, HIGHLIGHT_DURATION_MS);
  activeHighlight = { element, timer };
}

function scrollTo(element: Element): void {
  const reducedMotion = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const target = element as HTMLElement;
  if (typeof target.scrollIntoView === 'function') {
    target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
  }
}

/** 执行一次 X Article 原文导航。 */
export function navigateToSource(payload: NavigateToSourceRequest['payload']): NavigateToSourceResponse {
  if (!isNavigateToSourceRequest({ type: 'NAVIGATE_TO_SOURCE', payload })) {
    return error('INVALID_REQUEST', '原文导航请求无效。');
  }

  const expectedId = sourceStatusId(payload.expectedSourceUrl);
  const currentId = sourceStatusId(window.location.href);
  if (!currentId) return error('UNSUPPORTED_PAGE', '当前页面不是可定位的 X 内容页。');
  if (!expectedId || currentId !== expectedId) {
    return error('SOURCE_CHANGED', '当前页面内容已变化，请重新生成一图速览。');
  }

  const quote = normalizeBlockText(payload.sourceQuote);
  const entries = collectArticleSourceBlocksWithElements(document);
  const byId = entries.filter((entry) => entry.block.id === payload.sourceBlockId);
  const idMatches = byId.filter((entry) => entry.block.text.includes(quote));
  const matches = idMatches.length === 1
    ? idMatches
    : entries.filter((entry) => entry.block.text.includes(quote));

  if (matches.length === 0) return error('TARGET_NOT_FOUND', '当前页面找不到对应的原文段落。');
  if (matches.length > 1) return error('AMBIGUOUS_TARGET', '原文片段对应多个位置，已停止跳转以避免误定位。');

  const target = matches[0]!.element;
  scrollTo(target);
  highlight(target);
  return { success: true };
}
