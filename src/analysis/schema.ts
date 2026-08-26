/**
 * VisualSummary 手写 Schema 校验与安全截断。
 *
 * 设计约束（与 core/schema.ts 一致的风格）：
 * - 不使用 zod / JSON Schema 库，保持零依赖；
 * - 可安全截断的文本字段超长时截断；
 * - 严重结构错误（字段缺失、类型错误、数量越界、树超深超多）直接拒绝。
 *
 * 限制：
 * - summary ≤ 80 字；keyPoints 2~5 个，title ≤ 20 字、description ≤ 80 字；
 * - structure 深度 ≤ 3、节点 ≤ 10、label ≤ 100 字；
 * - takeaways 1~3 条，各 ≤ 80 字；confidence 0~1。
 */

import type {
  AnalysisInput,
  ArticleType,
  VisualKeyPoint,
  VisualStructureItem,
  VisualSummary,
  VisualSummaryV2,
  VisualTreeNode,
} from './types';

export const ARTICLE_TYPES: readonly ArticleType[] = [
  'opinion',
  'tutorial',
  'news',
  'comparison',
  'technical',
  'list',
  'other',
];

const MAX_SUMMARY_CHARS = 80;
const MIN_KEY_POINTS = 2;
const MAX_KEY_POINTS = 5;
const MAX_KEY_POINT_TITLE_CHARS = 20;
const MAX_KEY_POINT_DESCRIPTION_CHARS = 80;
const MIN_TAKEAWAYS = 1;
const MAX_TAKEAWAYS = 3;
const MAX_TAKEAWAY_CHARS = 80;
const MAX_TREE_DEPTH = 3;
const MAX_TREE_NODES = 10;
const MAX_TREE_LABEL_CHARS = 100;
const MAX_REASON_CHARS = 200;

/** Schema 校验失败抛出的错误；client 据此触发一次 repair。 */
export class VisualSummaryValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`visual summary schema: ${problems.join('; ')}`);
    this.name = 'VisualSummaryValidationError';
  }
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/** 统计树节点总数（含根）。 */
function countTreeNodes(node: unknown): number {
  if (!isRecord(node) || !Array.isArray(node.children)) return 1;
  let total = 1;
  for (const child of node.children) total += countTreeNodes(child);
  return total;
}

/** 树深度：叶子为 1。 */
function treeDepth(node: unknown): number {
  if (!isRecord(node) || !Array.isArray(node.children) || node.children.length === 0) return 1;
  let max = 0;
  for (const child of node.children) max = Math.max(max, treeDepth(child));
  return max + 1;
}

/**
 * 返回所有问题列表；空数组表示通过。
 * 只做检查，不截断、不抛错。
 */
export function validateVisualSummary(raw: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(raw)) return ['visual summary must be an object'];

  if (raw.schemaVersion !== 1) problems.push('schemaVersion must be 1');
  if (!ARTICLE_TYPES.includes(raw.articleType as ArticleType)) {
    problems.push(`articleType must be one of ${ARTICLE_TYPES.join('|')}`);
  }

  const confidence = raw.confidence;
  if (typeof confidence !== 'number' || Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
    problems.push('confidence must be a number between 0 and 1');
  }

  if (!isString(raw.classificationReason)) problems.push('classificationReason must be a string');

  if (!isString(raw.summary) || raw.summary.trim() === '') {
    problems.push('summary must be a non-empty string');
  }

  if (!Array.isArray(raw.keyPoints) || raw.keyPoints.length < MIN_KEY_POINTS || raw.keyPoints.length > MAX_KEY_POINTS) {
    problems.push(`keyPoints must be an array of ${MIN_KEY_POINTS} to ${MAX_KEY_POINTS} items`);
  } else {
    raw.keyPoints.forEach((point, i) => {
      if (!isRecord(point)) {
        problems.push(`keyPoints[${i}] must be an object`);
        return;
      }
      if (!isString(point.title)) problems.push(`keyPoints[${i}].title must be a string`);
      if (!isString(point.description)) problems.push(`keyPoints[${i}].description must be a string`);
    });
  }

  if (!isRecord(raw.structure)) {
    problems.push('structure must be an object');
  } else {
    if (!isString(raw.structure.label)) problems.push('structure.label must be a string');
    if (treeDepth(raw.structure) > MAX_TREE_DEPTH) problems.push(`structure depth must not exceed ${MAX_TREE_DEPTH}`);
    if (countTreeNodes(raw.structure) > MAX_TREE_NODES) {
      problems.push(`structure node count must not exceed ${MAX_TREE_NODES}`);
    }
  }

  if (!Array.isArray(raw.takeaways) || raw.takeaways.length < MIN_TAKEAWAYS || raw.takeaways.length > MAX_TAKEAWAYS) {
    problems.push(`takeaways must be an array of ${MIN_TAKEAWAYS} to ${MAX_TAKEAWAYS} items`);
  } else {
    raw.takeaways.forEach((item, i) => {
      if (!isString(item)) problems.push(`takeaways[${i}] must be a string`);
    });
  }

  return problems;
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function parseKeyPoint(raw: unknown, i: number): VisualKeyPoint {
  if (!isRecord(raw)) throw new VisualSummaryValidationError([`keyPoints[${i}] must be an object`]);
  if (!isString(raw.title)) throw new VisualSummaryValidationError([`keyPoints[${i}].title must be a string`]);
  if (!isString(raw.description)) {
    throw new VisualSummaryValidationError([`keyPoints[${i}].description must be a string`]);
  }
  return {
    title: truncate(raw.title, MAX_KEY_POINT_TITLE_CHARS),
    description: truncate(raw.description, MAX_KEY_POINT_DESCRIPTION_CHARS),
  };
}

