import type { BiliSubtitleLine, BiliTranscriptSegment } from './subtitle-types';

// ---- 展示分段固定规格（不进入设置页） ----
// 正常字幕约 4 秒一小段；字符密度足够时每段最长不超过 6 秒。
const TARGET_DURATION_SECONDS = 4;
const MAX_DURATION_SECONDS = 6;

const CJK_LIMITS = {
  minCut: 6,
  target: 24,
  max: 28,
} as const;

const LATIN_LIMITS = {
  minCut: 12,
  target: 56,
  max: 72,
} as const;

const HAN_RE = /\p{Script=Han}/u;
const WHITESPACE_RE = /\s/u;
const STRONG_PUNCT = new Set(['。', '！', '？', '”', '’', '!', '?', '；', ';']);
const WEAK_PUNCT = new Set(['，', ',', '、', '：', ':']);

interface SegmentLimits {
  minCut: number;
  target: number;
  max: number;
}

function containsHan(text: string): boolean {
  return HAN_RE.test(text);
}

function getSegmentLimits(text: string): SegmentLimits {
  return containsHan(text) ? CJK_LIMITS : LATIN_LIMITS;
}

function isWhitespaceChar(character: string | undefined): boolean {
  return character !== undefined && WHITESPACE_RE.test(character);
}

function sliceHasContent(codePoints: string[], start: number, end: number): boolean {
  for (let index = start; index < end; index += 1) {
    if (!isWhitespaceChar(codePoints[index])) return true;
  }
  return false;
}

/**
 * 按固定优先级选择切点：
 * 1) 强句末标点；2) 后跟空白的拉丁句点（避开小数/版本号/URL）；3) 弱标点；
 * 4) 拉丁空白边界；5) 都没有时在 targetLimit 处硬切。
 * 候选必须位于 [offset + min(minCut, remaining-1), offset + hardLimit]；
 * 同优先级取距 offset+targetLimit 最近者，距离相同取较后者（标点归入前段）。
 */
function findCutIndex(
  codePoints: string[],
  offset: number,
  targetLimit: number,
  hardLimit: number,
  minCut: number,
  isCjk: boolean,
): number {
  const total = codePoints.length;
  const remaining = total - offset;
  if (remaining <= hardLimit) return total;

  const lowCut = offset + Math.min(minCut, remaining - 1);
  const highCut = offset + hardLimit;
  const idealCut = offset + targetLimit;

  const bestCut = (matches: (character: string, position: number) => boolean): number | null => {
    let best: number | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    const first = Math.max(offset, lowCut - 1);
    const last = Math.min(total - 2, highCut - 1);
    for (let position = first; position <= last; position += 1) {
      if (!matches(codePoints[position]!, position)) continue;
      const cut = position + 1;
      const distance = Math.abs(cut - idealCut);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = cut;
      }
    }
    return best;
  };

  const strongCut = bestCut((character) => STRONG_PUNCT.has(character));
  if (strongCut !== null) return strongCut;

  // 拉丁句点：仅当后接空白（或文本结尾）时视为句末，避免切断小数、版本号或 URL。
  // 「文本结尾」分支无需显式判断：remaining ≤ hardLimit 时已整段收尾（:67），而候选窗口
  // 的 last = min(total-2, highCut-1) < total-1，文本结尾句点不可能进入候选窗口，行为等价。
  const dotCut = bestCut((character, position) => character === '.' && isWhitespaceChar(codePoints[position + 1]));
  if (dotCut !== null) return dotCut;

  const weakCut = bestCut((character) => WEAK_PUNCT.has(character));
  if (weakCut !== null) return weakCut;

  if (!isCjk) {
    const whitespaceCut = bestCut((character) => isWhitespaceChar(character));
    if (whitespaceCut !== null) return whitespaceCut;
  }

  return idealCut;
}

/** 分隔空白归入前段但不越过本段硬上限（不丢字；纯空白块由切分循环并入相邻含内容子段）。 */
function advanceCut(codePoints: string[], cut: number, hardLimitEnd: number): number {
  const total = codePoints.length;
  let end = cut;
  while (end < total && end < hardLimitEnd && isWhitespaceChar(codePoints[end])) end += 1;
  return end;
}

/** 把一条源字幕行拆成展示子段：时间按累计 code point 比例分配，首尾时间精确保留。 */
function splitSubtitleLine(line: BiliSubtitleLine): Array<{ start: number; end: number; text: string }> {
  const codePoints = Array.from(String(line.content ?? ''));
  if (codePoints.length === 0) return [];

  const from = Number.isFinite(line.from) ? Math.max(0, line.from) : 0;
  const to = Number.isFinite(line.to) ? Math.max(from, line.to) : from;
  const duration = to - from;
  const chars = codePoints.length;
  const limits = getSegmentLimits(line.content);
  const isCjk = containsHan(line.content);

  // 极稀疏源行保真例外：平均一个不可再分的 code point 已超过 6 秒，
  // 无法拆出更有意义的字幕；不重复文字、不造空段，保留原始时间范围。
  if (duration > MAX_DURATION_SECONDS && duration / chars > MAX_DURATION_SECONDS) {
    return [{ start: from, end: to, text: line.content }];
  }

  const targetByTime = duration > 0
    ? Math.max(1, Math.floor(chars * TARGET_DURATION_SECONDS / duration))
    : limits.target;
  const maxByTime = duration > 0
    ? Math.max(targetByTime, Math.floor(chars * MAX_DURATION_SECONDS / duration))
    : limits.max;
  const targetLimit = Math.min(limits.target, targetByTime);
  const hardLimit = Math.max(targetLimit, Math.min(limits.max, maxByTime));

  const segments: Array<{ start: number; end: number; text: string }> = [];
  let offset = 0;
  // 纯空白块（行内超长空白串被硬上限截断时产生）不单独成段：
  // 挂起后并入下一个含内容子段，起点取块首，时间仍按 code point 比例。
  let pendingFrom = -1;
  while (offset < chars) {
    const rawCut = findCutIndex(codePoints, offset, targetLimit, hardLimit, limits.minCut, isCjk);
    const cut = advanceCut(codePoints, rawCut, offset + hardLimit);
    if (!sliceHasContent(codePoints, offset, cut)) {
      if (pendingFrom < 0) pendingFrom = offset;
    } else {
      const startOffset = pendingFrom >= 0 ? pendingFrom : offset;
      const text = codePoints.slice(startOffset, cut).join('');
      const start = startOffset === 0 ? from : from + duration * (startOffset / chars);
      const end = cut === chars ? to : from + duration * (cut / chars);
      segments.push({ start, end, text });
      pendingFrom = -1;
    }
    offset = cut;
  }
  if (pendingFrom >= 0 && segments.length > 0) {
    // 行尾纯空白块：并入最后一个子段的文字，其 end 已精确等于 to
    segments[segments.length - 1]!.text += codePoints.slice(pendingFrom).join('');
  }
  return segments;
}

/**
 * 把字幕行分成稳定的展示段：逐条源行独立处理，绝不跨源行合并；
 * 源行之间的真实时间空档保持为空档。
 */
export function groupTranscript(raw: BiliSubtitleLine[]): BiliTranscriptSegment[] {
  const lines = (raw ?? []).filter((line) => String(line.content ?? '').trim().length > 0);
  return lines
    .flatMap(splitSubtitleLine)
    .map((segment, index) => ({
      id: `S${String(index + 1).padStart(4, '0')}`,
      start: segment.start,
      end: segment.end,
      text: segment.text,
    }));
}
