/**
 * B站英文字幕 → 简体中文翻译流水线（纯逻辑，仅 Background 调用）。
 *
 * 约束：
 * - 请求只包含行 ID 与英文文本；时间码、BV 号、页面 URL、标题、作者不进入提示词；
 * - 模型响应只接受 {"translations":[{"id":"L0001","text":"…"}]}；
 * - 逐行按 ID 回填，严格保留每行 from/to 与顺序，不允许增删行或改时间码；
 * - 每个批次解析/校验失败只做一次修复；第二次仍非法抛 AI_INVALID_RESPONSE，
 *   且不把完整非法响应写入错误消息。
 */

import type { BiliSubtitleLine } from '../adapters/bilibili/subtitle-types';
import type { AiSettings } from '../core/ai-settings';
import {
  completeText,
  stripJsonFence,
  VisualAnalysisRequestError,
  type AiChatMessage,
  type TextCompletionOptions,
} from './client';

export const MAX_TRANSLATION_BATCH_LINES = 60;
export const MAX_TRANSLATION_BATCH_CHARS = 6000;

export type SubtitleCompletion = (
  settings: AiSettings,
  messages: AiChatMessage[],
  options: TextCompletionOptions,
) => Promise<string>;

const TRANSLATION_SYSTEM_PROMPT = `你是B站视频的英文字幕翻译器。把输入的英文字幕逐行翻译成简体中文。
要求：
- 只做翻译，不解释、不总结、不评注。
- 译文使用自然、口语化的简体中文。
- 保留专有名词（产品名、技术术语、人名）的通用中文译名或英文原文。
- 不得增加、删除、合并或拆分任何行；不得修改行 ID。
- 只返回 JSON，格式：{"translations":[{"id":"行ID","text":"简体中文译文"}]}，不要 Markdown，不要代码块。`;

const REPAIR_NOTE = '你上一次返回的数据不符合要求。\n请修复格式，只返回合法 JSON。\n不要解释。\n不要 Markdown。\n不要代码块。';

const COMPLETION_OPTIONS: TextCompletionOptions = {
  structuredOutput: true,
  temperature: 0.2,
  maxTokens: 4096,
};

/** 行 ID 固定为 L + 4 位零填充序号（每批从 L0001 重新开始）。 */
function lineId(indexInBatch: number): string {
  return `L${String(indexInBatch + 1).padStart(4, '0')}`;
}

function unicodeLength(value: string): number {
  return Array.from(value).length;
}

/** 按 60 行 / 6000 字符（Unicode）上限切批；单行超长时独立成批。 */
function buildBatches(lines: BiliSubtitleLine[]): BiliSubtitleLine[][] {
  const batches: BiliSubtitleLine[][] = [];
  let current: BiliSubtitleLine[] = [];
  let currentChars = 0;
  for (const line of lines) {
    const chars = unicodeLength(line.content);
    if (
      current.length > 0
      && (current.length + 1 > MAX_TRANSLATION_BATCH_LINES || currentChars + chars > MAX_TRANSLATION_BATCH_CHARS)
    ) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(line);
    currentChars += chars;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** 校验失败返回 null；成功返回 ID → 译文映射，且覆盖批次内全部 ID。 */
function parseTranslationResponse(raw: string, expectedCount: number): Map<string, string> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(raw));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const translations = (parsed as { translations?: unknown }).translations;
  if (!Array.isArray(translations)) return null;

  const byId = new Map<string, string>();
  for (const item of translations) {
    if (typeof item !== 'object' || item === null) return null;
    const { id, text } = item as { id?: unknown; text?: unknown };
    if (typeof id !== 'string' || typeof text !== 'string') return null;
    if (text.trim() === '') return null;
    if (byId.has(id)) return null;
    byId.set(id, text);
  }
  if (byId.size !== expectedCount) return null;
  for (let index = 0; index < expectedCount; index++) {
    if (!byId.has(lineId(index))) return null;
  }
  return byId;
}

async function translateBatch(
  batch: BiliSubtitleLine[],
  settings: AiSettings,
  complete: SubtitleCompletion,
): Promise<BiliSubtitleLine[]> {
  const userContent = JSON.stringify({
    lines: batch.map((line, index) => ({ id: lineId(index), text: line.content })),
  });
  const messages: AiChatMessage[] = [
    { role: 'system', content: TRANSLATION_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];

  const first = parseTranslationResponse(await complete(settings, messages, COMPLETION_OPTIONS), batch.length);
  if (first !== null) {
    return batch.map((line, index) => ({ from: line.from, to: line.to, content: first.get(lineId(index))! }));
  }

  const repairMessages: AiChatMessage[] = [
    { role: 'system', content: `${TRANSLATION_SYSTEM_PROMPT}\n\n${REPAIR_NOTE}` },
    { role: 'user', content: userContent },
  ];
  const repaired = parseTranslationResponse(await complete(settings, repairMessages, COMPLETION_OPTIONS), batch.length);
  if (repaired === null) {
    throw new VisualAnalysisRequestError('AI_INVALID_RESPONSE', 'AI 返回的字幕翻译格式无效，请重试。');
  }
  return batch.map((line, index) => ({ from: line.from, to: line.to, content: repaired.get(lineId(index))! }));
}

/**
 * 把英文字幕行翻译为简体中文行：
 * 分批请求 AI，按 ID 回填译文，严格保留时间码与顺序。
 */
export async function translateBilibiliSubtitleLines(
  lines: BiliSubtitleLine[],
  settings: AiSettings,
  complete: SubtitleCompletion = completeText,
): Promise<BiliSubtitleLine[]> {
  if (lines.length === 0) return [];
  const results: BiliSubtitleLine[] = [];
  for (const batch of buildBatches(lines)) {
    results.push(...await translateBatch(batch, settings, complete));
  }
  return results;
}
