/**
 * 「一图速览」Background 编排器（唯一允许调用 AI 的模块）。
 *
 * 流程（任务书 §29）：
 *   extracting → EXTRACT → 平台检查 → AI 配置 → Host 权限 → AnalysisInput
 *   → 缓存检查 → analyzing → AI → Validation → 写缓存 → done
 * 任何异常 → error { code, message }（可执行中文提示）。
 *
 * 竞态（M1）：requestId 守卫集中在 writeState 内部——只有最新请求能写入状态，
 * 旧请求的后续写入被静默丢弃，防止 A 后返回覆盖 B。
 */

import { buildAnalysisInputV2 } from '../analysis/input';
import { readCachedSummary, visualSummaryCacheKey, writeCachedSummary } from '../analysis/cache';
import { analyzeContentV2, VisualAnalysisRequestError } from '../analysis/client';
import { validateVisualSummaryAnchors } from '../analysis/schema';
import { renderBody } from '../core/markdown-renderer';
import { getAiOriginPattern } from '../core/ai-settings';
import { loadSettings } from '../core/settings';
import {
  visualSummaryStateKey,
  type VisualAnalysisError,
  type VisualAnalysisSource,
  type VisualAnalysisState,
  type VisualAnalysisSourceV2,
} from '../analysis/types';
import type { ContentDocument } from '../core/schema';
import type { ExtractVisualSourceResponse } from '../types/messages';

const currentRequestIds = new Map<number, string>();
let requestSequence = 0;

function createRequestId(): string {
  requestSequence += 1;
  return `${Date.now().toString(36)}-${requestSequence.toString(36)}`;
}

/** 该 tabId 当前最新请求是否为 requestId。 */
function isCurrentRequest(tabId: number, requestId: string): boolean {
  return currentRequestIds.get(tabId) === requestId;
}

/** M1：requestId 守卫集中于此——过期请求的任何写入都被丢弃。 */
function writeState(state: VisualAnalysisState): Promise<void> {
  if (!isCurrentRequest(state.tabId, state.requestId)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    chrome.storage.session.set({ [visualSummaryStateKey(state.tabId)]: state }, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

/** 读取当前标签页状态（GET_VISUAL_ANALYSIS_STATE 使用）。 */
export function getVisualAnalysisState(tabId: number): Promise<VisualAnalysisState | null> {
  return new Promise((resolve) => {
    chrome.storage.session.get(visualSummaryStateKey(tabId), (items) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve((items?.[visualSummaryStateKey(tabId)] as VisualAnalysisState | undefined) ?? null);
    });
  });
}

function extractCurrentSource(tabId: number): Promise<ExtractVisualSourceResponse> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_VISUAL_SOURCE' }, (response: ExtractVisualSourceResponse) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else if (response?.success) {
        resolve({ ...response, sourceBlocks: Array.isArray(response.sourceBlocks) ? response.sourceBlocks : [] });
      } else {
        resolve(response);
      }
    });
  });
}

function errorState(
  tabId: number,
  requestId: string,
  error: VisualAnalysisError,
  source?: VisualAnalysisSource | VisualAnalysisSourceV2,
): VisualAnalysisState {
  return { status: 'error', tabId, requestId, error, ...(source ? { source } : {}), updatedAt: Date.now() };
}

function extractSource(document: ContentDocument): VisualAnalysisSourceV2 {
  const name = document.metadata.author.name.trim();
  const handle = document.metadata.author.handle?.trim().replace(/^@/, '');
  const bodyTitle = Array.from(renderBody(document).trim()).slice(0, 50).join('');
  const title = document.metadata.title?.trim()
    || (document.metadata.contentType === 'tweet' ? bodyTitle || '当前推文' : '当前内容');
  return {
    url: document.metadata.sourceUrl,
    title,
    author: { name, ...(handle ? { handle } : {}) },
    platform: document.metadata.platform,
    contentType: document.metadata.contentType,
  };
}

function isXDocument(document: ContentDocument): boolean {
  return document.metadata.platform === 'x';
}

