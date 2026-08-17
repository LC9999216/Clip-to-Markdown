/**
 * Clip2MD Popup：极简 UI。
 * 流程：GET_STATUS 探测 → EXTRACT 提取 → 本地渲染
 *       →（已选自定义文件夹则直接写入）→ 否则 DOWNLOAD。
 */

import { renderDocument } from '../core/markdown-renderer';
import { buildFilename } from '../core/filename';
import { loadDirectoryHandle, writeMarkdownToDirectory } from '../core/custom-folder';
import type {
  DownloadResponse,
  ExtractResponse,
  SaveToObsidianResponse,
  StatusResponse,
} from '../types/messages';

const statusText = document.getElementById('status-text') as HTMLParagraphElement;
const actionPanel = document.getElementById('action-panel') as HTMLElement;
const docTitle = document.getElementById('doc-title') as HTMLParagraphElement;
const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
const obsidianBtn = document.getElementById('obsidian-btn') as HTMLButtonElement;
const settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement;

settingsBtn.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});

function setStatus(text: string, kind: 'muted' | 'ok' | 'error' = 'muted'): void {
  statusText.textContent = text;
  statusText.className = `status-text ${kind === 'muted' ? '' : kind}`;
  actionPanel.classList.add('hidden');
  saveBtn.disabled = true;
  obsidianBtn.disabled = true;
}

function setReady(title: string): void {
  statusText.textContent = '已识别当前内容';
  statusText.className = 'status-text ok';
  docTitle.textContent = title || '（无标题）';
  actionPanel.classList.remove('hidden');
  saveBtn.disabled = false;
  saveBtn.textContent = '保存为 Markdown';
  obsidianBtn.disabled = false;
  obsidianBtn.textContent = '保存到 Obsidian';
}

function queryActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]));
  });
}

