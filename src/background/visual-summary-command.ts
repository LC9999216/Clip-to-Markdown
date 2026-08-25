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

export async function openVisualSummaryPanel(commandTab?: chrome.tabs.Tab): Promise<boolean> {
  let tabId = commandTab?.id;

  if (!isValidTabId(tabId)) {
    tabId = (await queryActiveTab())?.id;
  }

  if (!isValidTabId(tabId)) return false;

  await chrome.sidePanel.open({ tabId });
  return true;
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== VISUAL_SUMMARY_COMMAND) return;
  void openVisualSummaryPanel(tab).catch((error) => {
    console.error('打开视觉概览失败：', error);
  });
});
