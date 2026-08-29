import type { BiliSubtitleLine, BiliTranscriptSegment } from './subtitle-types';

const MAX_DURATION_SECONDS = 20;
const CJK_RE = /\p{Script=Han}/u;
const NATURAL_END_RE = /[。！？!?；;，,、:：.!?]/u;

interface GroupLimits {
  min: number;
  ideal: number;
  max: number;
}

interface TimedChunk {
  text: string;
  start: number;
  end: number;
  forceBoundary: boolean;
}

function limitsFor(lines: BiliSubtitleLine[]): GroupLimits {
  const isChinese = lines.some((line) => CJK_RE.test(line.content));
  return isChinese
    ? { min: 30, ideal: 90, max: 160 }
    : { min: 60, ideal: 180, max: 320 };
}

function isNaturalEnd(character: string | undefined): boolean {
  return character !== undefined && NATURAL_END_RE.test(character);
}

function timestampForCharacter(from: number, to: number, totalCharacters: number, characterOffset: number): number {
  if (totalCharacters <= 0) return from;
  return from + (to - from) * (characterOffset / totalCharacters);
}

function makeChunk(
  chars: string[],
  from: number,
  to: number,
  totalCharacters: number,
  startOffset: number,
  endOffset: number,
  forceBoundary: boolean,
): TimedChunk {
  return {
    text: chars.slice(startOffset, endOffset).join(''),
    start: timestampForCharacter(from, to, totalCharacters, startOffset),
    end: timestampForCharacter(from, to, totalCharacters, endOffset),
    forceBoundary,
  };
}

/** Find the latest sentence/phrase boundary in the inclusive character range. */
function findNaturalCut(chars: string[], startOffset: number, endOffset: number, minLength: number): number | null {
  const first = startOffset + minLength - 1;
  const last = Math.min(chars.length - 1, endOffset - 1);
  for (let index = last; index >= first; index -= 1) {
    if (isNaturalEnd(chars[index])) return index + 1;
  }
  return null;
}

function splitLongLine(line: BiliSubtitleLine, limits: GroupLimits): TimedChunk[] {
  const chars = Array.from(line.content);
  const characterCount = chars.length;
  const duration = Math.max(0, line.to - line.from);
  const durationCharacterLimit = duration > MAX_DURATION_SECONDS
    ? Math.max(1, Math.floor(characterCount * MAX_DURATION_SECONDS / duration))
    : characterCount;
  const hardLimit = Math.max(1, Math.min(limits.max, durationCharacterLimit));
  const needsHardSplit = characterCount > limits.max || duration > MAX_DURATION_SECONDS;

  // If the span has fewer characters than 20-second windows, keep the
  // characters in leading windows and represent the trailing remainder with
  // empty timing-only chunks. This preserves the full source time range
  // without duplicating or dropping sparse subtitle text.
  const timedWindowCount = Math.ceil(duration / MAX_DURATION_SECONDS);
  if (duration > MAX_DURATION_SECONDS && characterCount < timedWindowCount) {
    return Array.from({ length: timedWindowCount }, (_, index) => ({
      text: index < characterCount ? chars[index]! : '',
      start: line.from + Math.min(index * MAX_DURATION_SECONDS, duration),
      end: line.from + Math.min((index + 1) * MAX_DURATION_SECONDS, duration),
      forceBoundary: true,
    }));
  }

  if (!needsHardSplit && characterCount <= limits.ideal) {
    return [makeChunk(chars, line.from, line.to, characterCount, 0, characterCount, false)];
  }

  // A line that fits below the hard limit only needs an internal cut when a
  // natural boundary occurs before the hard maximum. Otherwise keep its
  // original line boundary intact.
  if (!needsHardSplit) {
    const naturalCut = findNaturalCut(chars, 0, limits.max, limits.min);
    if (!naturalCut || naturalCut >= characterCount) {
      return [makeChunk(chars, line.from, line.to, characterCount, 0, characterCount, false)];
    }
    return [
      makeChunk(chars, line.from, line.to, characterCount, 0, naturalCut, false),
      makeChunk(chars, line.from, line.to, characterCount, naturalCut, characterCount, false),
    ];
  }

  const chunks: TimedChunk[] = [];
  let offset = 0;
  while (offset < characterCount) {
    const endLimit = needsHardSplit ? Math.min(characterCount, offset + hardLimit) : characterCount;
    const naturalCut = findNaturalCut(chars, offset, endLimit, limits.min);
    const endOffset = naturalCut && naturalCut > offset ? naturalCut : endLimit;
    chunks.push(makeChunk(chars, line.from, line.to, characterCount, offset, endOffset, needsHardSplit));
    offset = endOffset;
  }
  return chunks;
}

function flush(
  chunks: TimedChunk[],
  result: BiliTranscriptSegment[],
): void {
  if (chunks.length === 0) return;
  result.push({
    id: `S${String(result.length + 1).padStart(4, '0')}`,
    start: chunks[0]!.start,
    end: chunks[chunks.length - 1]!.end,
    text: chunks.map((chunk) => chunk.text).join(''),
  });
  chunks.length = 0;
}

/**
 * Group subtitle lines into stable display segments without changing text order
 * or the original first/last timestamps.
 */
export function groupTranscript(raw: BiliSubtitleLine[]): BiliTranscriptSegment[] {
  const lines = (raw ?? []).filter((line) => String(line.content ?? '').trim().length > 0);
  if (lines.length === 0) return [];

  const limits = limitsFor(lines);
  const chunks = lines.flatMap((line) => splitLongLine(line, limits));
  const result: BiliTranscriptSegment[] = [];
  const current: TimedChunk[] = [];
  let currentCharacters = 0;

  for (const chunk of chunks) {
    const chunkCharacters = Array.from(chunk.text).length;
    const currentStart = current[0]?.start;
    const wouldExceedDuration = current.length > 0 && currentStart !== undefined
      && chunk.end - currentStart > MAX_DURATION_SECONDS;
    const wouldExceedCharacters = currentCharacters > 0 && currentCharacters + chunkCharacters > limits.max;
    if (wouldExceedDuration || wouldExceedCharacters) {
      flush(current, result);
      currentCharacters = 0;
    }

    current.push(chunk);
    currentCharacters += chunkCharacters;

    const endsNaturally = isNaturalEnd(Array.from(chunk.text).at(-1));
    const elapsed = current[0] ? chunk.end - current[0].start : 0;
    const shouldFlush = chunk.forceBoundary
      || elapsed >= MAX_DURATION_SECONDS
      || currentCharacters >= limits.max
      || (currentCharacters >= limits.min && (currentCharacters >= limits.ideal || endsNaturally));
    if (shouldFlush) {
      flush(current, result);
      currentCharacters = 0;
    }
  }
  flush(current, result);
  return result;
}
