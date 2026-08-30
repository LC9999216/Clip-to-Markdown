/**
 * OpenAI-Compatible Chat Completions 客户端（仅 Background 使用）。
 *
 * 约束：
 * - 不使用 SDK；仅对官方 DeepSeek V4 结构化分析启用 response_format；
 * - AbortController 30 秒超时；
 * - HTTP 错误映射为稳定错误码，不把第三方 API 完整错误正文展示给用户；
 * - V1 最多一次 repair；V2 先本地恢复，再允许一次 repair 和一次 fresh generation；
 * - V2 单次主动分析最多三次 Provider 请求，三阶段共享 30 秒总超时；
 * - API Key 只从 AiSettings 读取，绝不进入日志或 UI。
 */

import type { AiSettings } from '../core/ai-settings';
import { recoverVisualSummaryAnchors } from './anchor-recovery';
import { buildAnalysisPrompt, buildAnalysisPromptV2 } from './prompt';
import {
  parseVisualSummary,
  parseVisualSummaryV2,
  validateVisualSummaryAnchors,
  VisualSummaryValidationError,
} from './schema';
import type { AnalysisInput, VisualSummary, VisualSummaryV2 } from './types';

export const AI_TIMEOUT_MS = 30_000;

export type VisualAnalysisErrorCode =
  | 'AI_AUTH_FAILED'
  | 'AI_ENDPOINT_OR_MODEL_NOT_FOUND'
  | 'AI_RATE_LIMITED'
  | 'AI_PROVIDER_ERROR'
  | 'AI_TIMEOUT'
  | 'AI_NETWORK_ERROR'
  | 'AI_INVALID_RESPONSE';

export class VisualAnalysisRequestError extends Error {
  constructor(
    readonly code: VisualAnalysisErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'VisualAnalysisRequestError';
  }
}

const REPAIR_SYSTEM_PROMPT =
  '你上一次返回的数据不符合要求。\n请修复格式，只返回合法 JSON。\n不要解释。\n不要 Markdown。\n不要代码块。';

/** V2 修复提示：携带具体错误列表与上次输出，帮助模型修正。 */
function buildRepairPromptV2(problems: string[], lastOutput: string): string {
  return `你上一次返回的数据不符合要求，具体错误如下：
${problems.map((p) => `- ${p}`).join('\n')}

你上次的输出：
${lastOutput.slice(0, 3000)}

请修复格式，只返回合法 JSON。
不要解释。
不要 Markdown。
不要代码块。`;
}

function validationProblems(error: unknown): string[] | null {
  if (error instanceof VisualSummaryValidationError) return error.problems;
  if (error instanceof SyntaxError || (error instanceof Error && error.name === 'SyntaxError')) {
    return ['JSON 解析失败'];
  }
  return null;
}

const MAX_DIAGNOSTIC_PROBLEM_CHARS = 240;

function safeDiagnosticProblem(problem: string): string {
  const redacted = problem.replace(
    /(\.sourceBlockId) B\d+ not present in sent blocks/g,
    '$1 not present in sent blocks',
  );
  const chars = Array.from(redacted);
  return chars.length > MAX_DIAGNOSTIC_PROBLEM_CHARS
    ? `${chars.slice(0, MAX_DIAGNOSTIC_PROBLEM_CHARS - 1).join('')}…`
    : redacted;
}

function invalidResponseMessage(
  firstProblems: string[],
  repairedProblems: string[],
  freshProblems: string[],
): string {
  const format = (problems: string[]) => problems.map(safeDiagnosticProblem).join('；');
  return `AI 返回的分析结果未通过校验。首次校验：${format(firstProblems)}。`
    + `自动修复后：${format(repairedProblems)}。`
    + `全新生成后：${format(freshProblems)}。请重新生成。`;
}

export interface AiChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface TextCompletionOptions {
  structuredOutput?: boolean;
  temperature?: number;
  maxTokens?: number;
}

function isOfficialDeepSeekV4(settings: AiSettings): boolean {
  if (settings.model !== 'deepseek-v4-flash' && settings.model !== 'deepseek-v4-pro') return false;
  try {
    return new URL(settings.endpoint).hostname === 'api.deepseek.com';
  } catch {
    return false;
  }
}

