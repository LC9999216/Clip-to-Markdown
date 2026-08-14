/**
 * 通用 DOM → ContentDocument AST 转换器。
 *
 * 职责边界（三平台共用）：
 * - adapter 负责定位"正文容器"并剔除评论/推荐/广告节点；
 * - 本模块负责把"正文容器内的元素"映射为 AST 类型。
 *
 * 本模块不做语义过滤——它假定传入的根节点已经是干净的正文。
 */

import type {
  BlockNode,
  BreakNode,
  HeadingNode,
  InlineCodeNode,
  InlineNode,
  LinkNode,
  ListNode,
  ParagraphNode,
  StrongNode,
  TableNode,
  TableRowNode,
  TextNode,
} from './schema';

export interface DomToAstContext {
  /**
   * 把页面上的相对/不完整 URL 绝对化并过滤危险协议。
   * 返回 null 表示该 URL 应被丢弃（如 javascript: 链接）。
   */
  resolveUrl(raw: string): string | null;
}

/** 创建基于当前页面 URL 的转换上下文 */
export function createDomToAstContext(baseUrl: string): DomToAstContext {
  return {
    resolveUrl(raw: string): string | null {
      if (!raw) return null;
      let u: URL;
      try {
        u = new URL(raw, baseUrl);
      } catch {
        return null;
      }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return u.href;
    },
  };
}

// 懒加载属性优先于 src：知乎/小黑盒未滚动到时 src 常为占位图，真实地址在 data-* 上
const LAZY_SRC_ATTRS = ['data-original', 'data-actualsrc', 'data-src', 'src'] as const;

/** 读取图片的有效 src（处理懒加载）并绝对化 */
function imgUrl(img: Element, ctx: DomToAstContext): string | null {
  for (const attr of LAZY_SRC_ATTRS) {
    const raw = img.getAttribute(attr);
    if (raw) {
      const abs = ctx.resolveUrl(raw);
      if (abs) return abs;
    }
  }
  return null;
}

/** 代码块语言：从 <code> 的 class 提取 language-* */
function codeLang(el: Element): string | undefined {
  const cls = el.className;
  if (typeof cls !== 'string') return undefined;
  for (const part of cls.split(/\s+/)) {
    if (part.startsWith('language-')) return part.slice('language-'.length);
  }
  return undefined;
}

/** 折叠多个连续空白为单个空格（保留 \n 转成 break 的逻辑由调用方处理） */
function collapseSpace(s: string): string {
  return s.replace(/[ \t ​]+/g, ' ');
}

// ---------- Block 级转换 ----------

/**
 * 把正文容器内的一批子节点转换为块级 AST。
 * - text 节点 → paragraph
 * - 已知块级元素 → 对应节点类型
 * - 未知但含块级后代的容器（如 .RichText、figure）→ 透明展开其子块
 * - 纯内联的未知容器 → 包成 paragraph
 */
export function elementToBlocks(root: Element, ctx: DomToAstContext): BlockNode[] {
  const blocks: BlockNode[] = [];
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = collapseSpace(node.textContent ?? '').trim();
      if (!value) continue;
      blocks.push(paragraphFromInline([{ type: 'text', value }]));
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as Element;
    if (BLOCK_TAGS.has(el.tagName) && !isImageEmbeddingTextContainer(el)) {
      const block = elementToBlock(el, ctx);
      if (block) blocks.push(block);
    } else if (hasBlockDescendant(el)) {
      blocks.push(...elementToBlocks(el, ctx));
    } else {
      const inline = elementToInline(el, ctx);
      if (inline.length) blocks.push(paragraphFromInline(inline));
    }
  }
  return blocks;
}

/** 段落/div 内嵌块级图片（如 <p>文字<img></p>）：提升为块级 image，避免图片丢失 */
function isImageEmbeddingTextContainer(el: Element): boolean {
  return (el.tagName === 'P' || el.tagName === 'DIV') && !!el.querySelector('img, figure');
}

/** 是否存在块级后代（含自身子元素递归） */
function hasBlockDescendant(el: Element): boolean {
  for (const c of Array.from(el.children)) {
    if (BLOCK_TAGS.has(c.tagName) || hasBlockDescendant(c)) return true;
  }
  return false;
}

