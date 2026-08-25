/**
 * Vitest 全局测试基建。
 * - jsdom 环境补齐 chrome.* API shim（后续测试会断言调用记录）
 * - 补齐 jsdom 未实现的 window.scrollTo/scrollBy
 */
import { vi, beforeEach } from 'vitest';

// ---- window 补丁 ----
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
window.scrollBy = vi.fn() as unknown as typeof window.scrollBy;

// ---- chrome.* shim ----
// 暴露可断言的数据结构，供各测试引用
export const chromeCalls = {
  downloads: [] as Array<{ url: string; filename: string; saveAs: boolean }>,
  tabsQueried: [] as Array<{ active: boolean; currentWindow: boolean }>,
  notifications: [] as Array<{ title: string; message: string }>,
  offscreenCreated: 0,
  tabsCreated: [] as Array<{ url: string }>,
  badgeText: [] as string[],
  badgeColor: [] as string[],
  sidePanelOpens: [] as Array<{ tabId: number }>,
};

/** 测试可读写的 mock 存储：storage.local 的 get/set 都反映到这个对象 */
export const mockStoredSettings: Record<string, unknown> = {};
export const mockSessionStorage: Record<string, unknown> = {};

type MessageListener = (
  msg: unknown,
  sender: unknown,
  sendResponse: (resp: unknown) => void,
) => boolean | void;

const runtimeListeners: MessageListener[] = [];
const storageChangeListeners: Array<(
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: chrome.storage.AreaName,
) => void> = [];
const tabActivatedListeners: Array<(activeInfo: chrome.tabs.OnActivatedInfo) => void> = [];
let currentLastError: { message: string } | null = null;

/** 测试中模拟 chrome.runtime.lastError（如「Receiving end does not exist」） */
export function setRuntimeLastError(message: string | null): void {
  currentLastError = message ? { message } : null;
}

function sendResponseSafe(listener: MessageListener, msg: unknown, sender: unknown): Promise<unknown> | null {
  let resolve: (v: unknown) => void = () => {};
  const responsePromise = new Promise<unknown>((r) => {
    resolve = r;
  });
  let responded = false;
  const sendResponse = (resp: unknown) => {
    if (responded) return;
    responded = true;
    resolve(resp);
  };
  const keepChannel = listener(msg, sender, sendResponse);
  if (keepChannel === true) return responsePromise; // 异步通道：等待 sendResponse
  if (responded) return responsePromise; // 同步已响应
  return null; // 未处理
}

// 供测试触发 content/background 的 onMessage 监听
export async function dispatchRuntimeMessage(msg: unknown, sender: unknown = {}): Promise<unknown | undefined> {
  for (const l of [...runtimeListeners]) {
    const resp = sendResponseSafe(l, msg, sender);
    if (resp) return resp;
  }
  return undefined;
}

// ---- 各 API 的 mock（导出便于测试按需配置）----

export const runtimeSendMessageMock = vi.fn();
export const notificationsCreateMock = vi.fn(
  (options: { title?: string; message?: string }, cb?: (id: string) => void) => {
    currentLastError = null; // 模拟「本次调用成功」的 lastError 作用域
    chromeCalls.notifications.push({ title: options.title ?? '', message: options.message ?? '' });
    if (cb) cb('notification-1');
  },
);

function defaultTabsQuery(opts: unknown, cb?: (tabs: chrome.tabs.Tab[]) => void): unknown {
  currentLastError = null;
  chromeCalls.tabsQueried.push(opts as { active: boolean; currentWindow: boolean });
  const tabs = [{ id: 1, active: true }] as chrome.tabs.Tab[];
  if (cb) cb(tabs);
  return tabs as unknown;
}

export const tabsQueryMock = vi.fn(defaultTabsQuery);

// 把 tabs.sendMessage 路由到 runtime.onMessage 监听（让 EXTRACT 能回读 fixture）
function defaultTabsSendMessage(
  tabId: number,
  msg: unknown,
  cb?: (resp: unknown) => void,
): void {
  const sender = { tab: { id: tabId } };
  const result = dispatchRuntimeMessage(msg, sender);
  if (result && typeof (result as Promise<unknown>).then === 'function') {
    (result as Promise<unknown>).then((resp) => {
      currentLastError = null;
      cb?.(resp);
    });
  } else {
    currentLastError = { message: 'Could not establish connection. Receiving end does not exist.' };
    cb?.(undefined);
  }
}

