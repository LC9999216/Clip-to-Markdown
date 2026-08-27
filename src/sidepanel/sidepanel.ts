/** Side Panel V2: render the source metadata and source-linked visual summary. */

import {
  visualSummaryStateKey,
  type VisualAnalysisState,
  type VisualKeyPoint,
  type VisualSummary,
  type VisualSummaryV2,
  type VisualStructureItem,
} from '../analysis/types';
import { renderStructure } from './structure-renderer';

const CONFIG_ERROR_CODES = new Set(['AI_NOT_CONFIGURED', 'AI_HOST_NOT_GRANTED', 'AI_AUTH_FAILED']);

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Side Panel 缺少元素 #${id}`);
  return value as T;
}

function queryActiveTabId(): Promise<number | undefined> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(chrome.runtime.lastError ? undefined : tabs[0]?.id);
    });
  });
}

function readState(tabId: number): Promise<VisualAnalysisState | undefined> {
  const key = visualSummaryStateKey(tabId);
  return new Promise((resolve) => {
    chrome.storage.session.get(key, (items) => {
      resolve(chrome.runtime.lastError ? undefined : items[key] as VisualAnalysisState | undefined);
    });
  });
}

function sendStartAnalysis(tabId: number, force: boolean): void {
  chrome.runtime.sendMessage({ type: 'START_VISUAL_ANALYSIS', payload: { tabId, force } });
}

function openSettings(): void {
  chrome.runtime.openOptionsPage();
}

function formatPlatform(source: VisualAnalysisState['source']): string {
  if (!source || !('platform' in source) || typeof source.platform !== 'string') return '';
  return source.platform === 'x' ? 'X / Twitter' : source.platform;
}

function formatAuthor(source: VisualAnalysisState['source']): { name: string; handle: string } {
  if (!source) return { name: '作者信息未提供', handle: '' };
  if (typeof source.author === 'string') return { name: source.author, handle: '' };
  if (!source.author) return { name: '作者信息未提供', handle: '' };
  return { name: source.author.name, handle: source.author.handle ? `@${source.author.handle}` : '' };
}

function isVisualSummaryV2(result: VisualSummary | VisualSummaryV2): result is VisualSummaryV2 {
  return result.schemaVersion === 2
    && Array.isArray(result.summary)
    && result.summary.length === 2
    && Array.isArray(result.keyPoints)
    && Array.isArray(result.structure);
}

function renderSummary(container: HTMLElement, summary: [string, string]): void {
  container.replaceChildren();
  for (const lineText of summary) {
    const line = document.createElement('p');
    line.className = 'summary-line';
    line.textContent = lineText;
    container.appendChild(line);
  }
}

function renderKeyPoints(container: HTMLElement, points: VisualKeyPoint[]): void {
  container.replaceChildren();
  const list = document.createElement('ul');
  list.className = 'keypoints-list';
  points.forEach((point, index) => {
    const item = document.createElement('li');
    const number = document.createElement('span');
    number.className = 'keypoint-index';
    number.textContent = String(index + 1).padStart(2, '0');
    const title = document.createElement('span');
    title.className = 'keypoint-title';
    title.textContent = point.title;
    const dash = document.createElement('span');
    dash.className = 'keypoint-dash';
    dash.textContent = '—';
    const description = document.createElement('span');
    description.className = 'keypoint-desc';
    description.textContent = point.description;
    item.append(number, title, dash, description);
    list.appendChild(item);
  });
  container.appendChild(list);
}

type AnchoredStructureItem = Extract<VisualStructureItem, { sourceBlockId: string; sourceQuote: string }>;