function elementToBlock(el: Element, ctx: DomToAstContext): BlockNode | null {
  const tag = el.tagName;
  switch (tag) {
    case 'P':
      return paragraphFromElement(el, ctx);
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6':
      return heading(el, ctx);
    case 'UL':
      return list(el, false, ctx);
    case 'OL':
      return list(el, true, ctx);
    case 'LI':
      return listItem(el, ctx);
    case 'BLOCKQUOTE':
      return blockquote(el, ctx);
    case 'PRE': {
      const codeEl = el.querySelector('code');
      return { type: 'code', lang: codeEl ? codeLang(codeEl) : undefined, value: (el.textContent ?? '').trim() };
    }
    case 'IMG': {
      const url = imgUrl(el, ctx);
      if (!url) return null;
      return { type: 'image', url, alt: el.getAttribute('alt') ?? undefined };
    }
    case 'FIGURE': {
      const img = el.querySelector('img');
      if (!img) return null;
      const url = imgUrl(img, ctx);
      if (!url) return null;
      return { type: 'image', url, alt: img.getAttribute('alt') ?? undefined };
    }
    case 'HR':
      return { type: 'thematicBreak' };
    case 'TABLE':
      return table(el, ctx);
    default: {
      // 兜底（正常情况下由 elementToBlocks 的透明容器逻辑接管）
      const inline = elementToInline(el, ctx);
      return inline.length === 0 ? null : { type: 'paragraph', children: inline };
    }
  }
}

const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'TABLE', 'HR', 'IMG', 'FIGURE']);

function paragraphFromElement(el: Element, ctx: DomToAstContext): ParagraphNode {
  return paragraphFromInline(elementToInline(el, ctx));
}

function paragraphFromInline(children: InlineNode[]): ParagraphNode {
  return { type: 'paragraph', children };
}

function heading(el: Element, ctx: DomToAstContext): HeadingNode {
  const depth = Number(el.tagName[1]) as 1 | 2 | 3 | 4 | 5 | 6;
  return { type: 'heading', depth, children: elementToInline(el, ctx) };
}

function list(el: Element, ordered: boolean, ctx: DomToAstContext): ListNode {
  const items = Array.from(el.children)
    .filter((c) => c.tagName === 'LI')
    .map((li) => listItem(li, ctx))
    .filter((li): li is ListNode['children'][number] => li.children.length > 0);
  return { type: 'list', ordered, children: items };
}

function listItem(el: Element, ctx: DomToAstContext): BlockNode & { type: 'listItem' } {
  const children = elementToBlocks(el, ctx);
  // 纯文本的 <li>：直接包裹为 paragraph，方便渲染
  if (children.length === 0) {
    const inline = elementToInline(el, ctx);
    if (inline.length) return { type: 'listItem', children: [{ type: 'paragraph', children: inline }] };
  }
  return { type: 'listItem', children };
}

function blockquote(el: Element, ctx: DomToAstContext): BlockNode & { type: 'blockquote' } {
  return { type: 'blockquote', children: elementToBlocks(el, ctx) };
}

function table(el: Element, ctx: DomToAstContext): TableNode {
  // 排除嵌套表格内的行，避免嵌套结构被拍平
  const rows = Array.from(el.querySelectorAll('tr')).filter((r) => r.closest('table') === el);
  const headerEl = el.querySelector('thead tr');
  let header: TableNode['header'];
  let bodyRows: TableNode['children'] = [];
  if (headerEl) {
    header = tableRow(headerEl, ctx, true);
  }
  bodyRows = rows
    .filter((r) => r !== headerEl && !headerEl?.contains(r))
    .map((r) => tableRow(r, ctx, false))
    .filter((r): r is TableNode['children'][number] => r.children.length > 0);
  return { type: 'table', header, children: bodyRows };
}