function parseTreeNode(raw: unknown, depth: number): VisualTreeNode {
  if (!isRecord(raw) || !isString(raw.label)) {
    throw new VisualSummaryValidationError(['structure nodes must be objects with a string label']);
  }
  if (depth > MAX_TREE_DEPTH) throw new VisualSummaryValidationError(['structure depth must not exceed 3']);
  const node: VisualTreeNode = { label: truncate(raw.label, MAX_TREE_LABEL_CHARS) };
  if (Array.isArray(raw.children)) {
    node.children = raw.children.map((child) => parseTreeNode(child, depth + 1));
  }
  return node;
}

/**
 * 严格解析：结构错误抛 VisualSummaryValidationError；文本超长安全截断。
 */
export function parseVisualSummary(raw: unknown): VisualSummary {
  const problems = validateVisualSummary(raw);
  if (problems.length > 0) throw new VisualSummaryValidationError(problems);

  const record = raw as UnknownRecord;
  const keyPoints = (record.keyPoints as unknown[]).map((point, i) => parseKeyPoint(point, i));
  const structure = parseTreeNode(record.structure, 1);
  const takeaways = (record.takeaways as unknown[]).map((item) => truncate(String(item), MAX_TAKEAWAY_CHARS));

  return {
    schemaVersion: 1,
    articleType: record.articleType as ArticleType,
    confidence: record.confidence as number,
    classificationReason: truncate(String(record.classificationReason), MAX_REASON_CHARS),
    summary: truncate(String(record.summary), MAX_SUMMARY_CHARS),
    keyPoints,
    structure,
    takeaways,
  };
}

// ============================================================
// V2：source-linked Visual Summary
// ============================================================

const V2_SUMMARY_COUNT = 2;
const V2_MAX_SUMMARY_CHARS = 90;
const MIN_STRUCTURE_ITEMS = 1;
const MAX_STRUCTURE_ITEMS = 10;
const MAX_STRUCTURE_TITLE_CHARS = 40;
const SOURCE_BLOCK_ID_RE = /^B\d{3,}$/;
const MAX_SOURCE_QUOTE_CHARS = 140;

function isStructureItem(raw: unknown): raw is { title: unknown; sourceBlockId?: unknown; sourceQuote?: unknown } {
  return isRecord(raw) && 'title' in raw;
}

/**
 * V2 结构校验（只检查形状，不检查语义 Anchor 是否属于输入块）。
 * 超长文本由 parse 阶段安全截断（与 V1 一致），不在此拒绝。
 * 返回问题列表；空数组表示通过。
 */
