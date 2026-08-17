/**
 * 快捷键保存：监听 chrome.commands 的 save-clip，不打开 popup 直接保存。
 *
 * 流程：EXTRACT → renderDocument + buildFilename
 *       → 自定义文件夹（通过 offscreen document 写入）或 下载目录。
 *
 * offscreen 生命周期：不永久缓存「已就绪」状态；每次写入前重新确认文档存在，
 * 缺失则重建。只缓存「正在创建」的 Promise 以合并并发请求。
 */

import { prepareSave, type SaveTarget } from '../core/save-service';
import { resolveDownloadPath } from '../core/settings';
import { loadDirectoryHandle } from '../core/custom-folder';
import { downloadMarkdown } from '../core/downloader';
import { saveToObsidian } from './obsidian';
import type { ExtractResponse, WriteCustomResponse } from '../types/messages';

const COMMAND = 'save-clip';

/** offscreen 就绪信号超时时间（毫秒） */
export const OFFSCREEN_READY_TIMEOUT_MS = 2000;

/** 属于 offscreen 生命周期错误的标记（可安全重建重试一次） */
const LIFECYCLE_ERROR_MARKERS = [
  'Could not establish connection',
  'Receiving end does not exist',
  'Message port closed before a response was received',
];

/** 离屏组件就绪超时的错误码（不拼进用户可见文案，仅用于生命周期判定） */
const OFFSCREEN_READY_TIMEOUT_CODE = 'OFFSCREEN_READY_TIMEOUT';

// 防御：commands API 不可用时跳过注册，避免整个 SW 启动崩溃
if (chrome.commands?.onCommand) {
  chrome.commands.onCommand.addListener((command) => {
    if (command === COMMAND) void runSave('default');
  });
}

export async function runSave(target: SaveTarget): Promise<void> {
  const tab = await getActiveTab();
  if (tab?.id == null) {
    notify('保存失败', '无法获取当前标签页。');
    return;
  }

  let extract: ExtractResponse;
  try {
    extract = await tabSend<ExtractResponse>(tab.id, { type: 'EXTRACT' });
  } catch {
    notify('保存失败', '当前页面暂不支持，或页面尚未加载完成，请刷新后重试。');
    return;
  }

  if (!extract?.success) {
    notify('保存失败', extract?.error?.message ?? '提取内容失败。');
    return;
  }

  const prepared = await prepareSave(extract.document);
  const { markdown, filename, settings } = prepared;

  if (target === 'obsidian') {
    try {
      const filepath = await saveToObsidian({ markdown, filename }, settings);
      notify('已保存到 Obsidian', filepath);
    } catch {
      notify('Obsidian 保存失败', '请检查连接设置。');
    }
    return;
  }

  // 自定义文件夹优先（IndexedDB 在 SW 可用，异常视为未配置）
  let hasCustom = false;
  try {
    hasCustom = !!(await loadDirectoryHandle());
  } catch {
    hasCustom = false;
  }

  if (hasCustom) {
    try {
      const written = await writeViaOffscreen(filename, markdown);
      notify('已保存', written);
      return;
    } catch (e) {
      // 错误详情只写开发日志，用户通知不拼接冗长的 Error
      console.error('自定义文件夹写入失败：', e);
      await downloadFallback(markdown, filename, '自定义文件夹写入失败，已保存到下载目录：', settings);
      return;
    }
  }

  await downloadFallback(markdown, filename, '', settings);
}

async function downloadFallback(
  markdown: string,
  filename: string,
  note: string,
  settings: Awaited<ReturnType<typeof prepareSave>>['settings'],
): Promise<void> {
  try {
    const { filename: path, saveAs } = resolveDownloadPath(filename, settings.save);
    const r = await downloadMarkdown({ markdown, filename: path, saveAs });
    notify('已保存', `${note}${r.filename}`);
  } catch (e) {
    notify('保存失败', String(e));
  }
}

// ---------- 写入（最多重试一次，仅生命周期错误） ----------

