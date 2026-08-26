/**
 * Clip2MD 设置页：自定义保存文件夹 + 下载目录设置。
 * - 自定义文件夹用 File System Access API（showDirectoryPicker）选择，句柄存 IndexedDB；
 * - 下载目录设置存 chrome.storage.local。
 */

import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  sanitizeSubfolder,
  type ObsidianFrontmatterSettings,
  type ClipSettings,
} from '../core/settings';
import { getAiOriginPattern, normalizeAiEndpoint } from '../core/ai-settings';
import { validateFilenameTemplate } from '../core/filename';
import {
  clearDirectoryHandle,
  loadDirectoryHandle,
  saveDirectoryHandle,
} from '../core/custom-folder';
import { isInitialSetupComplete, markInitialSetupComplete } from '../core/setup-state';

const form = document.getElementById('settings-form') as HTMLFormElement;
const subfolderInput = document.getElementById('subfolder') as HTMLInputElement;
const saveAsInput = document.getElementById('save-as') as HTMLInputElement;
const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
const saveStatus = document.getElementById('save-status') as HTMLSpanElement;
const filenameTemplateInput = document.getElementById('filename-template') as HTMLInputElement;
const filenameTemplateError = document.getElementById('filename-template-error') as HTMLParagraphElement;
const appVersionEl = document.getElementById('app-version') as HTMLSpanElement;

const obsidianApiBaseUrlInput = document.getElementById('obsidian-api-base-url') as HTMLInputElement;
const obsidianApiKeyInput = document.getElementById('obsidian-api-key') as HTMLInputElement;
const noteFolderInput = document.getElementById('note-folder') as HTMLInputElement;
const testObsidianBtn = document.getElementById('test-obsidian-btn') as HTMLButtonElement;
const obsidianStatus = document.getElementById('obsidian-status') as HTMLElement;
const toggleApiKeyBtn = document.getElementById('toggle-api-key') as HTMLButtonElement;
const obsidianSummaryStateEl = document.getElementById('obsidian-summary-state') as HTMLSpanElement;

const aiEnabledInput = document.getElementById('ai-enabled') as HTMLInputElement;
const aiEndpointInput = document.getElementById('ai-endpoint') as HTMLInputElement;
const aiApiKeyInput = document.getElementById('ai-api-key') as HTMLInputElement;
const aiModelInput = document.getElementById('ai-model') as HTMLInputElement;
const toggleAiApiKeyBtn = document.getElementById('toggle-ai-api-key') as HTMLButtonElement;
const aiAuthorizeBtn = document.getElementById('ai-authorize-btn') as HTMLButtonElement;
const aiTestBtn = document.getElementById('ai-test-btn') as HTMLButtonElement;
const aiStatus = document.getElementById('ai-status') as HTMLElement;
const frontmatterInputs: Record<keyof ObsidianFrontmatterSettings, HTMLInputElement> = {
  sourceUrl: document.getElementById('frontmatter-source-url') as HTMLInputElement,
  author: document.getElementById('frontmatter-author') as HTMLInputElement,
  published: document.getElementById('frontmatter-published') as HTMLInputElement,
  platform: document.getElementById('frontmatter-platform') as HTMLInputElement,
  clippedAt: document.getElementById('frontmatter-clipped-at') as HTMLInputElement,
  tags: document.getElementById('frontmatter-tags') as HTMLInputElement,
};

const chooseFolderBtn = document.getElementById('choose-folder') as HTMLButtonElement;
const clearFolderBtn = document.getElementById('clear-folder') as HTMLButtonElement;
const folderNameEl = document.getElementById('folder-name') as HTMLElement;
const folderStatusEl = document.getElementById('folder-status') as HTMLElement;
const folderConnectionStateEl = document.getElementById('folder-connection-state') as HTMLSpanElement;
const folderModeDescriptionEl = document.getElementById('folder-mode-description') as HTMLSpanElement;
const fallbackDownloadDetails = document.getElementById('fallback-download-settings') as HTMLDetailsElement;
const initialSetupGuideEl = document.getElementById('initial-setup-guide') as HTMLElement;

let currentSettings: ClipSettings = DEFAULT_SETTINGS;
let initialSetupComplete = false;

const shortcutValueEl = document.getElementById('shortcut-value') as HTMLSpanElement;
const shortcutBtn = document.getElementById('shortcut-btn') as HTMLButtonElement;
const obsidianShortcutValueEl = document.getElementById('obsidian-shortcut-value') as HTMLSpanElement;
const obsidianShortcutBtn = document.getElementById('obsidian-shortcut-btn') as HTMLButtonElement;

