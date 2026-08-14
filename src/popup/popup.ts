/**
 * Clip2MD Popup：极简 UI。
 * 流程：GET_STATUS 探测 → EXTRACT 提取 → 本地渲染 → DOWNLOAD。
 */

import { renderDocument } from '../core/markdown-renderer';
import { buildFilename } from '../core/filename';
import type { DownloadResponse, ExtractResponse, StatusResponse } from '../types/messages';

const statusText = document.getElementById('status-text') as HTMLParagraphElement;
const actionPanel = document.getElementById('action-panel') as HTMLElement;
const docTitle = document.getElementById('doc-title') as HTMLParagraphElement;
const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;

function setStatus(text: string, kind: 'muted' | 'ok' | 'error' = 'muted'): void {
  statusText.textContent = text;
  statusText.className = `status-text ${kind === 'muted' ? '' : kind}`;
  actionPanel.classList.add('hidden');
  saveBtn.disabled = true;
}

function setReady(title: string): void {
  statusText.textContent = '已识别当前内容';
  statusText.className = 'status-text ok';
  docTitle.textContent = title || '（无标题）';
  actionPanel.classList.remove('hidden');
  saveBtn.disabled = false;
  saveBtn.textContent = '保存为 Markdown';
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
    setStatus('当前页面暂不支持。\n请打开 X / 知乎 / 小黑盒 的帖子或文章页。', 'error');
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

  saveBtn.addEventListener('click', () => void onSave(tabId));
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
  setStatus(`已保存：${dl.filename}`, 'ok');
}

const PLATFORM_LABELS: Record<string, string> = {
  x: 'X / Twitter',
  zhihu: '知乎',
  heybox: '小黑盒',
};

const TYPE_LABELS: Record<string, string> = {
  tweet: '推文',
  'zhihu-answer': '回答',
  'zhihu-article': '文章',
  'heybox-post': '帖子',
};