function tableRow(el: Element, ctx: DomToAstContext, isHeader: boolean): TableRowNode {
  const cells = Array.from(el.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH');
  return {
    type: 'tableRow',
    children: cells.map((c) => ({
      type: 'tableCell',
      children: isHeader
        ? [{ type: 'text', value: collapseSpace(c.textContent ?? '').trim() }]
        : elementToInline(c, ctx),
    })),
  };
}

// ---------- Inline 级转换 ----------

/**
 * 递归遍历行内内容。文本按 \n 拆分为 text/break，元素按标签映射。
 * 保留文本与行内元素之间的边界空格（由 normalizeInline 只修剪首尾）。
 */
export function elementToInline(el: Element, ctx: DomToAstContext): InlineNode[] {
  return normalizeInline(buildInline(el, ctx));
}

function buildInline(el: Element, ctx: DomToAstContext): InlineNode[] {
  const out: InlineNode[] = [];
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = collapseSpace(node.textContent ?? '');
      appendTextWithBreaks(out, text);
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const child = node as Element;
    const tag = child.tagName;
    if (tag === 'BR') {
      out.push({ type: 'break' });
    } else if (tag === 'A') {
      const url = ctx.resolveUrl(child.getAttribute('href') ?? '');
      const children = elementToInline(child, ctx);
      if (children.length === 0) continue;
      if (url) {
        out.push(link(url, children));
      } else {
        out.push(...children);
      }
    } else if (tag === 'STRONG' || tag === 'B') {
      const children = elementToInline(child, ctx);
      if (children.length) out.push(strong(children));
    } else if (tag === 'EM' || tag === 'I') {
      const children = elementToInline(child, ctx);
      if (children.length) out.push({ type: 'emphasis', children });
    } else if (tag === 'CODE') {
      const value = collapseSpace(child.textContent ?? '');
      if (value) out.push(inlineCode(value));
    } else if (tag === 'IMG') {
      const url = imgUrl(child, ctx);
      if (url) out.push({ type: 'text', value: child.getAttribute('alt') ?? '' });
    } else if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'IFRAME' || tag === 'SVG') {
      continue;
    } else {
      out.push(...elementToInline(child, ctx));
    }
  }
  return out;
}

function link(url: string, children: InlineNode[]): LinkNode {
  return { type: 'link', url, children };
}

function strong(children: InlineNode[]): StrongNode {
  return { type: 'strong', children };
}

function inlineCode(value: string): InlineCodeNode {
  return { type: 'inlineCode', value };
}

/**
 * 按 \n 拆分文本，插入 break 节点（每个 \n 一个 break）。
 * 纯空白（含 HTML 源码缩进）直接忽略，不产生 break；保留边界空格。
 */
function appendTextWithBreaks(out: InlineNode[], text: string): void {
  if (!/[^\s]/.test(text)) return; // 纯空白（含缩进 \n）
  const parts = text.split('\n');
  parts.forEach((part, i) => {
    if (i > 0) out.push({ type: 'break' } as BreakNode);
    if (part) out.push({ type: 'text', value: part } as TextNode);
  });
}

/**
 * 归一化行内数组：
 * - 合并相邻 text，折叠内部多余空格
 * - 去除重复 break
 * - 只修剪数组首尾的空白/换行（保留文本与行内元素之间的边界空格）
 */
function normalizeInline(nodes: InlineNode[]): InlineNode[] {
  const merged: InlineNode[] = [];
  for (const n of nodes) {
    if (n.type === 'text') {
      const prev = merged[merged.length - 1];
      if (prev?.type === 'text') {
        merged[merged.length - 1] = { type: 'text', value: collapseSpace(prev.value + n.value) };
        continue;
      }
      merged.push({ type: 'text', value: collapseSpace(n.value) });
    } else if (n.type === 'break') {
      const prev = merged[merged.length - 1];
      if (prev?.type === 'break') continue;
      merged.push(n);
    } else if (n.type === 'link' || n.type === 'strong' || n.type === 'emphasis') {
      merged.push({ ...n, children: normalizeInline(n.children) });
    } else {
      merged.push(n);
    }
  }

  // 修剪首尾空白文本与 break
  const first = merged[0];
  if (first?.type === 'text') {
    merged[0] = { type: 'text', value: first.value.replace(/^\s+/, '') };
  } else if (first?.type === 'break') {
    merged.shift();
  }
  const last = merged[merged.length - 1];
  if (last?.type === 'text') {
    merged[merged.length - 1] = { type: 'text', value: last.value.replace(/\s+$/, '') };
  } else if (last?.type === 'break') {
    merged.pop();
  }

  return merged.filter((n): n is InlineNode => !(n.type === 'text' && !n.value));
}

// ---------- 工具 ----------