export const tabsSendMessageMock = vi.fn(defaultTabsSendMessage);

export function dispatchStorageChange(
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: chrome.storage.AreaName = 'session',
): void {
  for (const listener of [...storageChangeListeners]) listener(changes, areaName);
}

export function dispatchTabActivated(tabId: number, windowId = 1): void {
  for (const listener of [...tabActivatedListeners]) listener({ tabId, windowId });
}

export const offscreenHasDocumentMock = vi.fn(async () => false);
export const offscreenCreateDocumentMock = vi.fn(async () => {
  chromeCalls.offscreenCreated += 1;
});
export const offscreenCloseDocumentMock = vi.fn(async () => {});

export const commandsGetAllMock = vi.fn(async () => [] as chrome.commands.Command[]);
export const tabsCreateMock = vi.fn((opts: { url?: string }, cb?: () => void) => {
  chromeCalls.tabsCreated.push({ url: opts.url ?? '' });
  if (cb) cb();
});

export const sidePanelOpenMock = vi.fn(async (opts: { tabId: number }) => {
  chromeCalls.sidePanelOpens.push(opts);
});

export const setBadgeTextMock = vi.fn((details: { text?: string }) => {
  chromeCalls.badgeText.push(details.text ?? '');
  return Promise.resolve();
});
export const setBadgeBackgroundColorMock = vi.fn((details: { color?: string }) => {
  chromeCalls.badgeColor.push(details.color ?? '');
  return Promise.resolve();
});

const commandListeners: Array<(command: string, tab?: chrome.tabs.Tab) => void> = [];

/** 供测试触发 chrome.commands.onCommand 监听 */
export function dispatchCommand(command: string, tab?: chrome.tabs.Tab): void {
  for (const l of [...commandListeners]) l(command, tab);
}

