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

const obsidianApiBaseUrlInput = document.getElementById('obsidian-api-base-url') as HTMLInputElement;
const obsidianApiKeyInput = document.getElementById('obsidian-api-key') as HTMLInputElement;
const noteFolderInput = document.getElementById('note-folder') as HTMLInputElement;
const testObsidianBtn = document.getElementById('test-obsidian-btn') as HTMLButtonElement;
const obsidianStatus = document.getElementById('obsidian-status') as HTMLSpanElement;

const chooseFolderBtn = document.getElementById('choose-folder') as HTMLButtonElement;
const clearFolderBtn = document.getElementById('clear-folder') as HTMLButtonElement;
const folderNameEl = document.getElementById('folder-name') as HTMLElement;
const folderStatusEl = document.getElementById('folder-status') as HTMLElement;
const folderConnectionStateEl = document.getElementById('folder-connection-state') as HTMLSpanElement;
const folderModeDescriptionEl = document.getElementById('folder-mode-description') as HTMLSpanElement;
const fallbackDownloadDetails = document.getElementById('fallback-download-settings') as HTMLDetailsElement;

const shortcutValueEl = document.getElementById('shortcut-value') as HTMLSpanElement;
const shortcutBtn = document.getElementById('shortcut-btn') as HTMLButtonElement;

function setFolderStatus(text: string, kind: 'muted' | 'ok' | 'error' = 'muted'): void {
  folderStatusEl.textContent = text;
  folderStatusEl.className = `hint status ${kind === 'muted' ? '' : kind}`;
}

function setSaveStatus(text: string, kind: 'muted' | 'ok' | 'error' = 'muted'): void {
  saveStatus.textContent = text;
  saveStatus.className = `save-status ${kind === 'muted' ? '' : kind}`;
}

/** 根据目录句柄渲染保存位置卡片：文件夹名称、连接状态与备用下载区展开状态。 */
function renderFolderState(handle: FileSystemDirectoryHandle | null): void {
  const hasCustomFolder = handle !== null;
  folderNameEl.textContent = hasCustomFolder ? handle.name : '浏览器下载目录';
  folderModeDescriptionEl.textContent = hasCustomFolder
    ? '自定义文件夹 · 绕过浏览器下载目录'
    : '使用下方备用下载设置';
  folderConnectionStateEl.textContent = hasCustomFolder ? '已连接' : '未选择';
  folderConnectionStateEl.dataset.kind = hasCustomFolder ? 'ok' : 'muted';
  chooseFolderBtn.textContent = hasCustomFolder ? '更改' : '选择文件夹';
  clearFolderBtn.hidden = !hasCustomFolder;
  fallbackDownloadDetails.open = !hasCustomFolder;
}

/** 读取已存目录句柄并刷新保存位置状态。 */
async function refreshFolderState(): Promise<void> {
  try {
    renderFolderState(await loadDirectoryHandle());
  } catch (error) {
    renderFolderState(null);
    setFolderStatus(`读取文件夹失败：${String(error)}`, 'error');
  }
}

async function onChooseFolder(): Promise<void> {
  if (typeof window.showDirectoryPicker !== 'function') {
    setFolderStatus('当前浏览器不支持选择文件夹（需要 Chrome 105 及以上）。', 'error');
    return;
  }

  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    // 只有拿到 granted 才保存句柄；denied/prompt 不保存新句柄，保留原有已配置句柄
    const permission = await requestWritePermission(handle);
    if (permission !== 'granted') {
      setFolderStatus('未获得该文件夹的写入权限。', 'error');
      return;
    }
    await saveDirectoryHandle(handle);
    await refreshFolderState();
    setFolderStatus(`已保存：文件将直接写入「${handle.name}」。`, 'ok');
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      setFolderStatus('已取消。', 'muted');
      return;
    }
    setFolderStatus(`选择文件夹失败：${String(e)}`, 'error');
  }
}

