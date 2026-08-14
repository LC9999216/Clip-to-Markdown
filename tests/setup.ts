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
};

/** 测试可读写的 mock 存储：storage.local 的 get/set 都反映到这个对象 */
export const mockStoredSettings: Record<string, unknown> = {};

type MessageListener = (
  msg: unknown,
  sender: unknown,
  sendResponse: (resp: unknown) => void,
) => boolean | void;

const runtimeListeners: MessageListener[] = [];

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

const chromeMock = {
  runtime: {
    id: 'test-extension-id',
    lastError: null as { message: string } | null,
    onMessage: {
      addListener: (l: MessageListener) => runtimeListeners.push(l),
      removeListener: (l: MessageListener) => {
        const i = runtimeListeners.indexOf(l);
        if (i >= 0) runtimeListeners.splice(i, 1);
      },
    },
    sendMessage: vi.fn(),
  },
  tabs: {
    query: vi.fn((opts: unknown, cb?: (tabs: chrome.tabs.Tab[]) => void) => {
      chromeCalls.tabsQueried.push(opts as { active: boolean; currentWindow: boolean });
      const result = cb ? (cb([]), undefined) : undefined;
      return result as unknown;
    }),
    sendMessage: vi.fn(),
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
};

beforeEach(() => {
  chromeCalls.downloads.length = 0;
  chromeCalls.tabsQueried.length = 0;
  for (const k of Object.keys(mockStoredSettings)) delete mockStoredSettings[k];
});

// 暴露为全局 chrome
vi.stubGlobal('chrome', chromeMock);