type StatusKind = 'muted' | 'ok' | 'error';

function setInlineStatus(
  element: HTMLElement,
  text: string,
  kind: StatusKind = 'muted',
): void {
  element.textContent = text;
  element.dataset.kind = kind;
}

function setFolderStatus(text: string, kind: StatusKind = 'muted'): void {
  setInlineStatus(folderStatusEl, text, kind);
}

function setSaveStatus(text: string, kind: StatusKind = 'muted'): void {
  setInlineStatus(saveStatus, text, kind);
}

function readFormSettings() {
  return {
    ...currentSettings,
    save: {
      ...currentSettings.save,
      subfolder: sanitizeSubfolder(subfolderInput.value),
      saveAs: saveAsInput.checked,
    },
    obsidian: {
      ...currentSettings.obsidian,
      apiUrl: obsidianApiBaseUrlInput.value,
      apiKey: obsidianApiKeyInput.value,
      noteDirectory: noteFolderInput.value,
      frontmatter: {
        ...currentSettings.obsidian.frontmatter,
        sourceUrl: frontmatterInputs.sourceUrl.checked,
        author: frontmatterInputs.author.checked,
        published: frontmatterInputs.published.checked,
        platform: frontmatterInputs.platform.checked,
        clippedAt: frontmatterInputs.clippedAt.checked,
        tags: frontmatterInputs.tags.checked,
      },
    },
    filename: {
      ...currentSettings.filename,
      template: filenameTemplateInput.value.trim(),
    },
    ai: {
      ...currentSettings.ai,
      enabled: aiEnabledInput.checked,
      endpoint: aiEndpointInput.value,
      apiKey: aiApiKeyInput.value,
      model: aiModelInput.value,
    },
  };
}

let initialized = false;

function setDirty(dirty: boolean): void {
  form.dataset.dirty = String(dirty);
  saveBtn.disabled = !dirty || !initialSetupComplete;
}

function markDirty(): void {
  if (!initialized) return;
  setSaveStatus('');
  filenameTemplateError.textContent = '';
  setDirty(true);
}

function validateFilenameTemplateForSave(template: string): boolean {
  const validation = validateFilenameTemplate(template);
  if (validation.valid) {
    filenameTemplateError.textContent = '';
    return true;
  }
  filenameTemplateError.textContent = `不支持的变量：${validation.unsupportedVariables.join('、')}`;
  return false;
}

function renderInitialSetupState(): void {
  initialSetupGuideEl.hidden = initialSetupComplete;
  form.dataset.initialSetupComplete = String(initialSetupComplete);
  setDirty(form.dataset.dirty === 'true');
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
  renderInitialSetupState();
}