export async function writeViaOffscreen(filename: string, markdown: string): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await ensureOffscreenDocument();
      const resp = await runtimeSend<WriteCustomResponse>({
        type: 'WRITE_CUSTOM',
        payload: { filename, markdown },
      });
      if (resp && resp.success) return resp.filename ?? filename;
      // 非生命周期错误（权限/写入失败等）：直接抛出，不重试
      throw new Error(resp?.error ?? '自定义文件夹写入失败。');
    } catch (e) {
      if (attempt === 0 && isLifecycleError(e)) {
        await resetOffscreenForRetry();
        continue;
      }
      throw e;
    }
  }
  throw new Error('自定义文件夹写入失败。');
}

// ---------- offscreen 生命周期 ----------

/** 仅缓存「正在创建」的 Promise；创建结束后（无论成败）清空 */
let offscreenCreationInFlight: Promise<void> | null = null;

export async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return;
  if (!offscreenCreationInFlight) {
    offscreenCreationInFlight = createOffscreenDocument();
  }
  try {
    await offscreenCreationInFlight;
  } finally {
    offscreenCreationInFlight = null;
  }
}

/** 每次写入前重新确认 offscreen document 是否存在（不信任历史就绪状态） */
export async function hasOffscreenDocument(): Promise<boolean> {
  const offscreen = chrome.offscreen;
  if (typeof offscreen.hasDocument === 'function') {
    try {
      return await offscreen.hasDocument();
    } catch {
      return false; // API 异常不能默认返回 true
    }
  }
  // API 不存在：无法确定，按不存在处理（createDocument 抛「已存在」时再兜底）
  return false;
}

async function createOffscreenDocument(): Promise<void> {
  const ready = waitForOffscreenReady();
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: '写入用户明确选择的自定义文件夹',
    });
  } catch (e) {
    // createDocument 抛错时再确认一次：若文档其实已存在，等待 ready 即可
    if (!(await hasOffscreenDocument())) throw e;
  }
  await ready;
}

/** 收到 OFFSCREEN_READY → resolve；超时 → reject；两种结果都清理 listener 与 timer */
export function waitForOffscreenReady(timeoutMs = OFFSCREEN_READY_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;

    function cleanup(): void {
      clearTimeout(timer);
      chrome.runtime.onMessage.removeListener(listener);
    }
    function settleOk(): void {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    }
    function settleTimeout(): void {
      if (settled) return;
      settled = true;
      cleanup();
      const err = new Error('离屏写入组件启动超时。') as Error & { code?: string };
      err.code = OFFSCREEN_READY_TIMEOUT_CODE;
      reject(err);
    }
    function listener(msg: unknown): void {
      if ((msg as { type?: string } | null)?.type === 'OFFSCREEN_READY') settleOk();
    }

    timer = setTimeout(settleTimeout, timeoutMs);
    chrome.runtime.onMessage.addListener(listener);
  });
}

async function resetOffscreenForRetry(): Promise<void> {
  offscreenCreationInFlight = null;
  try {
    if (await hasOffscreenDocument()) {
      await chrome.offscreen.closeDocument();
    }
  } catch {
    // 关闭失败不阻断重建
  }
}

function isLifecycleError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  if (LIFECYCLE_ERROR_MARKERS.some((m) => msg.includes(m))) return true;
  return (e as { code?: string } | null)?.code === OFFSCREEN_READY_TIMEOUT_CODE;
}

// ---------- 工具 ----------

function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]));
  });
}

function tabSend<T>(tabId: number, msg: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, msg as object, (resp: T) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(resp);
    });
  });
}

function runtimeSend<T>(msg: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg as object, (resp: T) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(resp);
    });
  });
}

function notify(title: string, message: string): void {
  // 角标兜底：不依赖系统通知权限，工具栏图标上一定可见
  setBadge(title.includes('已保存'));
  try {
    chrome.notifications.create(
      { type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon-128.png'), title, message },
      () => {
        const err = chrome.runtime.lastError;
        if (err) console.error('通知失败:', err.message);
      },
    );
  } catch (e) {
    console.error('通知不可用:', String(e));
  }
}

/** 工具栏图标角标：成功 ✓（绿）/ 失败 !（红），3 秒后清除 */
function setBadge(success: boolean): void {
  try {
    void chrome.action.setBadgeBackgroundColor({ color: success ? '#16a34a' : '#dc2626' });
    void chrome.action.setBadgeText({ text: success ? '✓' : '!' });
    setTimeout(() => {
      void chrome.action.setBadgeText({ text: '' });
    }, 3000);
  } catch {
    // 角标不可用时静默降级
  }
}
