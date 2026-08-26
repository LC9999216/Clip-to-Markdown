import { startVisualAnalysis } from './visual-summary';

const VISUAL_SUMMARY_COMMAND = 'visual-summary';

function isValidTabId(tabId: unknown): tabId is number {
  return Number.isInteger(tabId) && (tabId as number) >= 0;
}

function queryActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query(
        { active: true, currentWindow: true },
        (tabs) => {
          if (chrome.runtime.lastError || !Array.isArray(tabs)) {
            resolve(undefined);
            return;
          }
          resolve(tabs[0]);
        },
      );
    } catch {
      resolve(undefined);
    }
  });
}

async function resolveTabId(commandTab?: chrome.tabs.Tab): Promise<number | undefined> {
  const commandTabId = commandTab?.id;
  if (isValidTabId(commandTabId)) return commandTabId;
  const activeTabId = (await queryActiveTab())?.id;
  return isValidTabId(activeTabId) ? activeTabId : undefined;
}

export async function openVisualSummaryPanel(commandTab?: chrome.tabs.Tab): Promise<boolean> {
  const tabId = await resolveTabId(commandTab);
  if (tabId === undefined) return false;

  await openSidePanel(tabId);
  return true;
}

function notifyPanelOpenFailure(): void {
  try {
    chrome.notifications.create(
      {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
        title: '一图速览无法打开',
        message: '侧栏未能打开，请在 X/Twitter 内容页重试，或点击浏览器侧边栏图标打开。',
      },
      () => {
        const error = chrome.runtime.lastError;
        if (error) console.error('一图速览通知失败：', error.message);
      },
    );
  } catch (error) {
    console.error('一图速览通知不可用：', String(error));
  }
}

function openSidePanel(tabId: number): Promise<void> {
  try {
    // Invoke this synchronously from the command callback so Chrome retains the user gesture.
    return Promise.resolve(chrome.sidePanel.open({ tabId })).catch((error) => {
      notifyPanelOpenFailure();
      throw error;
    });
  } catch (error) {
    notifyPanelOpenFailure();
    return Promise.reject(error);
  }
}

function openPanelAndAnalyze(tabId: number): void {
  void openSidePanel(tabId)
    .then(() => startVisualAnalysis(tabId))
    .catch((error) => {
      console.error('打开视觉概览失败：', error);
    });
}

async function handleVisualSummaryCommand(commandTab?: chrome.tabs.Tab): Promise<void> {
  const commandTabId = commandTab?.id;
  if (isValidTabId(commandTabId)) {
    openPanelAndAnalyze(commandTabId);
    return;
  }

  const tabId = await resolveTabId(commandTab);
  if (tabId !== undefined) openPanelAndAnalyze(tabId);
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== VISUAL_SUMMARY_COMMAND) return;
  void handleVisualSummaryCommand(tab).catch((error) => {
    console.error('打开视觉概览失败：', error);
  });
});
