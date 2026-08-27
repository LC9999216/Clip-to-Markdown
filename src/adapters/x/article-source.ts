/**
 * X Article DOM Source Block 收集器。
 * 从真实 DOM 生成 AnalysisSourceBlock[]，供视觉速览分析与原文导航共用。
 * 不修改 ContentDocument、不写网页属性、不持久修改 DOM。
 *
 * 规则（计划 §一.3）：
 * 1. 复用 findArticleContainer() + findArticleBody() 共享正文容器。
 * 2. 搜索范围仅限焦点 Article 的 [data-contents="true"]。
 * 3. 候选为 h1-h6、p、li、blockquote、pre、table、[data-block="true"]。
 * 4. 候选互相嵌套时保留最深、最具体的文本元素。
 * 5. 文本 NFKC、NBSP→空格、零宽字符删除、空白合并、trim。
 * 6. 空文本、纯装饰文本、图片与合成媒体替代文案不生成 Block。
 * 7. >2000 字符时在句末边界分段，无边界时在 2000 处硬切。
 * 8. 按 DOM 序分配 B001～Bxxx。
 * 9. 不写入 ContentDocument、不写入 DOM 属性。
 */

import { findArticleContainer, findArticleBody } from './extractor';
import { normalizeBlockText, sourceBlockId, splitLongBlockText } from '../../analysis/source-blocks';
import type { AnalysisSourceBlock } from '../../analysis/types';

export const BLOCK_CANDIDATE_SELECTOR =
  'h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,table,[data-block="true"]';

/** 移除媒体与装饰元素的选择器（提取文本时排除） */
const MEDIA_REMOVE_SELECTOR = 'img, svg, video, source, audio, [role="group"]';

/**
 * 共享正文容器：焦点长文章的 [data-contents="true"]。
 * 提取器与导航器共用同一解析路径，不允许各自猜正文根节点。
 */
export function findArticleBodyContainer(doc: Document): Element | null {
  const article = findArticleContainer(doc);
  if (!article) return null;
  return findArticleBody(article);
}

/** 候选元素 → 语义种类 */
function candidateKind(el: Element): AnalysisSourceBlock['kind'] {
  const tag = el.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'p') return 'paragraph';
  if (tag === 'li') return 'list-item';
  if (tag === 'blockquote') return 'quote';
  if (tag === 'pre') return 'code';
  if (tag === 'table') return 'table';
  // [data-block] 兜底：按内部标签推断
  if (el.hasAttribute('data-block')) {
    if (el.querySelector('h1,h2,h3,h4,h5,h6')) return 'heading';
    if (el.querySelector('blockquote')) return 'quote';
    if (el.querySelector('pre')) return 'code';
    if (el.querySelector('table')) return 'table';
    if (el.querySelector('ul,ol,li')) return 'list-item';
    return 'paragraph';
  }
  return 'paragraph';
}

/** 提取候选元素的纯文本（排除媒体与装饰节点后取 textContent 并归一化） */
function candidateText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  for (const n of Array.from(clone.querySelectorAll(MEDIA_REMOVE_SELECTOR))) {
    n.remove();
  }
  return normalizeBlockText(clone.textContent ?? '');
}

/**
 * 筛选最深层候选（排除嵌套在另一候选内的元素）。
 * 例如 <blockquote><p>text</p></blockquote> → 保留 p，丢弃 blockquote。
 */
function deepestCandidates(container: Element): Element[] {
  const all = Array.from(container.querySelectorAll(BLOCK_CANDIDATE_SELECTOR));
  return all.filter((el) => {
    // 检查是否有候选子元素（有则说明 el 是外层容器，应排除）
    return !el.querySelector(BLOCK_CANDIDATE_SELECTOR);
  });
}

export interface SourceBlockWithElement {
  block: AnalysisSourceBlock;
  element: Element;
}

/**
 * 收集 Source Block（含 DOM 元素引用，供导航重用）。
 * 分析与导航共用此函数，保证 ID 稳定、算法一致。
 */
export function collectArticleSourceBlocksWithElements(doc: Document): SourceBlockWithElement[] {
  const container = findArticleBodyContainer(doc);
  if (!container) return [];

  const result: SourceBlockWithElement[] = [];
  let idIndex = 0;

  for (const el of deepestCandidates(container)) {
    const raw = candidateText(el);
    if (!raw) continue; // 空文本 / 纯装饰 / 纯媒体

    const kind = candidateKind(el);
    const chunks = splitLongBlockText(raw);

    for (const text of chunks) {
      result.push({
        block: { id: sourceBlockId(idIndex++), kind, text },
        element: el,
      });
    }
  }

  return result;
}

/** 收集 Source Block（纯数据，不含 DOM 引用）。 */
export function collectArticleSourceBlocks(doc: Document): AnalysisSourceBlock[] {
  return collectArticleSourceBlocksWithElements(doc).map((e) => e.block);
}