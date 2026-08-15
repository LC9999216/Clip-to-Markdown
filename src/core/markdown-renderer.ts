/**
 * Markdown Renderer：ContentDocument → Markdown 字符串。
 * 纯函数，永不接触 DOM。可读性 > 像素级还原。
 */

import type {
  BlockNode,
  BlockquoteNode,
  CodeBlockNode,
  ContentDocument,
  HeadingNode,
  ImageNode,
  InlineNode,
  ListNode,
  ListItemNode,
  MarkdownBlockNode,
  ParagraphNode,
  TableNode,
  TweetNode,
} from './schema';

// ---------- 顶层 ----------

export function renderDocument(doc: ContentDocument): string {
  const { metadata } = doc;
  const parts: string[] = [];

  // frontmatter
  const fm: string[] = ['---'];
  fm.push(`platform: ${metadata.platform}`);
  fm.push(`author: ${yamlQuote(formatAuthor(metadata.author))}`);
  fm.push(`published: ${yamlQuote(metadata.published)}`);
  if (metadata.title) fm.push(`title: ${yamlQuote(metadata.title)}`);
  fm.push(`url: ${metadata.sourceUrl}`);
  fm.push('---');
  parts.push(fm.join('\n'));
  parts.push('');

  // 标题行 + 正文
  if (doc.body.type === 'tweet') {
    parts.push(`# ${formatAuthor(doc.body.author)}`);
    parts.push('');
    parts.push(renderTweetBody(doc.body));
  } else {
    if (metadata.title) {
      parts.push(`# ${metadata.title}`);
      parts.push('');
    }
    parts.push(renderArticleBody(doc.body.children));
  }
  parts.push('');
  parts.push('---');
  parts.push('');
  parts.push(`> 原文链接：${metadata.sourceUrl}`);
  if (metadata.published) parts.push(`> 发布时间：${metadata.published}`);

  return parts.join('\n');
}

/** 仅正文（不含 frontmatter 与 footer），供预览与文件名探测 */
export function renderBody(doc: ContentDocument): string {
  if (doc.body.type === 'tweet') return renderTweetBody(doc.body);
  return renderArticleBody(doc.body.children);
}

function renderTweetBody(tweet: TweetNode): string {
  const parts: string[] = [];
  parts.push(renderBlocks(tweet.content));
  if (tweet.media.length > 0) {
    parts.push('');
    parts.push(tweet.media.map(renderImage).join('\n'));
  }
  if (tweet.quotedTweet) {
    parts.push('');
    parts.push(renderQuotedTweet(tweet.quotedTweet));
  }
  return parts.join('\n');
}

function renderArticleBody(children: BlockNode[]): string {
  return renderBlocks(children);
}

function renderQuotedTweet(q: TweetNode): string {
  const lines: string[] = [];
  lines.push(`> **${formatAuthor(q.author)}**`);
  for (const block of q.content) {
    for (const line of renderBlock(block).split('\n')) {
      lines.push(`> ${line}`);
    }
  }
  for (const img of q.media) {
    lines.push(`> ${renderImage(img)}`);
  }
  return lines.join('\n');
}

// ---------- 块渲染 ----------

export function renderBlocks(blocks: BlockNode[]): string {
  const chunks: string[] = [];
  for (const block of blocks) {
    const rendered = renderBlock(block);
    if (rendered) chunks.push(rendered);
  }
  return chunks.join('\n\n');
}

function renderBlock(block: BlockNode): string {
  switch (block.type) {
    case 'paragraph':
      return renderParagraph(block);
    case 'heading':
      return renderHeading(block);
    case 'list':
      return renderList(block);
    case 'listItem':
      return renderListItem(block);
    case 'blockquote':
      return renderBlockquote(block);
    case 'code':
      return renderCodeBlock(block);
    case 'image':
      return renderImage(block);
    case 'thematicBreak':
      return '---';
    case 'table':
      return renderTable(block);
    case 'markdown':
      return renderMarkdownBlock(block);
  }
}

/**
 * 已经是 Markdown 源文本的块：只做规范化（CRLF→LF、去 NUL、去首尾空白行），
 * 保留内部 Markdown 语法，不转义、不围栏、不解析。
 */
function renderMarkdownBlock(node: MarkdownBlockNode): string {
  let value = node.value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\u0000/g, '');
  value = value.replace(/^(?:[ \t]*\n)+/, '').replace(/(?:\n[ \t]*)+$/, '');
  return value;
}

function renderParagraph(p: ParagraphNode): string {
  const text = renderInline(p.children).trim();
  return text || '';
}

function renderHeading(h: HeadingNode): string {
  const text = renderInline(h.children).trim();
  if (!text) return '';
  return `${'#'.repeat(h.depth)} ${text}`;
}

function renderList(list: ListNode): string {
  return list.children
    .map((item, i) => renderListItem(item, list.ordered ? i + 1 : undefined))
    .join('\n');
}

function renderListItem(item: ListItemNode, index?: number): string {
  const prefix = index !== undefined ? `${index}. ` : '- ';
  // 首行与列表标记同前缀；子块续行缩进
  const first = item.children[0];
  const firstRendered = first ? renderBlock(first) : '';
  const rest = item.children.slice(1).map(renderBlock).filter(Boolean);
  const indented = rest.map((r) => r.split('\n').map((l) => `  ${l}`).join('\n'));
  return [prefix + firstRendered, ...indented].filter(Boolean).join('\n');
}

function renderBlockquote(bq: BlockquoteNode): string {
  return bq.children
    .map((block) =>
      renderBlock(block)
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n'),
    )
    .join('\n>\n');
}