function mapHttpError(status: number): VisualAnalysisRequestError {
  if (status === 401 || status === 403) {
    return new VisualAnalysisRequestError('AI_AUTH_FAILED', 'API Key 无效或没有访问权限，请检查设置。');
  }
  if (status === 404) {
    return new VisualAnalysisRequestError(
      'AI_ENDPOINT_OR_MODEL_NOT_FOUND',
      'Endpoint 或模型不存在，请检查设置。',
    );
  }
  if (status === 429) {
    return new VisualAnalysisRequestError('AI_RATE_LIMITED', '请求过于频繁或额度不足，请稍后重试。');
  }
  if (status >= 500 && status <= 599) {
    return new VisualAnalysisRequestError('AI_PROVIDER_ERROR', 'AI 服务暂时不可用，请稍后重试。');
  }
  return new VisualAnalysisRequestError('AI_PROVIDER_ERROR', `AI 服务返回异常状态（${status}）。`);
}

async function requestCompletion(
  settings: AiSettings,
  messages: AiChatMessage[],
  signal: AbortSignal,
  options: TextCompletionOptions = {},
): Promise<string> {
  const isDeepSeekV4 = isOfficialDeepSeekV4(settings);
  const useDeepSeekJsonMode = isDeepSeekV4 && options.structuredOutput === true;
  let response: Response;
  try {
    response = await fetch(settings.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? (useDeepSeekJsonMode ? 4096 : 1400),
        ...(isDeepSeekV4 ? { thinking: { type: 'disabled' } } : {}),
        ...(useDeepSeekJsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new VisualAnalysisRequestError('AI_TIMEOUT', '请求超时（30 秒），请稍后重试。');
    }
    throw new VisualAnalysisRequestError('AI_NETWORK_ERROR', '无法连接到 AI 服务，请检查网络或 Endpoint。');
  }

  if (!response.ok) throw mapHttpError(response.status);

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new VisualAnalysisRequestError('AI_INVALID_RESPONSE', 'AI 服务返回了无法解析的内容。');
  }

  const content = (data as { choices?: Array<{ message?: { content?: unknown } }> })
    ?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim() === '') {
    throw new VisualAnalysisRequestError('AI_INVALID_RESPONSE', 'AI 服务没有返回可用的分析结果。');
  }
  return content;
}

