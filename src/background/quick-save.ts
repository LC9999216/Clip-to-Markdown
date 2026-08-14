/**
 * 快捷键保存：监听 chrome.commands 的 save-clip，不打开 popup 直接保存。
 *
 * 流程：EXTRACT → renderDocument + buildFilename
 *       → 自定义文件夹（通过 offscreen document 写入）或 下载目录。
 */

import { renderDocument } from '../core/markdown-renderer';
import { buildFilename } from '../core/filename';
import { loadSettings, resolveDownloadPath } from '../core/settings';
import { loadDirectoryHandle } from '../core/custom-folder';
import { downloadMarkdown } from '../core/downloader';
import type { ExtractResponse } from '../types/messages';

const COMMAND = 'save-clip';

interface WriteCustomResponse {
  success: boolean;
  filename?: string;
  error?: string;
}

// 防御：commands API 不可用时跳过注册，避免整个 SW 启动崩溃
if (chrome.commands?.onCommand) {
  chrome.commands.onCommand.addListener((command) => {
    if (command === COMMAND) void runQuickSave();
  });
}

async function runQuickSave(): Promise<void> {
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

  const markdown = renderDocument(extract.document);
  const filename = buildFilename(extract.document);

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
      await downloadFallback(markdown, filename, `自定义文件夹写入失败，已改为下载目录：${String(e)}`);
      return;
    }
  }

  await downloadFallback(markdown, filename, '');
}

async function downloadFallback(markdown: string, filename: string, note: string): Promise<void> {
  try {
    const settings = await loadSettings();
    const { filename: path, saveAs } = resolveDownloadPath(filename, settings);
    const r = await downloadMarkdown({ markdown, filename: path, saveAs });
    notify('已保存', `${note}${r.filename}`);
  } catch (e) {
    notify('保存失败', String(e));
  }
}

async function writeViaOffscreen(filename: string, markdown: string): Promise<string> {
  await ensureOffscreen();
  const resp = await runtimeSend<WriteCustomResponse>({
    type: 'WRITE_CUSTOM',
    payload: { filename, markdown },
  });
  if (!resp || !resp.success) throw new Error(resp?.error ?? '自定义文件夹写入失败。');
  return resp.filename ?? filename;
}

// ---------- offscreen 生命周期 ----------

let offscreenReadyPromise: Promise<void> | null = null;

function ensureOffscreen(): Promise<void> {
  if (!offscreenReadyPromise) {
    offscreenReadyPromise = createOffscreen().catch((e) => {
      offscreenReadyPromise = null;
      throw e;
    });
  }
  return offscreenReadyPromise;
}

async function createOffscreen(): Promise<void> {
  const offscreen = chrome.offscreen;
  // Chrome 150+ 才有 hasDocument；旧版直接尝试创建并忽略「已存在」错误
  if (typeof offscreen.hasDocument === 'function' && (await offscreen.hasDocument())) {
    return;
  }
  const ready = waitForOffscreenReady();
  try {
    await offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: '写入自定义文件夹需要 File System Access API',
    });
  } catch {
    // 已存在则忽略
  }
  await ready;
}

function waitForOffscreenReady(timeoutMs = 2000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    function settle(): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.runtime.onMessage.removeListener(listener);
      resolve();
    }
    function listener(msg: unknown): void {
      if ((msg as { type?: string } | null)?.type === 'OFFSCREEN_READY') settle();
    }
    timer = setTimeout(settle, timeoutMs);
    chrome.runtime.onMessage.addListener(listener);
  });
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
  setBadge(title === '已保存');
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