async function getActiveTabId(): Promise<number | null> {
  const tab = await queryActiveTab();
  return tab?.id ?? null;
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

document.addEventListener('DOMContentLoaded', () => {
  void init();
});

async function init(): Promise<void> {
  setStatus('正在检测当前页面…');
  const tabId = await getActiveTabId();
  if (tabId == null) {
    setStatus('无法获取当前标签页。', 'error');
    return;
  }

  let status: StatusResponse;
  try {
    status = await tabSend<StatusResponse>(tabId, { type: 'GET_STATUS' });
  } catch {
    setStatus('无法连接页面，请刷新页面后重试。', 'error');
    return;
  }

  if (!status.supported) {
    setStatus('当前页面暂不支持。\n请打开 X、知乎、小黑盒或 ChatGPT 的内容页面。', 'error');
    return;
  }

  const platformLabel = PLATFORM_LABELS[status.platform ?? 'x'];
  const typeLabel = TYPE_LABELS[status.contentType ?? 'tweet'];
  statusText.textContent = `平台：${platformLabel} · ${typeLabel}`;
  statusText.className = 'status-text ok';
  docTitle.textContent = status.title || '（暂无标题）';
  actionPanel.classList.remove('hidden');
  saveBtn.disabled = false;
  saveBtn.textContent = '保存为 Markdown';
  obsidianBtn.disabled = false;
  obsidianBtn.textContent = '保存到 Obsidian';

  saveBtn.addEventListener('click', () => void onSave(tabId));
  obsidianBtn.addEventListener('click', () => void onSaveToObsidian(tabId));
}

async function onSave(tabId: number): Promise<void> {
  saveBtn.disabled = true;
  saveBtn.textContent = '提取中…';

  let extract: ExtractResponse;
  try {
    extract = await tabSend<ExtractResponse>(tabId, { type: 'EXTRACT' });
  } catch (e) {
    saveBtn.textContent = '保存为 Markdown';
    setStatus(`提取失败：${String(e)}`, 'error');
    return;
  }

  if (!extract.success) {
    saveBtn.textContent = '保存为 Markdown';
    setStatus(extract.error.message, 'error');
    return;
  }

  const markdown = renderDocument(extract.document);
  const filename = buildFilename(extract.document);

  // 优先：若用户在设置里选了自定义文件夹，直接写入该目录（绕过下载目录）。
  let fallbackNote = '';
  saveBtn.textContent = '保存中…';
  try {
    const dir = await loadDirectoryHandle();
    if (dir) {
      try {
        const written = await writeMarkdownToDirectory(dir, filename, markdown);
        saveBtn.textContent = '保存为 Markdown';
        setStatus(`已保存：${dir.name}/${written}`, 'ok');
        return;
      } catch {
        fallbackNote = '自定义文件夹写入失败，已改为保存到下载目录。';
      }
    }
  } catch {
    fallbackNote = '自定义文件夹读取失败，已改为保存到下载目录。';
  }

  saveBtn.textContent = '下载中…';
  let dl: DownloadResponse;
  try {
    dl = await runtimeSend<DownloadResponse>({
      type: 'DOWNLOAD',
      payload: { markdown, filename },
    });
  } catch (e) {
    saveBtn.textContent = '保存为 Markdown';
    setStatus(`下载失败：${String(e)}`, 'error');
    return;
  }

  if (!dl.success) {
    saveBtn.textContent = '保存为 Markdown';
    setStatus(dl.error, 'error');
    return;
  }

  saveBtn.textContent = '保存为 Markdown';
  setStatus(`${fallbackNote}已保存：${dl.filename}`, 'ok');
}

async function onSaveToObsidian(tabId: number): Promise<void> {
  obsidianBtn.disabled = true;
  saveBtn.disabled = true;
  obsidianBtn.textContent = '提取中…';

  let extract: ExtractResponse;
  try {
    extract = await tabSend<ExtractResponse>(tabId, { type: 'EXTRACT' });
  } catch (e) {
    resetButtons();
    setStatus(`提取失败：${String(e)}`, 'error');
    return;
  }

  if (!extract.success) {
    resetButtons();
    setStatus(extract.error.message, 'error');
    return;
  }

  const markdown = renderDocument(extract.document);
  const filename = buildFilename(extract.document);

  obsidianBtn.textContent = '保存中…';
  let resp: SaveToObsidianResponse;
  try {
    resp = await runtimeSend<SaveToObsidianResponse>({
      type: 'SAVE_TO_OBSIDIAN',
      payload: { markdown, filename },
    });
  } catch (e) {
    resetButtons();
    setStatus(`保存失败：${String(e)}`, 'error');
    return;
  }

  if (resp.success) {
    resetButtons();
    setStatus(`已保存到 Obsidian：${resp.filename}`, 'ok');
    return;
  }

  // 笔记已存在：询问是否覆盖
  if (resp.exists && window.confirm('该笔记已存在，是否覆盖？')) {
    obsidianBtn.textContent = '覆盖中…';
    try {
      const overwrite = await runtimeSend<SaveToObsidianResponse>({
        type: 'SAVE_TO_OBSIDIAN',
        payload: { markdown, filename, overwrite: true },
      });
      if (overwrite.success) {
        resetButtons();
        setStatus(`已覆盖：${overwrite.filename}`, 'ok');
        return;
      }
      resp = overwrite;
    } catch (e) {
      resetButtons();
      setStatus(`覆盖失败：${String(e)}`, 'error');
      return;
    }
  }

  resetButtons();
  setStatus(resp.error, 'error');
}

function resetButtons(): void {
  saveBtn.disabled = false;
  saveBtn.textContent = '保存为 Markdown';
  obsidianBtn.disabled = false;
  obsidianBtn.textContent = '保存到 Obsidian';
}

const PLATFORM_LABELS: Record<string, string> = {
  x: 'X / Twitter',
  zhihu: '知乎',
  heybox: '小黑盒',
  chatgpt: 'ChatGPT',
  bilibili: 'B 站',
};

const TYPE_LABELS: Record<string, string> = {
  tweet: '推文',
  'x-article': '文章',
  'zhihu-answer': '回答',
  'zhihu-article': '文章',
  'heybox-post': '帖子',
  'chatgpt-chat': '对话',
  'bilibili-video': '视频字幕',
};
