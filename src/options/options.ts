/**
 * Clip2MD 设置页：自定义保存文件夹 + 下载目录设置。
 * - 自定义文件夹用 File System Access API（showDirectoryPicker）选择，句柄存 IndexedDB；
 * - 下载目录设置存 chrome.storage.local。
 */

import { loadSettings, saveSettings, sanitizeSubfolder } from '../core/settings';
import {
  clearDirectoryHandle,
  loadDirectoryHandle,
  saveDirectoryHandle,
} from '../core/custom-folder';

const form = document.getElementById('settings-form') as HTMLFormElement;
const subfolderInput = document.getElementById('subfolder') as HTMLInputElement;
const saveAsInput = document.getElementById('save-as') as HTMLInputElement;
const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
const saveStatus = document.getElementById('save-status') as HTMLSpanElement;

const chooseFolderBtn = document.getElementById('choose-folder') as HTMLButtonElement;
const clearFolderBtn = document.getElementById('clear-folder') as HTMLButtonElement;
const folderNameEl = document.getElementById('folder-name') as HTMLSpanElement;
const folderStatusEl = document.getElementById('folder-status') as HTMLParagraphElement;

function setFolderStatus(text: string, kind: 'muted' | 'ok' | 'error' = 'muted'): void {
  folderStatusEl.textContent = text;
  folderStatusEl.className = `hint status ${kind === 'muted' ? '' : kind}`;
}

function setSaveStatus(text: string, kind: 'muted' | 'ok' | 'error' = 'muted'): void {
  saveStatus.textContent = text;
  saveStatus.className = `save-status ${kind === 'muted' ? '' : kind}`;
}

/** 读取已存目录句柄并刷新「已选：xxx」显示。 */
async function refreshFolderLabel(): Promise<void> {
  try {
    const handle = await loadDirectoryHandle();
    if (handle) {
      folderNameEl.textContent = `已选：${handle.name}`;
      clearFolderBtn.hidden = false;
    } else {
      folderNameEl.textContent = '未选择';
      clearFolderBtn.hidden = true;
    }
  } catch {
    folderNameEl.textContent = '未选择';
    clearFolderBtn.hidden = true;
  }
}

async function onChooseFolder(): Promise<void> {
  if (typeof window.showDirectoryPicker !== 'function') {
    setFolderStatus('当前浏览器不支持选择文件夹（需要 Chrome 105 及以上）。', 'error');
    return;
  }

  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    // 兜底：部分版本 picker 不授予 readwrite，显式请求一次
    if (handle.requestPermission) {
      await handle.requestPermission({ mode: 'readwrite' });
    }
    await saveDirectoryHandle(handle);
    await refreshFolderLabel();
    setFolderStatus(`已保存：文件将直接写入「${handle.name}」。`, 'ok');
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      setFolderStatus('已取消。', 'muted');
      return;
    }
    setFolderStatus(`选择文件夹失败：${String(e)}`, 'error');
  }
}

async function onClearFolder(): Promise<void> {
  await clearDirectoryHandle();
  await refreshFolderLabel();
  setFolderStatus('已清除，改回保存到浏览器下载目录。', 'ok');
}

async function init(): Promise<void> {
  const settings = await loadSettings();
  subfolderInput.value = settings.subfolder;
  saveAsInput.checked = settings.saveAs;
  await refreshFolderLabel();
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  void onSubmit();
});

async function onSubmit(): Promise<void> {
  const subfolder = sanitizeSubfolder(subfolderInput.value);
  subfolderInput.value = subfolder;

  saveBtn.disabled = true;
  setSaveStatus('保存中…');
  try {
    await saveSettings({ subfolder, saveAs: saveAsInput.checked });
    setSaveStatus('已保存', 'ok');
  } catch (e) {
    setSaveStatus(`保存失败：${String(e)}`, 'error');
  } finally {
    saveBtn.disabled = false;
  }
}

chooseFolderBtn.addEventListener('click', () => void onChooseFolder());
clearFolderBtn.addEventListener('click', () => void onClearFolder());

document.addEventListener('DOMContentLoaded', () => {
  void init();
});
