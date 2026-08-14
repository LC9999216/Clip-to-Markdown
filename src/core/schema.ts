/**
 * ContentDocument 统一中间数据结构。
 *
 * 设计约束：
 * - 全部节点必须是纯 JSON 可序列化对象（无 Element/Function/Map/Set），
 *   保证可跨 chrome.runtime 消息边界传递。
 * - body 恒为单一节点（tweet 或 article），renderer 据此做穷尽分派。
 * - 字段命名与 mdast 对齐（children/value/depth/ordered），降低认知负担。
 */

export type PlatformId = 'x' | 'zhihu' | 'heybox';

export type PlatformContentType =
  | 'tweet'
  | 'zhihu-answer'
  | 'zhihu-article'
  | 'heybox-post';

export interface ContentDocument {
  version: 1;
  metadata: DocumentMetadata;
  body: TweetNode | ArticleNode;
}

export interface DocumentMetadata {
  platform: PlatformId;
  contentType: PlatformContentType;
  /** 规范化后的原始 URL */
  sourceUrl: string;
  author: AuthorInfo;
  /** ISO 8601 字符串，取不到时为 '' */
  published: string;
  /** 文章/回答标题；X 推文无标题 */
  title?: string;
  /** 平台原生 id：tweetId / answerId / postId */
  id?: string;
}

export interface AuthorInfo {
  name: string;
  /** X 的 @username；知乎/小黑盒可为空 */
  handle?: string;
}

// ---------- Block 节点 ----------

export type BlockNode =
  | ParagraphNode
  | HeadingNode
  | ListNode
  | ListItemNode
  | BlockquoteNode
  | CodeBlockNode
  | ImageNode
  | ThematicBreakNode
  | TableNode;

export interface ParagraphNode {
  type: 'paragraph';
  children: InlineNode[];
}

export interface HeadingNode {
  type: 'heading';
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  children: InlineNode[];
}

export interface ListNode {
  type: 'list';
  ordered: boolean;
  children: ListItemNode[];
}

export interface ListItemNode {
  type: 'listItem';
  children: BlockNode[];
}

export interface BlockquoteNode {
  type: 'blockquote';
  children: BlockNode[];
}

export interface CodeBlockNode {
  type: 'code';
  lang?: string;
  value: string;
}

export interface ImageNode {
  type: 'image';
  url: string;
  alt?: string;
}

export interface ThematicBreakNode {
  type: 'thematicBreak';
}

export interface TableNode {
  type: 'table';
  header?: TableRowNode;
  children: TableRowNode[];
}

export interface TableRowNode {
  type: 'tableRow';
  children: TableCellNode[];
}

export interface TableCellNode {
  type: 'tableCell';
  children: InlineNode[];
}

// ---------- Inline 节点 ----------

export type InlineNode =
  | TextNode
  | LinkNode
  | StrongNode
  | EmphasisNode
  | InlineCodeNode
  | BreakNode;

export interface TextNode {
  type: 'text';
  value: string;
}

export interface LinkNode {
  type: 'link';
  url: string;
  children: InlineNode[];
}

export interface StrongNode {
  type: 'strong';
  children: InlineNode[];
}

export interface EmphasisNode {
  type: 'emphasis';
  children: InlineNode[];
}

export interface InlineCodeNode {
  type: 'inlineCode';
  value: string;
}

export interface BreakNode {
  type: 'break';
}

// ---------- 平台根节点 ----------

export interface TweetNode {
  type: 'tweet';
  author: AuthorInfo;
  /** ISO 8601 */
  published: string;
  /** tweetId */
  id: string;
  /** 正文块（通常一个 paragraph） */
  content: BlockNode[];
  /** 有序附件；无则 []（不省略） */
  media: ImageNode[];
  /** 引用推文（V0.1 可选） */
  quotedTweet?: TweetNode;
}

export interface ArticleNode {
  type: 'article';
  /** 正文块；标题在 metadata.title */
  children: BlockNode[];
}

const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'list',
  'listItem',
  'blockquote',
  'code',
  'image',
  'thematicBreak',
  'table',
]);

const INLINE_TYPES = new Set(['text', 'link', 'strong', 'emphasis', 'inlineCode', 'break']);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 结构校验：返回非法节点路径数组，空数组表示通过。
 * 供测试与调试使用，验证所有节点类型合法且可 JSON 序列化。
 */
export function validateDocument(doc: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(doc)) return ['root: 不是对象'];
  if (doc.version !== 1) errors.push('version: 必须为 1');
  if (!isRecord(doc.metadata)) {
    errors.push('metadata: 缺失');
  } else {
    if (typeof doc.metadata.sourceUrl !== 'string') errors.push('metadata.sourceUrl: 必须为字符串');
    if (!isRecord(doc.metadata.author) || typeof doc.metadata.author.name !== 'string') {
      errors.push('metadata.author: 缺少 name');
    }
    if (typeof doc.metadata.published !== 'string') errors.push('metadata.published: 必须为字符串');
  }
  const body = doc.body;
  if (!isRecord(body)) {
    errors.push('body: 缺失');
  } else if (body.type === 'tweet') {
    validateTweetNode(body, 'body', errors);
  } else if (body.type === 'article') {
    validateArticleNode(body, 'body', errors);
  } else {
    errors.push('body.type: 未知类型');
  }
  return errors;
}