/** 有限清除 ```json / ``` 代码块围栏。 */
export function stripJsonFence(content: string): string {
  const trimmed = content.trim();
  const fenceStart = /^```(?:json)?\s*[\r\n]/i;
  if (fenceStart.test(trimmed) && /```\s*$/.test(trimmed)) {
    return trimmed.replace(fenceStart, '').replace(/```\s*$/, '').trim();
  }
  return trimmed;
}

function parseContent(content: string): VisualSummary {
  const cleaned = stripJsonFence(content);
  const parsed: unknown = JSON.parse(cleaned);
  return parseVisualSummary(parsed);
}

/**
 * 分析内容并返回严格校验后的 VisualSummary。
 * 初次 JSON 解析或 Schema 校验失败时允许一次 repair；再失败抛 AI_INVALID_RESPONSE。
 */
export async function analyzeContent(input: AnalysisInput, settings: AiSettings): Promise<VisualSummary> {
  const prompt = buildAnalysisPrompt(input);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const firstMessages: AiChatMessage[] = [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ];
    let content = await requestCompletion(settings, firstMessages, controller.signal, { structuredOutput: true });

    for (let attempt = 0; attempt <= 1; attempt++) {
      try {
        return parseContent(content);
      } catch (error) {
        const isParseFailure =
          error instanceof VisualSummaryValidationError ||
          error instanceof SyntaxError ||
          (error instanceof Error && error.name === 'SyntaxError');
        if (attempt === 0 && isParseFailure) {
          const repairMessages: AiChatMessage[] = [
            { role: 'system', content: `${prompt.system}\n\n${REPAIR_SYSTEM_PROMPT}` },
            { role: 'user', content: prompt.user },
          ];
          content = await requestCompletion(settings, repairMessages, controller.signal, { structuredOutput: true });
          continue;
        }
        throw new VisualAnalysisRequestError(
          'AI_INVALID_RESPONSE',
          'AI 返回的分析结果无法解析，请重新生成。',
        );
      }
    }
    throw new VisualAnalysisRequestError('AI_INVALID_RESPONSE', 'AI 返回的分析结果无法解析，请重新生成。');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 最小请求验证 AI 配置（Options 页「授权并测试」）。
 * 发送一个极小的 Chat Completion；只关心能连上并返回模型名，
 * 不暴露响应正文或 API Key。失败时抛出 VisualAnalysisRequestError。
 */
export async function testAiConnection(settings: AiSettings): Promise<{ model: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const messages: AiChatMessage[] = [
      { role: 'system', content: '你是连通性测试。请只回复一个词：OK。' },
      { role: 'user', content: 'ping' },
    ];
    await requestCompletion(settings, messages, controller.signal);
    return { model: settings.model };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 受控文本 completion：供字幕翻译等模块复用既有 HTTP 实现、
 * 超时和错误映射，不复制第二套请求代码。
 */
export async function completeText(
  settings: AiSettings,
  messages: AiChatMessage[],
  options: TextCompletionOptions = {},
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    return await requestCompletion(settings, messages, controller.signal, options);
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// V2：source-linked Visual Summary
// ============================================================

function parseContentV2(content: string): VisualSummaryV2 {
  const cleaned = stripJsonFence(content);
  const parsed: unknown = JSON.parse(cleaned);
  return parseVisualSummaryV2(parsed);
}

/**
 * V2 三阶段统一验收门：解析 → 本地保守恢复 → 严格 Anchor 校验。
 * 三个阶段（initial / repair / fresh）必须调用同一函数，任何阶段都不得绕过。
 */
function parseRecoverAndValidateV2(content: string, input: AnalysisInput): VisualSummaryV2 {
  const parsed = parseContentV2(content);
  const recovered = recoverVisualSummaryAnchors(parsed, input);
  const problems = validateVisualSummaryAnchors(recovered, input);
  if (problems.length > 0) throw new VisualSummaryValidationError(problems);
  return recovered;
}

function invalidV2Response(): VisualAnalysisRequestError {
  return new VisualAnalysisRequestError(
    'AI_INVALID_RESPONSE',
    'AI 返回的分析结果无法解析或原文引用不符，请重新生成。',
  );
}

/**
 * V2 分析内容：结构校验 + 语义 Anchor 校验，三阶段状态机。
 *
 * Stage 1 INITIAL：原始 prompt；Stage 2 REPAIR：一次（携带问题列表与上次输出）；
 * Stage 3 FRESH：一次（重新使用原始 prompt，不携带旧输出或 repair 错误）。
 * 每个阶段统一经过 parseRecoverAndValidateV2 验收门；三阶段共享同一
 * 30 秒 AbortController 总预算；非校验错误（HTTP/网络/超时）直接传播，不重试；
 * 三次校验都失败才返回带三段诊断的 AI_INVALID_RESPONSE。
 */
export async function analyzeContentV2(input: AnalysisInput, settings: AiSettings): Promise<VisualSummaryV2> {
  const prompt = buildAnalysisPromptV2(input);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  const initialMessages: AiChatMessage[] = [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user },
  ];

  try {
    const firstContent = await requestCompletion(
      settings,
      initialMessages,
      controller.signal,
      { structuredOutput: true },
    );
    try {
      return parseRecoverAndValidateV2(firstContent, input);
    } catch (firstError) {
      const firstProblems = validationProblems(firstError);
      if (!firstProblems) throw invalidV2Response();

      const repairMessages: AiChatMessage[] = [
        { role: 'system', content: `${prompt.system}\n\n${buildRepairPromptV2(firstProblems, firstContent)}` },
        { role: 'user', content: prompt.user },
      ];
      const repairedContent = await requestCompletion(
        settings,
        repairMessages,
        controller.signal,
        { structuredOutput: true },
      );
      try {
        return parseRecoverAndValidateV2(repairedContent, input);
      } catch (repairedError) {
        const repairedProblems = validationProblems(repairedError);
        if (!repairedProblems) throw invalidV2Response();

        const freshContent = await requestCompletion(
          settings,
          initialMessages,
          controller.signal,
          { structuredOutput: true },
        );
        try {
          return parseRecoverAndValidateV2(freshContent, input);
        } catch (freshError) {
          const freshProblems = validationProblems(freshError);
          if (!freshProblems) throw invalidV2Response();
          throw new VisualAnalysisRequestError(
            'AI_INVALID_RESPONSE',
            invalidResponseMessage(firstProblems, repairedProblems, freshProblems),
          );
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
}