/** 请求 readwrite 权限；无权限 API（测试桩/旧实现）时视为已授权 */
async function requestWritePermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  if (typeof handle.requestPermission === 'function') {
    return handle.requestPermission({ mode: 'readwrite' });
  }
  if (typeof handle.queryPermission === 'function') {
    return handle.queryPermission({ mode: 'readwrite' });
  }
  return 'granted';
}

async function onClearFolder(): Promise<void> {
  await clearDirectoryHandle();
  await refreshFolderState();
  setFolderStatus('已清除，改回保存到浏览器下载目录。', 'ok');
}

/** 只读展示当前快捷键；改键需到 Chrome 官方快捷键页。 */
async function refreshShortcut(): Promise<void> {
  try {
    const commands = await getAllCommands();
    const cmd = commands.find((c) => c.name === 'save-clip');
    shortcutValueEl.textContent = cmd?.shortcut
      ? `当前：${cmd.shortcut}`
      : '当前：未绑定（点击右侧按钮绑定）';
  } catch (e) {
    shortcutValueEl.textContent = `读取失败：${String(e)}`;
  }
}

/** 用回调形式读取命令（跨版本最稳；Promise 形式在部分环境返回 undefined） */
function getAllCommands(): Promise<chrome.commands.Command[]> {
  return new Promise((resolve, reject) => {
    if (!chrome.commands || typeof chrome.commands.getAll !== 'function') {
      reject(new Error('commands API 不可用，请重新加载扩展'));
      return;
    }
    chrome.commands.getAll((commands) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(commands);
    });
  });
}

function onOpenShortcuts(): void {
  void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
}

async function init(): Promise<void> {
  const settings = await loadSettings();
  subfolderInput.value = settings.subfolder;
  saveAsInput.checked = settings.saveAs;
  obsidianApiBaseUrlInput.value = settings.obsidianApiBaseUrl;
  obsidianApiKeyInput.value = settings.obsidianApiKey;
  noteFolderInput.value = settings.noteFolder;
  await refreshFolderState();
  await refreshShortcut();
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
    await saveSettings({
      subfolder,
      saveAs: saveAsInput.checked,
      obsidianApiBaseUrl: obsidianApiBaseUrlInput.value,
      obsidianApiKey: obsidianApiKeyInput.value,
      noteFolder: noteFolderInput.value,
    });
    setSaveStatus('已保存', 'ok');
  } catch (e) {
    setSaveStatus(`保存失败：${String(e)}`, 'error');
  } finally {
    saveBtn.disabled = false;
  }
}

async function onTestObsidian(): Promise<void> {
  testObsidianBtn.disabled = true;
  obsidianStatus.textContent = '测试中…';
  obsidianStatus.className = 'save-status';
  try {
    // 先保存当前输入，确保测试用的是最新配置
    await saveSettings({
      subfolder: sanitizeSubfolder(subfolderInput.value),
      saveAs: saveAsInput.checked,
      obsidianApiBaseUrl: obsidianApiBaseUrlInput.value,
      obsidianApiKey: obsidianApiKeyInput.value,
      noteFolder: noteFolderInput.value,
    });
    const resp = await runtimeSend<{ success: boolean; service?: string; error?: string }>({ type: 'TEST_OBSIDIAN' });
    if (!resp.success) {
      obsidianStatus.textContent = resp.error ?? '连接失败';
      obsidianStatus.className = 'save-status error';
      return;
    }
    obsidianStatus.textContent = `连接成功：${resp.service ?? 'Obsidian Local REST API'}`;
    obsidianStatus.className = 'save-status ok';
  } catch (e) {
    obsidianStatus.textContent = `测试失败：${String(e)}`;
    obsidianStatus.className = 'save-status error';
  } finally {
    testObsidianBtn.disabled = false;
  }
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

chooseFolderBtn.addEventListener('click', () => void onChooseFolder());
clearFolderBtn.addEventListener('click', () => void onClearFolder());
shortcutBtn.addEventListener('click', onOpenShortcuts);
testObsidianBtn.addEventListener('click', () => void onTestObsidian());

document.addEventListener('DOMContentLoaded', () => {
  void init();
});