function renderCodeBlock(code: CodeBlockNode): string {
  const fence = fenceFor(code.value);
  const lang = code.lang ? `${fence}${code.lang}` : fence;
  return `${lang}\n${code.value}\n${fence}`;
}

/** 选择比内容最大反引号串多一个反引号的围栏 */
function maxBacktickRun(s: string): number {
  let max = 0;
  const re = /`+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[0].length > max) max = m[0].length;
  }
  return max;
}

function fenceFor(value: string): string {
  // 围栏至少 3 个反引号（```` 才是合法代码块），且比内容最大反引号串多一个
  return '`'.repeat(Math.max(3, maxBacktickRun(value) + 1));
}

export function renderImage(img: ImageNode): string {
  const alt = (img.alt ?? 'Image').replace(/\s+/g, ' ').trim() || 'Image';
  const safeAlt = alt.replace(/([\]\[()])/g, '\\$1');
  return `![${safeAlt}](${escapeLinkUrl(img.url)})`;
}

/** 链接目标：含空格/括号时用 <url> 包裹，避免破坏 Markdown 语法 */
function escapeLinkUrl(url: string): string {
  if (/[\s()<>]/u.test(url)) {
    return `<${url.replace(/[<>]/g, '')}>`;
  }
  return url;
}

function renderTable(table: TableNode): string {
  const headers = table.header
    ? table.header.children.map((c) => inlineToText(c.children))
    : [];
  const bodyRows = table.children.map((r) => r.children.map((c) => renderTableCell(c)));
  const colCount = Math.max(headers.length, ...bodyRows.map((r) => r.length));
  if (colCount === 0) return '';

  const pad = (cells: string[], len: number): string[] => {
    const padded = [...cells];
    while (padded.length < len) padded.push('');
    return padded.map((c) => c.replace(/\|/g, '\\|').replace(/\n/g, ' '));
  };

  const headCells = pad(headers, colCount);
  const lines: string[] = [];
  lines.push(`| ${headCells.join(' | ')} |`);
  lines.push(`| ${headCells.map(() => '---').join(' | ')} |`);
  for (const row of bodyRows) {
    lines.push(`| ${pad(row, colCount).join(' | ')} |`);
  }
  return lines.join('\n');
}

function renderTableCell(cell: { children: InlineNode[] }): string {
  return renderInline(cell.children).trim();
}

// ---------- 内联渲染 ----------

export function renderInline(nodes: InlineNode[]): string {
  return renderInlineSeq(nodes, true).text;
}

interface RenderedInline {
  text: string;
  /** 渲染后是否位于行首（影响后续文本的块级转义） */
  lineStart: boolean;
}

function renderInlineSeq(nodes: InlineNode[], initialLineStart: boolean): RenderedInline {
  let lineStart = initialLineStart;
  let out = '';
  for (const node of nodes) {
    const r = renderInlineNode(node, lineStart);
    out += r.text;
    lineStart = r.lineStart;
  }
  return { text: out, lineStart };
}

function renderInlineNode(node: InlineNode, lineStart: boolean): RenderedInline {
  switch (node.type) {
    case 'text': {
      let value = escapeText(node.value);
      if (lineStart) value = escapeLineStart(value);
      return { text: value, lineStart: false };
    }
    case 'inlineCode':
      // 按内容最大反引号串选择围栏（`` `foo` `` 形式），避免转义失效
      return { text: inlineCode(node.value), lineStart: false };
    case 'break':
      return { text: '  \n', lineStart: true };
    // link/strong/emphasis 内始终是行内上下文（方括号/星号内不会被解析为块级），不做行首转义
    case 'link':
      return { text: `[${renderInlineSeq(node.children, false).text}](${escapeLinkUrl(node.url)})`, lineStart: false };
    case 'strong':
      return { text: `**${renderInlineSeq(node.children, false).text}**`, lineStart: false };
    case 'emphasis':
      return { text: `*${renderInlineSeq(node.children, false).text}*`, lineStart: false };
  }
}

/**
 * 行内代码。
 * 内容无反引号 → 单反引号包裹；含反引号 → 更长围栏 + 内容两侧加空格
 * （`` `foo` `` 形式，CommonMark 才会把内容识别为 `foo` 而非剥离反引号）。
 */
function inlineCode(value: string): string {
  const run = maxBacktickRun(value);
  if (run === 0) return `\`${value}\``;
  const fence = '`'.repeat(run + 1);
  return `${fence} ${value} ${fence}`;
}

/**
 * 转义 Markdown 特殊字符（普通文本上下文）。
 * 行首的块级标记（# > - 等）另由 escapeLineStart 处理。
 */
function escapeText(s: string): string {
  return s.replace(/([\\`*_[\]()~])/g, '\\$1');
}

/** 文本位于行首时，转义可能被解析为块级结构的开头（# > - + 数字. 等） */
function escapeLineStart(s: string): string {
  if (/^[#>+~=|]/.test(s)) return `\\${s}`;
  if (/^\d+\./.test(s)) return `\\${s}`;
  if (/^([-*_])\1{2,}/.test(s)) return `\\${s}`; // --- / *** / ___
  if (/^[-*+]\s/.test(s)) return `\\${s}`; // 无序列表项
  return s;
}

// ---------- 工具 ----------

function formatAuthor(author: { name: string; handle?: string }): string {
  if (author.handle) return `${author.name} (@${author.handle})`;
  return author.name;
}

function yamlQuote(s: string): string {
  if (!s) return '""';
  return `"${s.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
}

/** 内联数组 → 纯文本（表格表头等） */
function inlineToText(nodes: InlineNode[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case 'text':
        case 'inlineCode':
          return n.value;
        case 'break':
          return ' ';
        case 'link':
        case 'strong':
        case 'emphasis':
          return inlineToText(n.children);
      }
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}
