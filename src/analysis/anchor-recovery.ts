/**
 * Anchor 本地保守重匹配（纯函数、确定性、无副作用）。
 *
 * 安全合同（计划 §0.5）：
 * - 只替换 `structure[i].sourceQuote`，绝不修改 sourceBlockId 或其他字段；
 * - 候选必须是对应 Block 的精确原文子串（block.text.includes 证明）；
 * - 相似度 ≥ 0.72 且领先第二名 ≥ 0.08 才恢复，歧义保守失败；
 * - 归一化后少于 6 code points 的 Quote 不做模糊恢复；
 * - 归一化（NFKC / 小写 / 删标点符号空白）只用于比较，返回值永远是 Block 原文。
 */

import { normalizeBlockText } from './source-blocks';
import { MAX_SOURCE_QUOTE_CHARS } from './schema';
import type {
  AnalysisInput,
  AnalysisSourceBlock,
  VisualStructureItem,
  VisualSummaryV2,
} from './types';

const MIN_COMPARISON_CHARS = 6;
const MIN_RECOVERY_SCORE = 0.72;
const MIN_SCORE_MARGIN = 0.08;
const STRONG_END = new Set(['。', '！', '？', '!', '?', '；', ';']);
const WEAK_END = new Set(['，', ',', '、', '：', ':']);

/** 比较用归一化：仅用于相似度计算，绝不作为返回给 UI/导航的 Quote。 */
function comparisonText(raw: string): string {
  return normalizeBlockText(raw)
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '');
}

/** 按给定边界标点切分（标点保留在前段末尾），空段丢弃。 */
function splitAtBoundaries(text: string, boundaries: ReadonlySet<string>): string[] {
  const chars = Array.from(text);
  const pieces: string[] = [];
  let start = 0;
  for (let i = 0; i < chars.length; i += 1) {
    if (!boundaries.has(chars[i]!)) continue;
    const piece = chars.slice(start, i + 1).join('').trim();
    if (piece) pieces.push(piece);
    start = i + 1;
  }
  const tail = chars.slice(start).join('').trim();
  if (tail) pieces.push(tail);
  return pieces;
}

/** 按 140 code points 固定窗口从左到右切分。 */
function hardChunks(text: string): string[] {
  const chars = Array.from(text);
  const chunks: string[] = [];
  for (let start = 0; start < chars.length; start += MAX_SOURCE_QUOTE_CHARS) {
    const chunk = chars.slice(start, start + MAX_SOURCE_QUOTE_CHARS).join('').trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

/**
 * 从单个 Block 生成候选 Quote：
 * 强句末分段（保留标点）→ 超长再按弱标点 → 仍超长按 140 窗口；
 * 丢弃空候选与归一化后 <6 code points 的候选，稳定去重，
 * 最后用 blockText.includes 证明每个候选都是原文精确子串。
 */
function collectQuoteCandidates(blockText: string): string[] {
  const candidates: string[] = [];
  const strongPieces = splitAtBoundaries(blockText, STRONG_END);
  for (const strongPiece of strongPieces.length > 0 ? strongPieces : [blockText.trim()]) {
    if (Array.from(strongPiece).length <= MAX_SOURCE_QUOTE_CHARS) {
      candidates.push(strongPiece);
      continue;
    }
    const weakPieces = splitAtBoundaries(strongPiece, WEAK_END);
    for (const weakPiece of weakPieces.length > 0 ? weakPieces : [strongPiece]) {
      if (Array.from(weakPiece).length <= MAX_SOURCE_QUOTE_CHARS) {
        candidates.push(weakPiece);
      } else {
        candidates.push(...hardChunks(weakPiece));
      }
    }
  }

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    return Array.from(comparisonText(candidate)).length >= MIN_COMPARISON_CHARS
      && Array.from(candidate).length <= MAX_SOURCE_QUOTE_CHARS
      && blockText.includes(candidate);
  });
}

/** Unicode code point bigram 多重集。 */
function bigramCounts(value: string): Map<string, number> {
  const chars = Array.from(value);
  const counts = new Map<string, number>();
  for (let i = 0; i < chars.length - 1; i += 1) {
    const gram = `${chars[i]}${chars[i + 1]}`;
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

/** Sørensen–Dice 相似度：2 × 多重集交集 / (bigram 数之和)。 */
function diceSimilarity(left: string, right: string): number {
  const a = comparisonText(left);
  const b = comparisonText(right);
  if (a === b && Array.from(a).length >= MIN_COMPARISON_CHARS) return 1;
  if (Array.from(a).length < 2 || Array.from(b).length < 2) return 0;

  const aCounts = bigramCounts(a);
  const bCounts = bigramCounts(b);
  let intersection = 0;
  for (const [gram, count] of aCounts) {
    intersection += Math.min(count, bCounts.get(gram) ?? 0);
  }
  const aTotal = [...aCounts.values()].reduce((sum, count) => sum + count, 0);
  const bTotal = [...bCounts.values()].reduce((sum, count) => sum + count, 0);
  return (2 * intersection) / (aTotal + bTotal);
}

/**
 * 在对应 Block 内找出唯一高置信度候选：
 * 最高分 ≥ 0.72、领先第二名 ≥ 0.08（同分按原文顺序稳定排序）、
 * 且候选只出现在一个 sent Block 中（保持现有唯一性校验语义）。
 */
function findReplacementQuote(
  quote: string,
  block: AnalysisSourceBlock,
  allBlocks: AnalysisSourceBlock[],
): string | null {
  if (Array.from(comparisonText(quote)).length < MIN_COMPARISON_CHARS) return null;

  const ranked = collectQuoteCandidates(block.text)
    .map((candidate, order) => ({ candidate, order, score: diceSimilarity(quote, candidate) }))
    .sort((a, b) => b.score - a.score || a.order - b.order);

  const best = ranked[0];
  const second = ranked[1];
  if (!best || best.score < MIN_RECOVERY_SCORE) return null;
  if (second && best.score - second.score < MIN_SCORE_MARGIN) return null;
  if (allBlocks.filter((item) => item.text.includes(best.candidate)).length !== 1) return null;
  return best.candidate;
}

function hasAnchor(
  item: VisualStructureItem,
): item is Extract<VisualStructureItem, { sourceBlockId: string; sourceQuote: string }> {
  return item.sourceBlockId !== undefined && item.sourceQuote !== undefined;
}

/**
 * 对每个 structure 条目做一次保守本地重匹配：
 * Block ID 不存在、Quote 已是精确子串、或无高置信度候选时条目原样保留；
 * 只有至少一条被替换时才返回新对象，否则返回原对象（保持引用同一性）。
 * 替换后仍必须经过 validateVisualSummaryAnchors（调用方负责）。
 */
export function recoverVisualSummaryAnchors(
  summary: VisualSummaryV2,
  input: AnalysisInput,
): VisualSummaryV2 {
  if (input.sourceBlocks.length === 0) return summary;
  const byId = new Map(input.sourceBlocks.map((block) => [block.id, block]));
  let changed = false;

  const structure = summary.structure.map((item) => {
    if (!hasAnchor(item)) return item;
    const block = byId.get(item.sourceBlockId);
    if (!block || block.text.includes(item.sourceQuote)) return item;
    const replacement = findReplacementQuote(item.sourceQuote, block, input.sourceBlocks);
    if (!replacement) return item;
    changed = true;
    return { ...item, sourceQuote: replacement };
  });

  return changed ? { ...summary, structure } : summary;
}
