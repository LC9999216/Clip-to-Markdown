/**
 * 首次保存初始化状态。
 *
 * 目录句柄保存在 IndexedDB；这里单独保存“新用户是否完成过目录初始化”，
 * 以便兼容已经使用浏览器下载目录的旧用户。旧设置记录存在时视为已完成，
 * 只有完全没有设置记录的新用户需要首次选择自定义文件夹。
 */

const SETTINGS_KEY = 'clip2md.settings';
export const INITIAL_SETUP_KEY = 'clip2md.initialSetupCompleted';

export class InitialSetupRequiredError extends Error {
  readonly code = 'INITIAL_SETUP_REQUIRED';

  constructor() {
    super('首次使用前请先在设置页选择自定义保存文件夹。');
    this.name = 'InitialSetupRequiredError';
  }
}

type StorageItems = Record<string, unknown>;

/** 读取初始化状态；旧用户首次读取时自动完成兼容标记。 */
export async function isInitialSetupComplete(): Promise<boolean> {
  const items = await storageGet([INITIAL_SETUP_KEY, SETTINGS_KEY]);
  const marker = items[INITIAL_SETUP_KEY];
  if (typeof marker === 'boolean') return marker;

  if (isRecord(items[SETTINGS_KEY])) {
    await markInitialSetupComplete();
    return true;
  }

  await markInitialSetupIncomplete();
  return false;
}

/** 标记用户已完成首次目录初始化；清除目录不会调用此函数。 */
export async function markInitialSetupComplete(): Promise<void> {
  await storageSet({ [INITIAL_SETUP_KEY]: true });
}

/** 固定新用户的未完成状态，避免之后保存 Obsidian 设置时被误判为旧用户。 */
async function markInitialSetupIncomplete(): Promise<void> {
  await storageSet({ [INITIAL_SETUP_KEY]: false });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function storageGet(keys: string[]): Promise<StorageItems> {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.get(keys, (items) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(items ?? {});
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function storageSet(items: StorageItems): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.set(items, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