function validateTweetNode(node: Record<string, unknown>, path: string, errors: string[]): void {
  if (typeof node.id !== 'string') errors.push(`${path}.id: 必须为字符串`);
  if (!Array.isArray(node.content)) {
    errors.push(`${path}.content: 必须为数组`);
  } else {
    node.content.forEach((b, i) => validateBlock(b, `${path}.content[${i}]`, errors));
  }
  if (!Array.isArray(node.media)) {
    errors.push(`${path}.media: 必须为数组`);
  } else {
    node.media.forEach((img, i) => validateImage(img, `${path}.media[${i}]`, errors));
  }
  if (node.quotedTweet !== undefined) {
    if (!isRecord(node.quotedTweet) || node.quotedTweet.type !== 'tweet') {
      errors.push(`${path}.quotedTweet: 必须是 tweet 节点`);
    } else {
      validateTweetNode(node.quotedTweet as Record<string, unknown>, `${path}.quotedTweet`, errors);
    }
  }
}

function validateArticleNode(node: Record<string, unknown>, path: string, errors: string[]): void {
  if (!Array.isArray(node.children)) {
    errors.push(`${path}.children: 必须为数组`);
  } else {
    node.children.forEach((b, i) => validateBlock(b, `${path}.children[${i}]`, errors));
  }
}

function validateBlock(v: unknown, path: string, errors: string[]): void {
  if (!isRecord(v)) {
    errors.push(`${path}: 不是对象`);
    return;
  }
  if (typeof v.type !== 'string' || !BLOCK_TYPES.has(v.type)) {
    errors.push(`${path}.type: 未知块类型 ${String(v.type)}`);
    return;
  }
  switch (v.type) {
    case 'paragraph':
      validateInlineArray(v.children, `${path}.children`, errors);
      break;
    case 'blockquote':
      if (!Array.isArray(v.children)) {
        errors.push(`${path}.children: 必须为数组`);
      } else {
        v.children.forEach((b, i) => validateBlock(b, `${path}.children[${i}]`, errors));
      }
      break;
    case 'heading':
      if (typeof v.depth !== 'number' || v.depth < 1 || v.depth > 6) {
        errors.push(`${path}.depth: 非法`);
      }
      validateInlineArray(v.children, `${path}.children`, errors);
      break;
    case 'list':
      if (typeof v.ordered !== 'boolean') errors.push(`${path}.ordered: 必须为布尔`);
      if (!Array.isArray(v.children)) {
        errors.push(`${path}.children: 必须为数组`);
      } else {
        v.children.forEach((li, i) => validateBlock(li, `${path}.children[${i}]`, errors));
      }
      break;
    case 'listItem':
      if (!Array.isArray(v.children)) {
        errors.push(`${path}.children: 必须为数组`);
      } else {
        v.children.forEach((b, i) => validateBlock(b, `${path}.children[${i}]`, errors));
      }
      break;
    case 'code':
      if (typeof v.value !== 'string') errors.push(`${path}.value: 必须为字符串`);
      break;
    case 'image':
      validateImage(v, path, errors);
      break;
    case 'thematicBreak':
      break;
    case 'table': {
      const rows = [...(v.header ? [v.header] : []), ...(Array.isArray(v.children) ? (v.children as unknown[]) : [])];
      if (v.header !== undefined && (!isRecord(v.header) || v.header.type !== 'tableRow')) {
        errors.push(`${path}.header: 非法`);
      }
      if (!Array.isArray(v.children)) errors.push(`${path}.children: 必须为数组`);
      rows.forEach((r, i) => {
        if (!isRecord(r) || r.type !== 'tableRow' || !Array.isArray(r.children)) {
          errors.push(`${path}.row[${i}]: 非法行`);
        } else {
          (r.children as unknown[]).forEach((c, j) => {
            if (!isRecord(c) || c.type !== 'tableCell') {
              errors.push(`${path}.row[${i}].cell[${j}]: 非法单元格`);
            } else {
              validateInlineArray(c.children, `${path}.row[${i}].cell[${j}].children`, errors);
            }
          });
        }
      });
      break;
    }
  }
}

function validateImage(v: Record<string, unknown>, path: string, errors: string[]): void {
  if (typeof v.url !== 'string' || !v.url) errors.push(`${path}.url: 必须为非空字符串`);
}

function validateInlineArray(v: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(v)) {
    errors.push(`${path}: 必须为数组`);
    return;
  }
  v.forEach((n, i) => {
    if (!isRecord(n)) {
      errors.push(`${path}[${i}]: 不是对象`);
      return;
    }
    if (typeof n.type !== 'string' || !INLINE_TYPES.has(n.type)) {
      errors.push(`${path}[${i}].type: 未知内联类型 ${String(n.type)}`);
      return;
    }
    switch (n.type) {
      case 'text':
      case 'inlineCode':
        if (typeof n.value !== 'string') errors.push(`${path}[${i}].value: 必须为字符串`);
        break;
      case 'break':
        break;
      case 'link':
        if (typeof n.url !== 'string' || !n.url) errors.push(`${path}[${i}].url: 必须为非空字符串`);
        validateInlineArray(n.children, `${path}[${i}].children`, errors);
        break;
      case 'strong':
      case 'emphasis':
        validateInlineArray(n.children, `${path}[${i}].children`, errors);
        break;
    }
  });
}

/**
 * JSON 序列化 round-trip 检查：深拷贝后应逐字段相等（即不存在不可序列化值）。
 * 返回第一个不相等的路径，或 null（通过）。
 */
export function checkJsonRoundTrip(doc: ContentDocument): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(JSON.stringify(doc));
  } catch {
    return 'root: 无法 JSON.stringify';
  }
  const errs = validateDocument(parsed);
  return errs.length ? `round-trip 后校验失败: ${errs[0]}` : null;
}
