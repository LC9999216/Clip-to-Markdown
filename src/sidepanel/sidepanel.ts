/**
 * Side Panel：读取/监听一图速览状态并渲染结果。
 *
 * 约束：
 * - 所有 AI 内容（总结、观点、树节点、结论）一律用 createElement + textContent，
 *   绝不使用 innerHTML；
 * - 只显示 source 元数据与校验后的 VisualSummary，正文不落 DOM；
 * - 「重新生成」通过消息请求 force:true；「AI 设置」打开 Options 页。
 */

import {
  visualSummaryStateKey,
  type ArticleType,
  type VisualAnalysisState,
  type VisualSummary,
} from '../analysis/types';
import { renderTree } from './tree-renderer';

const ARTICLE_TYPE_LABELS: Record<ArticleType, string> = {
  opinion: '观点',
  tutorial: '教程',
  news: '新闻',
  comparison: '对比',
  technical: '技术',
  list: '列表',
  other: '其他',
};

/** 需要跳转设置页解决的错误码；其余错误允许「重新生成」。 */
const CONFIG_ERROR_CODES = new Set(['AI_NOT_CONFIGURED', 'AI_HOST_NOT_GRANTED', 'AI_AUTH_FAILED']);

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Side Panel 缺少元素 #${id}`);
  return value as T;
}

function queryActiveTabId(): Promise<number | undefined> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) resolve(undefined);
      else resolve(tabs[0]?.id);
    });
  });
}

function readState(tabId: number): Promise<VisualAnalysisState | undefined> {
  const key = visualSummaryStateKey(tabId);
  return new Promise((resolve) => {
    chrome.storage.session.get(key, (items) => {
      if (chrome.runtime.lastError) resolve(undefined);
      else resolve(items[key] as VisualAnalysisState | undefined);
    });
  });
}

/** 请求 Background 开始分析（force:true 绕过会话缓存）。 */
function sendStartAnalysis(tabId: number, force: boolean): void {
  chrome.runtime.sendMessage({ type: 'START_VISUAL_ANALYSIS', payload: { tabId, force } });
}

function openSettings(): void {
  chrome.runtime.openOptionsPage();
}

function renderKeyPoints(container: HTMLElement, points: VisualSummary['keyPoints']): void {
  container.replaceChildren();
  const list = document.createElement('ul');
  list.className = 'keypoints';
  for (const point of points) {
    const item = document.createElement('li');
    const title = document.createElement('span');
    title.className = 'keypoint-title';
    title.textContent = point.title;
    const desc = document.createElement('span');
    desc.className = 'keypoint-desc';
    desc.textContent = point.description;
    item.append(title, desc);
    list.appendChild(item);
  }
  container.appendChild(list);
}

function renderTakeaways(container: HTMLElement, takeaways: string[]): void {
  container.replaceChildren();
  const list = document.createElement('ul');
  list.className = 'takeaways';
  for (const takeaway of takeaways) {
    const item = document.createElement('li');
    item.textContent = takeaway;
    list.appendChild(item);
  }
  container.appendChild(list);
}

function renderResult(state: VisualAnalysisState, tabId: number): void {
  const result = state.result;
  if (!result) return;

  element<HTMLElement>('status-label').textContent = '内容已分析';
  element<HTMLElement>('status-copy').textContent = result.summary;
  element<HTMLElement>('preview-type').textContent =
    ARTICLE_TYPE_LABELS[result.articleType] ?? '其他';
  element<HTMLElement>('preview-confidence').textContent = `${Math.round(result.confidence * 100)}%`;
  element<HTMLElement>('preview-title').textContent = state.source?.title || '当前内容';
  element<HTMLElement>('preview-author').textContent = state.source?.author || '作者信息未提供';
  element<HTMLElement>('preview-body').textContent = result.summary;

  const link = element<HTMLAnchorElement>('preview-link');
  link.href = state.source?.url ?? '';
  link.textContent = '查看原文';

  renderKeyPoints(element<HTMLElement>('keypoints'), result.keyPoints);
  const structure = element<HTMLElement>('structure');
  structure.replaceChildren();
  structure.appendChild(renderTree(result.structure));
  renderTakeaways(element<HTMLElement>('takeaways'), result.takeaways);

  const regenerate = element<HTMLButtonElement>('action-regenerate');
  regenerate.onclick = () => sendStartAnalysis(tabId, true);
  element<HTMLButtonElement>('action-settings').onclick = openSettings;

  element<HTMLElement>('preview').hidden = false;
}

function renderError(state: VisualAnalysisState, tabId: number | undefined): void {
  element<HTMLElement>('status-label').textContent = '暂时无法生成一图速览';
  element<HTMLElement>('status-copy').textContent = state.error?.message ?? '发生未知错误，请重新生成。';

  const statusActions = element<HTMLElement>('status-actions');
  const statusAction = element<HTMLButtonElement>('status-action');
  statusActions.hidden = true;

  if (tabId === undefined) return;
  if (state.error?.code && CONFIG_ERROR_CODES.has(state.error.code)) {
    statusActions.hidden = false;
    statusAction.textContent = '打开 AI 设置';
    statusAction.onclick = openSettings;
  } else {
    statusActions.hidden = false;
    statusAction.textContent = '重新生成';
    statusAction.onclick = () => sendStartAnalysis(tabId, true);
  }
}

function renderState(state: VisualAnalysisState | undefined, tabId: number | undefined): void {
  const preview = element<HTMLElement>('preview');
  preview.hidden = true;
  element<HTMLElement>('status-actions').hidden = true;

  if (!state) {
    element<HTMLElement>('status-label').textContent = '等待开始';
    element<HTMLElement>('status-copy').textContent = '使用快捷键打开后，当前 X 内容将在此显示。';
    return;
  }

  if (state.status === 'extracting') {
    element<HTMLElement>('status-label').textContent = '正在读取当前页面';
    element<HTMLElement>('status-copy').textContent = '正在从当前标签页提取最新内容…';
    return;
  }

  if (state.status === 'analyzing') {
    element<HTMLElement>('status-label').textContent = 'AI 正在阅读';
    element<HTMLElement>('status-copy').textContent = '正在生成一句话总结、核心观点与内容结构…';
    return;
  }

  if (state.status === 'error') {
    renderError(state, tabId);
    return;
  }

  if (tabId === undefined) return;
  renderResult(state, tabId);
}

export async function initializeSidePanel(): Promise<() => void> {
  document.documentElement.dataset.sidePanelReady = 'true';
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
      renderState(change.newValue as VisualAnalysisState | undefined, currentTabId);
    }
  };

  const onTabActivated = ({ tabId }: chrome.tabs.OnActivatedInfo): void => {
    currentTabId = tabId;
    stateVersion += 1;
    const versionAtRead = stateVersion;
    renderState(undefined, currentTabId);
    void readState(tabId).then((state) => {
      if (currentTabId === tabId && stateVersion === versionAtRead) renderState(state, currentTabId);
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
    if (currentTabId === initialTabId && stateVersion === versionAtRead) renderState(state, currentTabId);
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
