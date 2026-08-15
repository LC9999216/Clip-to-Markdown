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
};

/** 测试可读写的 mock 存储：storage.local 的 get/set 都反映到这个对象 */
export const mockStoredSettings: Record<string, unknown> = {};

type MessageListener = (
  msg: unknown,
  sender: unknown,
  sendResponse: (resp: unknown) => void,
) => boolean | void;

const runtimeListeners: MessageListener[] = [];
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

export const tabsQueryMock = vi.fn(
  (opts: unknown, cb?: (tabs: chrome.tabs.Tab[]) => void) => {
    chromeCalls.tabsQueried.push(opts as { active: boolean; currentWindow: boolean });
    const tabs = [{ id: 1, active: true }] as chrome.tabs.Tab[];
    if (cb) cb(tabs);
    return tabs as unknown;
  },
);

// 把 tabs.sendMessage 路由到 runtime.onMessage 监听（让 EXTRACT 能回读 fixture）
export const tabsSendMessageMock = vi.fn(
  (tabId: number, msg: unknown, cb?: (resp: unknown) => void) => {
    const sender = { tab: { id: tabId } };
    const result = dispatchRuntimeMessage(msg, sender);
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      (result as Promise<unknown>).then((resp) => {
        currentLastError = null;
        if (cb) cb(resp);
      });
    } else {
      currentLastError = { message: 'Could not establish connection. Receiving end does not exist.' };
      if (cb) cb(undefined);
    }
  },
);

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
export function dispatchCommand(command: string): void {
  for (const l of [...commandListeners]) l(command);
}

const chromeMock = {
  runtime: {
    id: 'test-extension-id',
    get lastError() {
      return currentLastError;
    },
    getURL: (path: string) => `chrome-extension://test-extension-id/${path}`,
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
  offscreen: {
    hasDocument: offscreenHasDocumentMock,
    createDocument: offscreenCreateDocumentMock,
    closeDocument: offscreenCloseDocumentMock,
  },
};

beforeEach(() => {
  chromeCalls.downloads.length = 0;
  chromeCalls.tabsQueried.length = 0;
  chromeCalls.notifications.length = 0;
  chromeCalls.offscreenCreated = 0;
  chromeCalls.tabsCreated.length = 0;
  chromeCalls.badgeText.length = 0;
  chromeCalls.badgeColor.length = 0;
  currentLastError = null;
  for (const k of Object.keys(mockStoredSettings)) delete mockStoredSettings[k];
});

// 暴露为全局 chrome
vi.stubGlobal('chrome', chromeMock);
