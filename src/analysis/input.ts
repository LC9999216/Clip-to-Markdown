import { renderBody } from '../core/markdown-renderer';
import type { ContentDocument } from '../core/schema';
import type { AnalysisInput, AnalysisSourceBlock } from './types';

export const MAX_ANALYSIS_CHARS = 16_000;
const HEAD_CHARS = 12_000;
const TAIL_CHARS = 4_000;
const TRUNCATION_MARKER = '[内容过长，中间部分已省略]';

export function formatAuthor(author: ContentDocument['metadata']['author']): string {
  const name = author.name.trim();
  const handle = author.handle?.trim().replace(/^@/, '');
  if (name && handle) return `${name} (@${handle})`;
  return name || (handle ? `@${handle}` : '');
}

/**
 * V1 纯文本输入（保留给仍以纯正文渲染的路径）。
 * sourceBlocks 固定为 []（无来源块）。
 */
export function buildAnalysisInput(document: ContentDocument): AnalysisInput {
  const renderedBody = renderBody(document);
  const truncated = renderedBody.length > MAX_ANALYSIS_CHARS;
  const body = truncated
    ? `${renderedBody.slice(0, HEAD_CHARS)}${TRUNCATION_MARKER}${renderedBody.slice(-TAIL_CHARS)}`
    : renderedBody;

  return {
    platform: document.metadata.platform,
    contentType: document.metadata.contentType,
    title: document.metadata.title ?? '',
    author: formatAuthor(document.metadata.author),
    sourceUrl: document.metadata.sourceUrl,
    body,
    truncated,
    sourceBlocks: [],
  };
}

// ---------- V2：Source Block 输入 ----------

/** 单个块渲染为 "[Bxxx]\n文本" 行。 */
function renderBlockLine(block: AnalysisSourceBlock): string {
  return `[${block.id}]\n${block.text}`;
}

/**
 * Article 截断：按完整 Source Block 处理，头部预算 12,000 字符、尾部预算 4,000 字符。
 * 保留原 ID；中间被省略的块完全剔除（其 ID 不出现在 sourceBlocks），
 * 仅在文本中间插入无 ID 的省略提示，禁止重编号。
 */
function truncateBlocks(blocks: AnalysisSourceBlock[]): {
  body: string;
  kept: AnalysisSourceBlock[];
  truncated: boolean;
} {
  const head: AnalysisSourceBlock[] = [];
  let headLen = 0;
  for (const block of blocks) {
    const line = renderBlockLine(block);
    if (headLen + line.length + 2 > HEAD_CHARS) break;
    head.push(block);
    headLen += line.length + 2;
  }

  const tail: AnalysisSourceBlock[] = [];
  let tailLen = 0;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]!;
    const line = renderBlockLine(block);
    if (tailLen + line.length + 2 > TAIL_CHARS) break;
    tail.unshift(block);
    tailLen += line.length + 2;
  }

  // 头部与尾部可能重叠（文章短时尾部全部来自头部）；去重
  const headIds = new Set(head.map((b) => b.id));
  const tailOnly = tail.filter((b) => !headIds.has(b.id));

  const kept = [...head, ...tailOnly];
  const truncated = kept.length < blocks.length;

  if (!truncated) {
    return { body: blocks.map(renderBlockLine).join('\n\n'), kept, truncated: false };
  }

  const headText = head.map(renderBlockLine).join('\n\n');
  const tailText = tailOnly.map(renderBlockLine).join('\n\n');
  const body = tailOnly.length === 0 ? headText : `${headText}\n\n${TRUNCATION_MARKER}\n\n${tailText}`;
  return { body, kept, truncated: true };
}

/**
 * V2 输入构建：有来源块的平台使用 Source Block 格式（[Bxxx]\n文本），
 * 没有可定位来源的平台继续使用纯正文格式。
 * AnalysisInput.sourceBlocks 只保留实际发送给 AI 的块。
 */
export function buildAnalysisInputV2(
  document: ContentDocument,
  sourceBlocks: AnalysisSourceBlock[],
): AnalysisInput {
  if (sourceBlocks.length > 0) {
    const { body, kept, truncated } = truncateBlocks(sourceBlocks);
    return {
      platform: document.metadata.platform,
      contentType: document.metadata.contentType,
      title: document.metadata.title ?? '',
      author: formatAuthor(document.metadata.author),
      sourceUrl: document.metadata.sourceUrl,
      body,
      truncated,
      sourceBlocks: kept,
    };
  }

  // 缺失来源块：沿用纯正文输入
  const renderedBody = renderBody(document);
  const truncated = renderedBody.length > MAX_ANALYSIS_CHARS;
  const body = truncated
    ? `${renderedBody.slice(0, HEAD_CHARS)}${TRUNCATION_MARKER}${renderedBody.slice(-TAIL_CHARS)}`
    : renderedBody;
  return {
    platform: document.metadata.platform,
    contentType: document.metadata.contentType,
    title: document.metadata.title ?? '',
    author: formatAuthor(document.metadata.author),
    sourceUrl: document.metadata.sourceUrl,
    body,
    truncated,
    sourceBlocks: [],
  };
}