/** 读取已存目录句柄并刷新保存位置状态。 */
async function refreshFolderState(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const handle = await loadDirectoryHandle();
    renderFolderState(handle);
    return handle;
  } catch (error) {
    renderFolderState(null);
    setFolderStatus(`读取文件夹失败：${String(error)}`, 'error');
    return null;
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
    await markInitialSetupComplete();
    initialSetupComplete = true;
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
    const renderShortcut = (element: HTMLElement, name: string): void => {
      const cmd = commands.find((command) => command.name === name);
      element.textContent = cmd?.shortcut
        ? `当前：${cmd.shortcut}`
        : '当前：未绑定（点击右侧按钮绑定）';
    };
    renderShortcut(shortcutValueEl, 'save-clip');
    renderShortcut(obsidianShortcutValueEl, 'save-to-obsidian');
  } catch (e) {
    shortcutValueEl.textContent = `读取失败：${String(e)}`;
    obsidianShortcutValueEl.textContent = `读取失败：${String(e)}`;
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

/** 依据 API Key 是否已填写，更新 Obsidian 折叠标题上的摘要标签。 */
function refreshObsidianSummary(): void {
  const configured = obsidianApiKeyInput.value.trim().length > 0;
  obsidianSummaryStateEl.textContent = configured ? '已配置' : '未配置';
  obsidianSummaryStateEl.dataset.kind = configured ? 'ok' : 'muted';
}

/** 切换 API Key 明/密文显示；只改页面临时状态，不视为表单修改。 */
function onToggleApiKey(): void {
  const reveal = obsidianApiKeyInput.type === 'password';
  obsidianApiKeyInput.type = reveal ? 'text' : 'password';
  toggleApiKeyBtn.textContent = reveal ? '隐藏' : '显示';
  toggleApiKeyBtn.setAttribute('aria-pressed', String(reveal));
  toggleApiKeyBtn.setAttribute('aria-label', `${reveal ? '隐藏' : '显示'} API Key`);
}

/** 切换「一图速览」API Key 明/密文；同样不触发表单脏标记。 */
function onToggleAiApiKey(): void {
  const reveal = aiApiKeyInput.type === 'password';
  aiApiKeyInput.type = reveal ? 'text' : 'password';
  toggleAiApiKeyBtn.textContent = reveal ? '隐藏' : '显示';
  toggleAiApiKeyBtn.setAttribute('aria-pressed', String(reveal));
  toggleAiApiKeyBtn.setAttribute('aria-label', `${reveal ? '隐藏' : '显示'} API Key`);
}

async function init(): Promise<void> {
  currentSettings = await loadSettings();
  initialSetupComplete = await isInitialSetupComplete();
  subfolderInput.value = currentSettings.save.subfolder;
  saveAsInput.checked = currentSettings.save.saveAs;
  filenameTemplateInput.value = currentSettings.filename.template;
  obsidianApiBaseUrlInput.value = currentSettings.obsidian.apiUrl;
  obsidianApiKeyInput.value = currentSettings.obsidian.apiKey;
  noteFolderInput.value = currentSettings.obsidian.noteDirectory;
  for (const [name, input] of Object.entries(frontmatterInputs) as Array<[keyof ObsidianFrontmatterSettings, HTMLInputElement]>) {
    input.checked = currentSettings.obsidian.frontmatter[name];
  }
  aiEnabledInput.checked = currentSettings.ai.enabled;
  aiEndpointInput.value = currentSettings.ai.endpoint;
  aiApiKeyInput.value = currentSettings.ai.apiKey;
  aiModelInput.value = currentSettings.ai.model;
  appVersionEl.textContent = `v${chrome.runtime.getManifest().version}`;
  refreshObsidianSummary();
  const handle = await refreshFolderState();
  if (!initialSetupComplete && handle) {
    await markInitialSetupComplete();
    initialSetupComplete = true;
    renderInitialSetupState();
  }
  await refreshShortcut();
  initialized = true;
  setDirty(false);
}

form.addEventListener('input', markDirty);
form.addEventListener('change', markDirty);

form.addEventListener('submit', (e) => {
  e.preventDefault();
  void onSubmit();
});

async function onSubmit(): Promise<void> {
  if (!initialized || !initialSetupComplete || form.dataset.saving === 'true' || saveBtn.disabled) return;

  const settings = readFormSettings();
  if (!validateFilenameTemplateForSave(settings.filename.template)) {
    setDirty(true);
    return;
  }
  subfolderInput.value = settings.save.subfolder;
  form.dataset.saving = 'true';
  saveBtn.disabled = true;
  saveBtn.textContent = '保存中…';
  setSaveStatus('保存中…');

  try {
    await saveSettings(settings);
    currentSettings = settings;
    refreshObsidianSummary();
    setDirty(false);
    setSaveStatus('设置已保存', 'ok');
  } catch (error) {
    setDirty(true);
    setSaveStatus(`保存失败：${String(error)}`, 'error');
  } finally {
    form.dataset.saving = 'false';
    saveBtn.textContent = '保存更改';
  }
}

async function onTestObsidian(): Promise<void> {
  testObsidianBtn.disabled = true;
  testObsidianBtn.textContent = '测试中…';
  setInlineStatus(obsidianStatus, '正在连接…');

  try {
    const settings = readFormSettings();
    if (!validateFilenameTemplateForSave(settings.filename.template)) return;
    await saveSettings(settings);
    currentSettings = settings;
    setDirty(false);
    refreshObsidianSummary();

    const response = await runtimeSend<{ success: boolean; service?: string; error?: string }>({
      type: 'TEST_OBSIDIAN',
    });
    if (!response.success) {
      setInlineStatus(
        obsidianStatus,
        response.error ? `连接失败：${response.error}` : '连接失败，请检查地址或 API Key。',
        'error',
      );
      return;
    }

    setInlineStatus(
      obsidianStatus,
      `连接成功：${response.service ?? 'Obsidian Local REST API'}`,
      'ok',
    );
  } catch (error) {
    setInlineStatus(obsidianStatus, `测试失败：${String(error)}`, 'error');
  } finally {
    testObsidianBtn.disabled = false;
    testObsidianBtn.textContent = '测试连接';
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

function permissionsContains(permissions: chrome.permissions.Permissions): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.permissions.contains(permissions, (result) => resolve(result === true));
  });
}