/** 检查运行时 Host 权限是否已授予 AI Endpoint 的 origin。 */
function hasAiHostPermission(endpoint: string): Promise<boolean> {
  const pattern = getAiOriginPattern(endpoint);
  if (pattern === null) return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      chrome.permissions.contains({ origins: [pattern] }, (granted) => {
        if (chrome.runtime.lastError) {
          resolve(false);
          return;
        }
        resolve(granted === true);
      });
    } catch {
      resolve(false);
    }
  });
}

function toAiError(error: unknown): VisualAnalysisError {
  if (error instanceof VisualAnalysisRequestError) {
    return { code: error.code, message: error.message };
  }
  return { code: 'AI_PROVIDER_ERROR', message: 'AI 分析失败，请稍后重试。' };
}

/**
 * 开始一图速览分析。
 * @returns 本次请求的 requestId（供调用方核对/响应消息）。
 */
export async function startVisualAnalysis(
  tabId: number,
  options: { force?: boolean } = {},
): Promise<{ requestId: string }> {
  const requestId = createRequestId();
  currentRequestIds.set(tabId, requestId);

  await writeState({ status: 'extracting', tabId, requestId, updatedAt: Date.now() });

  let extracted: ExtractVisualSourceResponse;
  try {
    extracted = await extractCurrentSource(tabId);
  } catch {
    await writeState(errorState(
      tabId,
      requestId,
      {
        code: 'EXTRACT_FAILED',
        message: '无法读取当前页面。当前版本仅支持 X 推文和 X Article；若已在 X 页面，请确认内容加载完成，刷新后重试。',
      },
    ));
    return { requestId };
  }

  if (!extracted?.success) {
    const detail = extracted?.error?.message || '提取内容失败。';
    await writeState(errorState(
      tabId,
      requestId,
      { code: 'EXTRACT_FAILED', message: `${detail} 请刷新页面或切换到正文后重试。` },
    ));
    return { requestId };
  }

  const { document, sourceBlocks } = extracted;
  if (!isXDocument(document)) {
    await writeState(errorState(
      tabId,
      requestId,
      {
        code: 'UNSUPPORTED_VISUAL_PLATFORM',
        message: '一图速览 V1 仅支持 X / Twitter。当前页面仍然可以继续使用原有 Markdown 保存功能。',
      },
      extractSource(document),
    ));
    return { requestId };
  }

  const source = extractSource(document);

  const settings = await loadSettings();
  const ai = settings.ai;
  if (!ai.enabled || ai.endpoint === '' || ai.apiKey === '' || ai.model === '') {
    await writeState(errorState(
      tabId,
      requestId,
      {
        code: 'AI_NOT_CONFIGURED',
        message: '还没有配置 AI。请先在 Clip2MD 设置中填写 API Endpoint、API Key 和 Model。',
      },
      source,
    ));
    return { requestId };
  }

  const granted = await hasAiHostPermission(ai.endpoint);
  if (!granted) {
    await writeState(errorState(
      tabId,
      requestId,
      {
        code: 'AI_HOST_NOT_GRANTED',
        message: '尚未授权 AI API 域名。请前往设置授权该 API 域名。',
      },
      source,
    ));
    return { requestId };
  }

  const input = buildAnalysisInputV2(document, sourceBlocks);
  const cacheKey = visualSummaryCacheKey(input.sourceUrl, input.body, ai.model, ai.endpoint);

  if (!options.force) {
    const cached = await readCachedSummary(cacheKey);
    if (cached && validateVisualSummaryAnchors(cached, input).length === 0) {
      await writeState({
        status: 'done',
        tabId,
        requestId,
        source,
        result: cached,
        updatedAt: Date.now(),
      });
      return { requestId };
    }
  }

  await writeState({ status: 'analyzing', tabId, requestId, source, updatedAt: Date.now() });

  try {
    const result = await analyzeContentV2(input, ai);
    await writeCachedSummary(cacheKey, result);
    await writeState({
      status: 'done',
      tabId,
      requestId,
      source,
      result,
      updatedAt: Date.now(),
    });
  } catch (error) {
    await writeState(errorState(tabId, requestId, toAiError(error), source));
  }

  return { requestId };
}