const chromeMock = {
  runtime: {
    id: 'test-extension-id',
    get lastError() {
      return currentLastError;
    },
    getURL: (path: string) => `chrome-extension://test-extension-id/${path}`,
    getManifest: () => ({ version: '0.2.0' }),
    onMessage: {
      addListener: (l: MessageListener) => runtimeListeners.push(l),
      removeListener: (l: MessageListener) => {
        const i = runtimeListeners.indexOf(l);
        if (i >= 0) runtimeListeners.splice(i, 1);
      },
    },
    sendMessage: runtimeSendMessageMock,
  },
  tabs: {
    query: tabsQueryMock,
    sendMessage: tabsSendMessageMock,
    create: tabsCreateMock,
    onActivated: {
      addListener: (listener: (activeInfo: chrome.tabs.OnActivatedInfo) => void) => {
        tabActivatedListeners.push(listener);
      },
      removeListener: (listener: (activeInfo: chrome.tabs.OnActivatedInfo) => void) => {
        const index = tabActivatedListeners.indexOf(listener);
        if (index >= 0) tabActivatedListeners.splice(index, 1);
      },
    },
  },
  storage: {
    local: {
      get: vi.fn((keys: unknown, cb?: (items: Record<string, unknown>) => void) => {
        const items: Record<string, unknown> = {};
        if (typeof keys === 'string') {
          items[keys] = mockStoredSettings[keys];
        } else if (Array.isArray(keys)) {
          for (const k of keys as string[]) items[k] = mockStoredSettings[k];
        } else if (keys && typeof keys === 'object') {
          const defaults = keys as Record<string, unknown>;
          for (const k of Object.keys(defaults)) {
            items[k] = k in mockStoredSettings ? mockStoredSettings[k] : defaults[k];
          }
        }
        if (cb) cb(items);
      }),
      set: vi.fn((items: Record<string, unknown>, cb?: () => void) => {
        Object.assign(mockStoredSettings, items);
        if (cb) cb();
      }),
    },
    session: {
      get: vi.fn((keys: unknown, cb?: (items: Record<string, unknown>) => void) => {
        currentLastError = null;
        const items: Record<string, unknown> = {};
        if (typeof keys === 'string') {
          items[keys] = mockSessionStorage[keys];
        } else if (Array.isArray(keys)) {
          for (const key of keys as string[]) items[key] = mockSessionStorage[key];
        } else if (keys && typeof keys === 'object') {
          const defaults = keys as Record<string, unknown>;
          for (const key of Object.keys(defaults)) {
            items[key] = key in mockSessionStorage ? mockSessionStorage[key] : defaults[key];
          }
        }
        cb?.(items);
      }),
      set: vi.fn((items: Record<string, unknown>, cb?: () => void) => {
        currentLastError = null;
        const changes: Record<string, chrome.storage.StorageChange> = {};
        for (const [key, value] of Object.entries(items)) {
          changes[key] = { oldValue: mockSessionStorage[key], newValue: value };
          mockSessionStorage[key] = value;
        }
        cb?.();
        dispatchStorageChange(changes, 'session');
      }),
    },
    onChanged: {
      addListener: (listener: (
        changes: Record<string, chrome.storage.StorageChange>,
        areaName: chrome.storage.AreaName,
      ) => void) => storageChangeListeners.push(listener),
      removeListener: (listener: (
        changes: Record<string, chrome.storage.StorageChange>,
        areaName: chrome.storage.AreaName,
      ) => void) => {
        const index = storageChangeListeners.indexOf(listener);
        if (index >= 0) storageChangeListeners.splice(index, 1);
      },
    },
  },
  downloads: {
    download: vi.fn(
      (options: { url: string; filename?: string; saveAs?: boolean }, cb?: (id: number) => void) => {
        currentLastError = null; // 模拟「本次调用成功」的 lastError 作用域
        chromeCalls.downloads.push({
          url: options.url,
          filename: options.filename ?? '',
          saveAs: options.saveAs === true,
        });
        if (cb) cb(1);
        return 1;
      },
    ),
  },
  notifications: {
    create: notificationsCreateMock,
  },
  action: {
    setBadgeText: setBadgeTextMock,
    setBadgeBackgroundColor: setBadgeBackgroundColorMock,
  },
  commands: {
    onCommand: {
      addListener: (l: (command: string, tab?: chrome.tabs.Tab) => void) => commandListeners.push(l),
      removeListener: (l: (command: string, tab?: chrome.tabs.Tab) => void) => {
        const i = commandListeners.indexOf(l);
        if (i >= 0) commandListeners.splice(i, 1);
      },
    },
    getAll: commandsGetAllMock,
  },
  sidePanel: {
    open: sidePanelOpenMock,
  },
  offscreen: {
    hasDocument: offscreenHasDocumentMock,
    createDocument: offscreenCreateDocumentMock,
    closeDocument: offscreenCloseDocumentMock,
  },
};

export const sessionGetMock = chromeMock.storage.session.get;

beforeEach(() => {
  chromeCalls.downloads.length = 0;
  chromeCalls.tabsQueried.length = 0;
  chromeCalls.notifications.length = 0;
  chromeCalls.offscreenCreated = 0;
  chromeCalls.tabsCreated.length = 0;
  chromeCalls.badgeText.length = 0;
  chromeCalls.badgeColor.length = 0;
  chromeCalls.sidePanelOpens.length = 0;
  currentLastError = null;
  tabsQueryMock.mockReset();
  tabsQueryMock.mockImplementation(defaultTabsQuery);
  tabsSendMessageMock.mockReset();
  tabsSendMessageMock.mockImplementation(defaultTabsSendMessage);
  sidePanelOpenMock.mockReset();
  sidePanelOpenMock.mockImplementation(async (opts: { tabId: number }) => {
    chromeCalls.sidePanelOpens.push(opts);
  });
  for (const k of Object.keys(mockStoredSettings)) delete mockStoredSettings[k];
  for (const k of Object.keys(mockSessionStorage)) delete mockSessionStorage[k];
});

// 暴露为全局 chrome
vi.stubGlobal('chrome', chromeMock);
