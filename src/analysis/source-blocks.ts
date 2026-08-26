/**
 * Source Block 共享工具：归一化、切分与 ID 生成。
 * 分析与导航复用同一算法，保证 ID 稳定、Quote 可复现。
 */

export const MAX_SOURCE_BLOCK_CHARS = 2_000;

/** 句末边界：中文句号、问号、感叹号、英文句号、问号、感叹号、分号、换行 */
const SENTENCE_BOUNDARY_RE = /[。！？!?；;]/;

/**
 * 文本归一化：
 * - NBSP（\u00A0）→ 普通空格
 * - 零宽字符（\u200B \u200C \u200D \uFEFF）删除
 * - 连续空白合并为单个空格
 * - trim
 *
 * 注意：不执行 NFKC，因为 NFKC 会将全角 CJK 标点（如 ，、：）转换为半角，
 * 破坏中文原文的引用匹配（AI 生成的 Quote 基于 Markdown 中的全角标点）。
 */
export function normalizeBlockText(raw: string): string {
  return raw
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B-\u200C\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 按完整 Block 切分：优先在句末边界处分段，找不到边界时在 max 字符处硬切。
 * 段内文本经 normalizeBlockText。空文本返回空数组。
 */
export function splitLongBlockText(raw: string, max = MAX_SOURCE_BLOCK_CHARS): string[] {
  const normalized = normalizeBlockText(raw);
  if (!normalized) return [];
  if (normalized.length <= max) return [normalized];

  const chunks: string[] = [];
  let rest = normalized;

  while (rest.length > max) {
    const head = rest.slice(0, max);
    // 从后往前找最后一个边界
    let cut = -1;
    for (let i = head.length - 1; i >= 0; i--) {
      if (SENTENCE_BOUNDARY_RE.test(head[i]!)) {
        cut = i + 1;
        break;
      }
    }
    // 无边界则在 max 处硬切
    if (cut < 0) cut = max;

    const piece = rest.slice(0, cut).trim();
    if (piece) chunks.push(piece);
    rest = rest.slice(cut).trim();
  }

  if (rest) chunks.push(rest);
  return chunks;
}

/** 生成 Source Block 编号：B001、B002…… */
export function sourceBlockId(index: number): string {
  return `B${String(index + 1).padStart(3, '0')}`;
}