function permissionsRequest(permissions: chrome.permissions.Permissions): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.permissions.request(permissions, (granted) => resolve(granted === true));
  });
}

/**
 * 确保运行时已获得该 AI Endpoint 域名的主机权限。
 * 已授权直接通过；未授权弹出浏览器权限请求，用户拒绝则返回 false。
 */
async function ensureAiOriginPermission(endpoint: string): Promise<boolean> {
  const pattern = getAiOriginPattern(endpoint);
  if (pattern === null) return false;
  if (await permissionsContains({ origins: [pattern] })) return true;
  return permissionsRequest({ origins: [pattern] });
}

/** 调用 Background 的 TEST_AI 并就近显示结果。 */
async function testAiConnection(): Promise<void> {
  const response = await runtimeSend<{ success: boolean; model?: string; error?: string }>({
    type: 'TEST_AI',
  });
  if (!response.success) {
    setInlineStatus(
      aiStatus,
      response.error ? `连接失败：${response.error}` : '连接失败，请检查 Endpoint、API Key 或模型。',
      'error',
    );
    return;
  }
  setInlineStatus(aiStatus, `连接成功：${response.model ?? 'OpenAI Compatible API'}`, 'ok');
}

/** 授权并测试：保存当前 AI 字段 → 请求域名权限 → 测试连接。 */
async function onAuthorizeAndTestAi(): Promise<void> {
  aiAuthorizeBtn.disabled = true;
  aiAuthorizeBtn.textContent = '处理中…';
  setInlineStatus(aiStatus, '正在保存配置…');
  try {
    const settings = readFormSettings();
    const endpoint = normalizeAiEndpoint(settings.ai.endpoint);
    if (endpoint === null) {
      setInlineStatus(aiStatus, 'Endpoint 不支持：仅 HTTPS 或 localhost / 127.0.0.1。', 'error');
      return;
    }
    const next = { ...settings, ai: { ...settings.ai, endpoint } };
    await saveSettings(next);
    currentSettings = next;
    setDirty(false);
    if (!(await ensureAiOriginPermission(endpoint))) {
      setInlineStatus(aiStatus, '未获得该 API 域名的访问权限，无法测试。', 'error');
      return;
    }
    await testAiConnection();
  } catch (error) {
    setInlineStatus(aiStatus, `处理失败：${String(error)}`, 'error');
  } finally {
    aiAuthorizeBtn.disabled = false;
    aiAuthorizeBtn.textContent = '授权并测试';
  }
}

/** 测试连接：保存当前 AI 字段，必要时请求域名权限后调用 TEST_AI。 */
async function onTestAi(): Promise<void> {
  aiTestBtn.disabled = true;
  aiTestBtn.textContent = '测试中…';
  setInlineStatus(aiStatus, '正在测试…');
  try {
    const settings = readFormSettings();
    const endpoint = normalizeAiEndpoint(settings.ai.endpoint);
    if (endpoint === null) {
      setInlineStatus(aiStatus, 'Endpoint 不支持：仅 HTTPS 或 localhost / 127.0.0.1。', 'error');
      return;
    }
    const next = { ...settings, ai: { ...settings.ai, endpoint } };
    await saveSettings(next);
    currentSettings = next;
    setDirty(false);
    if (!(await ensureAiOriginPermission(endpoint))) {
      setInlineStatus(aiStatus, '未获得该 API 域名的访问权限。', 'error');
      return;
    }
    await testAiConnection();
  } catch (error) {
    setInlineStatus(aiStatus, `测试失败：${String(error)}`, 'error');
  } finally {
    aiTestBtn.disabled = false;
    aiTestBtn.textContent = '测试连接';
  }
}

chooseFolderBtn.addEventListener('click', () => void onChooseFolder());
clearFolderBtn.addEventListener('click', () => void onClearFolder());
shortcutBtn.addEventListener('click', onOpenShortcuts);
obsidianShortcutBtn.addEventListener('click', onOpenShortcuts);
testObsidianBtn.addEventListener('click', () => void onTestObsidian());
toggleApiKeyBtn.addEventListener('click', onToggleApiKey);
toggleAiApiKeyBtn.addEventListener('click', onToggleAiApiKey);
aiAuthorizeBtn.addEventListener('click', () => void onAuthorizeAndTestAi());
aiTestBtn.addEventListener('click', () => void onTestAi());

document.addEventListener('DOMContentLoaded', () => {
  void init();
});
