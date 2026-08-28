/** Shared DOM source-block collection and deterministic navigation helpers. */

import { normalizeBlockText, sourceBlockId, splitLongBlockText } from '../analysis/source-blocks';
import type { AnalysisSourceBlock } from '../analysis/types';
import type { VisualNavigationErrorCode, VisualSourceAnchor } from '../types/visual-source';

export interface DomSourceEntry {
  block: AnalysisSourceBlock;
  element: Element;
}

export const DEFAULT_SOURCE_CANDIDATE_SELECTOR =
  'h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,table,[data-block="true"]';

const DEFAULT_MEDIA_REMOVE_SELECTOR = 'img,svg,video,source,audio,[role="group"]';

export interface DomSourceCollectionOptions {
  candidateSelector?: string;
  removeSelector?: string;
  includeRootText?: boolean;
}

function candidateKind(el: Element): AnalysisSourceBlock['kind'] {
  const tag = el.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'li') return 'list-item';
  if (tag === 'blockquote') return 'quote';
  if (tag === 'pre') return 'code';
  if (tag === 'table') return 'table';
  return 'paragraph';
}

function textOf(el: Element, removeSelector: string): string {
  const clone = el.cloneNode(true) as Element;
  for (const child of Array.from(clone.querySelectorAll(removeSelector))) child.remove();
  return normalizeBlockText(clone.textContent ?? '');
}

function deepestCandidates(root: Element, selector: string): Element[] {
  return Array.from(root.querySelectorAll(selector)).filter((el) => !el.querySelector(selector));
}

/** Collect deepest semantic descendants and assign stable Bxxx IDs in DOM order. */
export function collectDomSourceBlocksWithElements(
  root: Element,
  options: DomSourceCollectionOptions = {},
): DomSourceEntry[] {
  const candidateSelector = options.candidateSelector ?? DEFAULT_SOURCE_CANDIDATE_SELECTOR;
  const removeSelector = options.removeSelector ?? DEFAULT_MEDIA_REMOVE_SELECTOR;
  const candidates = deepestCandidates(root, candidateSelector);
  if (candidates.length === 0 && options.includeRootText) candidates.push(root);

  const entries: DomSourceEntry[] = [];
  let index = 0;
  for (const element of candidates) {
    const text = textOf(element, removeSelector);
    if (!text) continue;
    for (const chunk of splitLongBlockText(text)) {
      entries.push({
        block: { id: sourceBlockId(index++), kind: candidateKind(element), text: chunk },
        element,
      });
    }
  }
  return entries;
}

export function collectDomSourceBlocks(root: Element, options?: DomSourceCollectionOptions): AnalysisSourceBlock[] {
  return collectDomSourceBlocksWithElements(root, options).map((entry) => entry.block);
}

function navigationError(code: VisualNavigationErrorCode, message: string) {
  return { success: false as const, error: { code, message } };
}

function clearHighlight(): void {
  document.querySelectorAll('.clip2md-source-highlight').forEach((el) => el.classList.remove('clip2md-source-highlight'));
  document.getElementById('clip2md-source-highlight-style')?.remove();
}

function highlight(element: Element): void {
  clearHighlight();
  const style = document.createElement('style');
  style.id = 'clip2md-source-highlight-style';
  style.textContent = '.clip2md-source-highlight { background: rgba(255, 205, 64, .34); outline: 2px solid rgba(202, 142, 0, .65); outline-offset: 3px; }';
  document.head.appendChild(style);
  element.classList.add('clip2md-source-highlight');
  window.setTimeout(() => {
    element.classList.remove('clip2md-source-highlight');
    style.remove();
  }, 1800);
}

function scrollTo(element: Element): void {
  const target = element as HTMLElement;
  if (typeof target.scrollIntoView === 'function') target.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/** Navigate to a source entry after the adapter has verified page identity. */
export function navigateDomSource(
  anchor: VisualSourceAnchor,
  entries: DomSourceEntry[],
): ReturnType<typeof navigationError> | { success: true } {
  const quote = normalizeBlockText(anchor.sourceQuote);
  const byId = entries.filter((entry) => entry.block.id === anchor.sourceBlockId);
  const idMatches = byId.filter((entry) => entry.block.text.includes(quote));
  const matches = idMatches.length === 1 ? idMatches : entries.filter((entry) => entry.block.text.includes(quote));
  if (matches.length === 0) return navigationError('TARGET_NOT_FOUND', '当前页面找不到对应的原文段落。');
  if (matches.length > 1) return navigationError('AMBIGUOUS_TARGET', '原文片段对应多个位置，已停止跳转以避免误定位。');
  const target = matches[0]!.element;
  scrollTo(target);
  highlight(target);
  return { success: true };
}
