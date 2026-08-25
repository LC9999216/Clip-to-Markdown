export {};
const VISUAL_SUMMARY_COMMAND = 'visual-summary';

type CommandTab = Pick<chrome.tabs.Tab, 'id'>;

interface VisualSummaryChromeApi {
  commands: {
    onCommand: {
      addListener(listener: (command: string, tab?: CommandTab) => void): void;
    };
  };
  tabs: {
    query(
      queryInfo: { active: boolean; currentWindow: boolean },
      callback: (tabs: CommandTab[]) => void,
    ): void;
  };
  sidePanel: {
    open(options: { tabId: number }): Promise<void>;
  };
}

function isValidTabId(tabId: unknown): tabId is number {
  return Number.isInteger(tabId) && (tabId as number) >= 0;
}

function queryActiveTab(api: VisualSummaryChromeApi): Promise<CommandTab | undefined> {
  return new Promise((resolve) => {
    api.tabs.query(
      { active: true, currentWindow: true },
      (tabs) => resolve(tabs[0]),
    );
  });
}

/** Open the panel for the command tab, falling back to the active tab when needed. */
export async function openVisualSummaryPanel(
  commandTab?: CommandTab,
  api: VisualSummaryChromeApi = chrome as VisualSummaryChromeApi,
): Promise<boolean> {
  let tabId = commandTab?.id;

  if (!isValidTabId(tabId)) {
    tabId = (await queryActiveTab(api))?.id;
  }

  if (!isValidTabId(tabId)) return false;

  await api.sidePanel.open({ tabId });
  return true;
}

/** Register only the visual-summary shortcut; existing save listeners stay independent. */
export function installVisualSummaryCommandHandler(
  api: VisualSummaryChromeApi = chrome as VisualSummaryChromeApi,
): void {
  api.commands.onCommand.addListener((command, tab) => {
    if (command !== VISUAL_SUMMARY_COMMAND) return;
    void openVisualSummaryPanel(tab, api).catch((error) => {
      console.error('打开视觉概览失败：', error);
    });
  });
}

// Keep the panel entry non-empty without running extension-only command wiring in the UI page.
if (typeof document !== 'undefined') {
  document.documentElement.dataset.sidePanelReady = 'true';
}
