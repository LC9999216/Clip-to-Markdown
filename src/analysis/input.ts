import { renderBody } from '../core/markdown-renderer';
import type { ContentDocument } from '../core/schema';
import type { AnalysisInput } from './types';

export const MAX_ANALYSIS_CHARS = 16_000;
const HEAD_CHARS = 12_000;
const TAIL_CHARS = 4_000;
const TRUNCATION_MARKER = '[内容过长，中间部分已省略]';

function formatAuthor(author: ContentDocument['metadata']['author']): string {
  const name = author.name.trim();
  const handle = author.handle?.trim().replace(/^@/, '');
  if (name && handle) return `${name} (@${handle})`;
  return name || (handle ? `@${handle}` : '');
}

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
  };
}
