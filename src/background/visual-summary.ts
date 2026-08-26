import { buildAnalysisInput } from '../analysis/input';
import { visualSummaryStateKey, type VisualAnalysisState } from '../analysis/types';
import type { ExtractResponse } from '../types/messages';

const currentRequestIds = new Map<number, string>();
let requestSequence = 0;

function createRequestId(): string {
  requestSequence += 1;
  return `${Date.now().toString(36)}-${requestSequence.toString(36)}`;
}

function isCurrentRequest(tabId: number, requestId: string): boolean {
  return currentRequestIds.get(tabId) === requestId;
}

function writeState(state: VisualAnalysisState): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.session.set({ [visualSummaryStateKey(state.tabId)]: state }, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function extractCurrentDocument(tabId: number): Promise<ExtractResponse> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: 'EXTRACT' }, (response: ExtractResponse) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response);
    });
  });
}

function errorState(tabId: number, requestId: string, error: string): VisualAnalysisState {
  return { status: 'error', tabId, requestId, updatedAt: Date.now(), error };
}

export async function startVisualSummaryPreview(tabId: number): Promise<void> {
  const requestId = createRequestId();
  currentRequestIds.set(tabId, requestId);
  await writeState({ status: 'extracting', tabId, requestId, updatedAt: Date.now() });

  let extracted: ExtractResponse;
  try {
    extracted = await extractCurrentDocument(tabId);
  } catch {
    if (!isCurrentRequest(tabId, requestId)) return;
    await writeState(errorState(
      tabId,
      requestId,
      '无法读取当前页面。当前版本仅支持 X 推文和 X Article；若已在 X 页面，请确认内容加载完成，刷新后重试。',
    ));
    return;
  }

  if (!isCurrentRequest(tabId, requestId)) return;

  if (!extracted?.success) {
    const detail = extracted?.error?.message || '提取内容失败。';
    await writeState(errorState(tabId, requestId, `${detail} 请刷新页面或切换到正文后重试。`));
    return;
  }

  const { document } = extracted;
  if (
    document.metadata.platform !== 'x'
    || (document.metadata.contentType !== 'tweet' && document.metadata.contentType !== 'x-article')
  ) {
    await writeState(errorState(
      tabId,
      requestId,
      '当前版本仅支持 X 推文和 X Article。请切换到受支持的 X 内容后重试。',
    ));
    return;
  }

  const input = buildAnalysisInput(document);
  await writeState({
    status: 'done',
    tabId,
    requestId,
    updatedAt: Date.now(),
    preview: {
      title: input.title,
      author: input.author,
      body: input.body.slice(0, 300),
      contentType: document.metadata.contentType,
      sourceUrl: input.sourceUrl,
    },
  });
}
