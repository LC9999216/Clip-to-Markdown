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

  await chrome.sidePanel.open({ tabId });
  return true;
}

async function handleVisualSummaryCommand(commandTab?: chrome.tabs.Tab): Promise<void> {
  const tabId = await resolveTabId(commandTab);
  if (tabId === undefined) return;

  await chrome.sidePanel.open({ tabId });
  await startVisualAnalysis(tabId);
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== VISUAL_SUMMARY_COMMAND) return;
  void handleVisualSummaryCommand(tab).catch((error) => {
    console.error('打开视觉概览失败：', error);
  });
});