export function validateVisualSummaryV2(raw: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(raw)) return ['visual summary v2 must be an object'];

  if (raw.schemaVersion !== 2) problems.push('schemaVersion must be 2');

  if (!Array.isArray(raw.summary) || raw.summary.length !== V2_SUMMARY_COUNT) {
    problems.push(`summary must be an array of exactly ${V2_SUMMARY_COUNT} strings`);
  } else {
    raw.summary.forEach((s, i) => {
      if (!isString(s) || s.trim() === '') problems.push(`summary[${i}] must be a non-empty string`);
    });
  }

  if (!Array.isArray(raw.keyPoints) || raw.keyPoints.length < MIN_KEY_POINTS || raw.keyPoints.length > MAX_KEY_POINTS) {
    problems.push(`keyPoints must be an array of ${MIN_KEY_POINTS} to ${MAX_KEY_POINTS} items`);
  } else {
    raw.keyPoints.forEach((point, i) => {
      if (!isRecord(point)) {
        problems.push(`keyPoints[${i}] must be an object`);
        return;
      }
      if (!isString(point.title)) problems.push(`keyPoints[${i}].title must be a string`);
      if (!isString(point.description)) problems.push(`keyPoints[${i}].description must be a string`);
    });
  }

  if (!Array.isArray(raw.structure) || raw.structure.length < MIN_STRUCTURE_ITEMS || raw.structure.length > MAX_STRUCTURE_ITEMS) {
    problems.push(`structure must be an array of ${MIN_STRUCTURE_ITEMS} to ${MAX_STRUCTURE_ITEMS} items`);
  } else {
    raw.structure.forEach((item, i) => {
      if (!isStructureItem(item)) {
        problems.push(`structure[${i}] must be an object with a string title`);
        return;
      }
      if (!isString(item.title) || item.title.trim() === '') {
        problems.push(`structure[${i}].title must be a non-empty string`);
      }
      const hasId = item.sourceBlockId !== undefined;
      const hasQuote = item.sourceQuote !== undefined;
      if (hasId !== hasQuote) {
        problems.push(`structure[${i}] must have both sourceBlockId and sourceQuote, or neither`);
      }
      if (hasId) {
        if (typeof item.sourceBlockId !== 'string' || !SOURCE_BLOCK_ID_RE.test(item.sourceBlockId)) {
          problems.push(`structure[${i}].sourceBlockId must match ^B\\d{3,}$`);
        }
        if (typeof item.sourceQuote !== 'string' || item.sourceQuote.trim() === '') {
          problems.push(`structure[${i}].sourceQuote must be a non-empty string`);
        }
      }
    });
  }

  return problems;
}

function parseStructureItemV2(raw: unknown, i: number): VisualStructureItem {
  if (!isStructureItem(raw) || !isString(raw.title)) {
    throw new VisualSummaryValidationError([`structure[${i}] must be an object with a string title`]);
  }
  const title = truncate(raw.title.trim(), MAX_STRUCTURE_TITLE_CHARS);
  if (raw.sourceBlockId !== undefined || raw.sourceQuote !== undefined) {
    if (!isString(raw.sourceBlockId) || !isString(raw.sourceQuote)) {
      throw new VisualSummaryValidationError([`structure[${i}] sourceBlockId/sourceQuote must be strings`]);
    }
    return {
      title,
      sourceBlockId: raw.sourceBlockId,
      sourceQuote: truncate(raw.sourceQuote.trim(), MAX_SOURCE_QUOTE_CHARS),
    };
  }
  return { title };
}

/** 严格解析 V2：结构错误抛错，文本超长安全截断。 */
export function parseVisualSummaryV2(raw: unknown): VisualSummaryV2 {
  const problems = validateVisualSummaryV2(raw);
  if (problems.length > 0) throw new VisualSummaryValidationError(problems);

  const record = raw as UnknownRecord;
  const keyPoints = (record.keyPoints as unknown[]).map((point, i) => parseKeyPoint(point, i));
  const summary = (record.summary as unknown[]).map((s) => truncate(String(s).trim(), V2_MAX_SUMMARY_CHARS)) as [
    string,
    string,
  ];
  const structure = (record.structure as unknown[]).map((item, i) => parseStructureItemV2(item, i));

  return { schemaVersion: 2, summary, keyPoints, structure };
}

/**
 * 语义 Anchor 校验：Quote 必须属于对应 Block，且在本次输入 Blocks 中唯一。
 * Article 每个 Structure Item 必须带 Anchor；Tweet 必须全部无 Anchor。
 * 返回问题列表；空数组表示通过。
 */
export function validateVisualSummaryAnchors(summary: VisualSummaryV2, input: AnalysisInput): string[] {
  const problems: string[] = [];
  const isArticle = input.contentType === 'x-article';
  const blocksById = new Map(input.sourceBlocks.map((b) => [b.id, b]));

  summary.structure.forEach((item, i) => {
    const hasAnchor = item.sourceBlockId !== undefined;

    if (isArticle && !hasAnchor) {
      problems.push(`structure[${i}] must have sourceBlockId + sourceQuote for x-article`);
      return;
    }
    if (!isArticle && hasAnchor) {
      problems.push(`structure[${i}] must not have anchors for ${input.contentType}`);
      return;
    }
    if (!hasAnchor) return;

    const block = blocksById.get(item.sourceBlockId!);
    if (!block) {
      problems.push(`structure[${i}].sourceBlockId ${item.sourceBlockId} not present in sent blocks`);
      return;
    }

    if (!block.text.includes(item.sourceQuote!)) {
      problems.push(`structure[${i}].sourceQuote not found in block ${item.sourceBlockId}`);
      return;
    }

    const matching = input.sourceBlocks.filter((b) => b.text.includes(item.sourceQuote!));
    if (matching.length !== 1) {
      problems.push(`structure[${i}].sourceQuote is not unique across sent blocks`);
    }
  });

  return problems;
}
