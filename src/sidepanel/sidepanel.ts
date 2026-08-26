import { visualSummaryStateKey, type VisualAnalysisState } from '../analysis/types';

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

function renderState(state: VisualAnalysisState | undefined): void {
  const statusLabel = element<HTMLElement>('status-label');
  const statusCopy = element<HTMLElement>('status-copy');
  const preview = element<HTMLElement>('preview');
  preview.hidden = true;

  if (!state) {
    statusLabel.textContent = '等待开始';
    statusCopy.textContent = '使用快捷键打开后，当前 X 内容将在此显示。';
    return;
  }

  if (state.status === 'extracting') {
    statusLabel.textContent = '正在读取当前页面';
    statusCopy.textContent = '正在从当前标签页提取最新内容…';
    return;
  }

  if (state.status === 'analyzing') {
    statusLabel.textContent = 'AI 正在阅读';
    statusCopy.textContent = '正在生成一句话总结、核心观点与内容结构…';
    return;
  }

  if (state.status === 'error') {
    statusLabel.textContent = '暂时无法生成一图速览';
    statusCopy.textContent = state.error?.message ?? '发生未知错误，请重新生成。';
    return;
  }

  const result = state.result;
  if (!result) {
    statusLabel.textContent = '内容已提取';
    statusCopy.textContent = '分析结果尚未生成，请点击「重新生成」。';
    return;
  }

  statusLabel.textContent = '内容已分析';
  statusCopy.textContent = result.summary;
  element<HTMLElement>('preview-type').textContent = '一图速览';
  element<HTMLElement>('preview-title').textContent = state.source?.title || '当前内容';
  element<HTMLElement>('preview-author').textContent = state.source?.author || '作者信息未提供';
  element<HTMLElement>('preview-body').textContent = result.summary;
  const link = element<HTMLAnchorElement>('preview-link');
  link.href = state.source?.url ?? '';
  link.textContent = '查看原文';
  preview.hidden = false;
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
      renderState(change.newValue as VisualAnalysisState | undefined);
    }
  };

  const onTabActivated = ({ tabId }: chrome.tabs.OnActivatedInfo): void => {
    currentTabId = tabId;
    stateVersion += 1;
    const versionAtRead = stateVersion;
    renderState(undefined);
    void readState(tabId).then((state) => {
      if (currentTabId === tabId && stateVersion === versionAtRead) renderState(state);
    });
  };

  chrome.storage.onChanged.addListener(onStorageChanged);
  chrome.tabs.onActivated.addListener(onTabActivated);

  if (currentTabId === undefined) {
    renderState(undefined);
  } else {
    const initialTabId = currentTabId;
    const versionAtRead = stateVersion;
    const state = await readState(initialTabId);
    if (currentTabId === initialTabId && stateVersion === versionAtRead) renderState(state);
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