function sendNavigateRequest(
  tabId: number,
  sourceUrl: string,
  item: AnchoredStructureItem,
  isCurrentTab: () => boolean,
): void {
  const status = element<HTMLElement>('navigation-status');
  status.textContent = '正在定位原文…';
  let settled = false;
  const finish = (message: string): void => {
    if (settled || !isCurrentTab()) return;
    settled = true;
    status.textContent = message;
  };
  const callback = (response: unknown): void => {
    if (chrome.runtime.lastError) {
      finish(`无法定位原文：${chrome.runtime.lastError.message}`);
      return;
    }
    const result = response as { success?: boolean; error?: { message?: string } } | undefined;
    if (result?.success === true) finish('已定位到原文。');
    else finish(`无法定位原文：${result?.error?.message ?? '当前页面未找到对应内容。'}`);
  };
  const sendMessage = chrome.tabs.sendMessage as unknown as (
    tab: number,
    message: unknown,
    callback?: (response: unknown) => void,
  ) => unknown;
  try {
    const result = sendMessage(tabId, {
      type: 'NAVIGATE_TO_SOURCE',
      payload: { expectedSourceUrl: sourceUrl, sourceBlockId: item.sourceBlockId, sourceQuote: item.sourceQuote },
    }, callback);
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      void Promise.resolve(result).then(callback, (error: unknown) => {
        finish(`无法定位原文：${error instanceof Error ? error.message : String(error)}`);
      });
    }
  } catch (error) {
    finish(`无法定位原文：${error instanceof Error ? error.message : String(error)}`);
  }
}

function openSource(tabUrl: string): void {
  chrome.tabs.create({ url: tabUrl, active: true }, () => {
    // Reading lastError keeps Chrome callback errors from becoming uncaught warnings.
    void chrome.runtime.lastError;
  });
}

function sendSaveRequest(tabId: number, isCurrentTab: () => boolean): void {
  const button = element<HTMLButtonElement>('action-save');
  const status = element<HTMLElement>('save-status');
  button.disabled = true;
  button.textContent = '保存中…';
  chrome.runtime.sendMessage({ type: 'SAVE_CURRENT_TAB', payload: { tabId } }, (response: unknown) => {
    if (!isCurrentTab()) return;
    if (chrome.runtime.lastError) {
      status.textContent = `保存失败：${chrome.runtime.lastError.message}`;
    } else {
      const result = response as { success?: boolean; filename?: string; error?: string } | undefined;
      status.textContent = result?.success
        ? `已保存：${result.filename ?? ''}`
        : `保存失败：${result?.error ?? '未知错误'}`;
    }
    button.disabled = false;
    button.textContent = '保存 Markdown';
  });
}

function wireStaticActions(): void {
  element<HTMLButtonElement>('action-settings').onclick = openSettings;
}

function renderLegacyStateNotice(tabId: number): void {
  element<HTMLElement>('status-card').hidden = false;
  element<HTMLElement>('status-label').textContent = '结果版本已更新';
  element<HTMLElement>('status-copy').textContent = '当前结果不是 V2 格式，请重新生成。';
  const actions = element<HTMLElement>('status-actions');
  const action = element<HTMLButtonElement>('status-action');
  actions.hidden = false;
  action.textContent = '重新生成';
  action.onclick = () => sendStartAnalysis(tabId, true);
  element<HTMLElement>('preview').hidden = true;
}

function renderResult(state: VisualAnalysisState, tabId: number, isCurrentTab: () => boolean): void {
  const result = state.result;
  if (!result) return;
  if (!isVisualSummaryV2(result)) {
    renderLegacyStateNotice(tabId);
    return;
  }

  const source = state.source;
  const sourceUrl = source?.url ?? '';
  const author = formatAuthor(source);
  element<HTMLElement>('status-label').textContent = '内容已分析';
  element<HTMLElement>('status-copy').textContent = '已生成可阅读的一图速览。';
  element<HTMLElement>('status-card').hidden = true;
  element<HTMLElement>('preview').hidden = false;
  element<HTMLElement>('preview-title').textContent = source?.title || '当前内容';
  element<HTMLElement>('preview-author').textContent = author.name;
  element<HTMLElement>('preview-handle').textContent = author.handle;
  element<HTMLElement>('preview-platform').textContent = formatPlatform(source);
  renderSummary(element<HTMLElement>('summary-lines'), result.summary);
  renderKeyPoints(element<HTMLElement>('keypoints'), result.keyPoints);
  renderStructure(element<HTMLElement>('structure'), result.structure, (item) => {
    sendNavigateRequest(tabId, sourceUrl, item, isCurrentTab);
  });

  element<HTMLButtonElement>('action-open-source').onclick = () => openSource(sourceUrl);
  element<HTMLButtonElement>('action-regenerate').onclick = () => sendStartAnalysis(tabId, true);
  element<HTMLButtonElement>('action-save').onclick = () => sendSaveRequest(tabId, isCurrentTab);
}

function renderError(state: VisualAnalysisState, tabId: number | undefined): void {
  element<HTMLElement>('status-card').hidden = false;
  element<HTMLElement>('status-label').textContent = '暂时无法生成一图速览';
  element<HTMLElement>('status-copy').textContent = state.error?.message ?? '发生未知错误，请重新生成。';
  const actions = element<HTMLElement>('status-actions');
  const action = element<HTMLButtonElement>('status-action');
  actions.hidden = tabId === undefined;
  if (tabId === undefined) return;
  if (state.error?.code && CONFIG_ERROR_CODES.has(state.error.code)) {
    action.textContent = '打开 AI 设置';
    action.onclick = openSettings;
  } else {
    action.textContent = '重新生成';
    action.onclick = () => sendStartAnalysis(tabId, true);
  }
}

function renderState(
  state: VisualAnalysisState | undefined,
  tabId: number | undefined,
  isCurrentTab: () => boolean = () => true,
): void {
  element<HTMLElement>('preview').hidden = true;
  element<HTMLElement>('status-card').hidden = false;
  element<HTMLElement>('status-actions').hidden = true;
  element<HTMLElement>('navigation-status').textContent = '';
  element<HTMLElement>('save-status').textContent = '';
  const saveButton = element<HTMLButtonElement>('action-save');
  saveButton.disabled = false;
  saveButton.textContent = '保存 Markdown';
  if (!state) {
    element<HTMLElement>('status-label').textContent = '等待开始';
    element<HTMLElement>('status-copy').textContent = '打开侧栏后，当前 X 内容将在此显示。';
    return;
  }
  if (state.status === 'extracting') {
    element<HTMLElement>('status-label').textContent = '正在读取当前页面';
    element<HTMLElement>('status-copy').textContent = '正在从当前标签页提取最新内容…';
    return;
  }
  if (state.status === 'analyzing') {
    element<HTMLElement>('status-label').textContent = 'AI 正在阅读';
    element<HTMLElement>('status-copy').textContent = '正在生成两句话总结、核心观点与内容结构…';
    return;
  }
  if (state.status === 'error') {
    renderError(state, tabId);
    return;
  }
  if (tabId !== undefined) renderResult(state, tabId, isCurrentTab);
}

export async function initializeSidePanel(): Promise<() => void> {
  document.documentElement.dataset.sidePanelReady = 'true';
  wireStaticActions();
  let currentTabId = await queryActiveTabId();
  let stateVersion = 0;

  const onStorageChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: chrome.storage.AreaName,
  ): void => {
    if (areaName !== 'session' || currentTabId === undefined) return;
    const change = changes[visualSummaryStateKey(currentTabId)];
    if (change) {
      stateVersion += 1;
      const targetTabId = currentTabId;
      renderState(change.newValue as VisualAnalysisState | undefined, targetTabId, () => currentTabId === targetTabId);
    }
  };

  const onTabActivated = ({ tabId }: chrome.tabs.OnActivatedInfo): void => {
    currentTabId = tabId;
    stateVersion += 1;
    const versionAtRead = stateVersion;
    renderState(undefined, tabId, () => currentTabId === tabId);
    void readState(tabId).then((state) => {
      if (currentTabId === tabId && stateVersion === versionAtRead) {
        renderState(state, tabId, () => currentTabId === tabId);
      }
    });
  };

  chrome.storage.onChanged.addListener(onStorageChanged);
  chrome.tabs.onActivated.addListener(onTabActivated);

  if (currentTabId === undefined) {
    renderState(undefined, undefined);
  } else {
    const initialTabId = currentTabId;
    const versionAtRead = stateVersion;
    const state = await readState(initialTabId);
    if (currentTabId === initialTabId && stateVersion === versionAtRead) {
      renderState(state, currentTabId, () => currentTabId === initialTabId);
    }
  }

  return () => {
    chrome.storage.onChanged.removeListener(onStorageChanged);
    chrome.tabs.onActivated.removeListener(onTabActivated);
  };
}

function boot(): void {
  if (!document.getElementById('status-label')) return;
  void initializeSidePanel();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
