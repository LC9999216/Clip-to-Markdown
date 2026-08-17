# Clip2MD Settings Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Clip2MD 设置页改造成已确认的单列分组卡片结构，让用户首先看见当前保存位置，并为备用下载、快捷键、Obsidian、高级状态反馈建立一致且可测试的交互。

**Architecture:** 保留现有 `loadSettings()` / `saveSettings()`、IndexedDB 目录句柄和 `TEST_OBSIDIAN` 消息协议，只重组 options 页的语义 HTML、CSS 和页面内临时 UI 状态。行为测试直接在 jsdom 中挂载真实 `options.html`，动态导入 `options.ts`，并 mock 自定义目录模块与 Chrome API；不引入新框架或持久化字段。

**Tech Stack:** TypeScript 7、原生 HTML/CSS、Chrome Extension Manifest V3、Vitest 4、jsdom 29、esbuild。

---

## 实施边界与文件职责

实施时只允许触及以下文件：

- Modify: `src/options/options.html` — 设置页语义结构、卡片顺序、折叠区和状态区域。
- Modify: `src/options/options.css` — 设计令牌、卡片布局、控件状态、焦点样式和响应式规则。
- Modify: `src/options/options.ts` — 目录状态、折叠默认值、表单脏状态、统一反馈和 API Key 显示切换。
- Create: `tests/options.test.ts` — 设置页真实 HTML 结构与交互回归测试。

明确不修改：

- `src/core/settings.ts`
- `src/core/custom-folder.ts`
- `src/background/obsidian.ts`
- `src/types/messages.ts`
- popup、adapter、content script 及当前工作区中的其他未提交文件

当前工作区不是干净状态。每次提交必须使用下文列出的精确路径，不得运行 `git add .`、`git reset`、`git checkout --` 或整理无关差异。

## 开始前基线

- [ ] 在项目根目录确认现有状态并保存输出：

```powershell
git status --short
git diff -- src/options/options.html src/options/options.css src/options/options.ts
```

Expected: 能看到当前 options 文件已有的用户修改；后续实施必须在其上增量修改，不覆盖其他工作。

- [ ] 运行当前工程基线：

```powershell
npm run typecheck
npm test
npm run build
```

Expected: 三条命令全部退出码为 `0`。若基线已失败，先记录失败，不把无关修复混入本计划。

### Task 1: 建立真实页面测试并重组语义 HTML

**Files:**

- Create: `tests/options.test.ts`
- Modify: `src/options/options.html:10-105`

- [ ] **Step 1: 写入失败的页面结构测试**

创建 `tests/options.test.ts`：

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const optionsHtml = readFileSync(
  join(process.cwd(), 'src', 'options', 'options.html'),
  'utf8',
).replace('<script src="options.js"></script>', '');

function mountOptionsHtml(): void {
  document.open();
  document.write(optionsHtml);
  document.close();
}

beforeEach(() => {
  mountOptionsHtml();
});

describe('Clip2MD 设置页结构', () => {
  it('按保存位置、快捷键、Obsidian、保存栏的优先级组织页面', () => {
    const form = document.getElementById('settings-form');
    expect(form).not.toBeNull();

    const sectionIds = [...form!.querySelectorAll<HTMLElement>('[data-settings-section]')]
      .map((element) => element.id);
    expect(sectionIds).toEqual([
      'save-location-card',
      'shortcut-card',
      'obsidian-settings',
    ]);

    expect(document.getElementById('fallback-download-settings')).toBeInstanceOf(HTMLDetailsElement);
    expect((document.getElementById('obsidian-settings') as HTMLDetailsElement).open).toBe(false);
    expect(document.querySelector('.save-bar')).not.toBeNull();
  });

  it('保留现有控制器绑定 ID 并提供新增状态控件', () => {
    const requiredIds = [
      'choose-folder',
      'clear-folder',
      'folder-name',
      'folder-status',
      'shortcut-value',
      'shortcut-btn',
      'subfolder',
      'save-as',
      'obsidian-api-base-url',
      'obsidian-api-key',
      'note-folder',
      'test-obsidian-btn',
      'obsidian-status',
      'save-btn',
      'save-status',
      'folder-connection-state',
      'obsidian-summary-state',
      'toggle-api-key',
    ];

    for (const id of requiredIds) {
      expect(document.getElementById(id), `missing #${id}`).not.toBeNull();
    }

    expect((document.getElementById('obsidian-api-key') as HTMLInputElement).type).toBe('password');
    expect(document.getElementById('save-status')?.getAttribute('aria-live')).toBe('polite');
  });
});
```

- [ ] **Step 2: 运行结构测试并确认失败**

```powershell
npx vitest run tests/options.test.ts
```

Expected: FAIL，至少包含 `data-settings-section` 顺序为空或缺少 `#fallback-download-settings`。

- [ ] **Step 3: 用已确认的卡片结构替换 `<main id="app">` 内容**

在 `src/options/options.html` 中保留原有 `<head>` 与脚本引用，用以下内容替换 `<main id="app">...</main>`：

```html
<main id="app">
  <header class="app-header">
    <h1>Clip2MD 设置</h1>
    <p class="subtitle">配置 Markdown 文件的保存方式</p>
  </header>

  <form id="settings-form" novalidate>
    <section
      id="save-location-card"
      class="settings-card"
      data-settings-section
      aria-labelledby="save-location-title"
    >
      <div class="settings-card__header">
        <div>
          <h2 id="save-location-title">保存位置</h2>
          <p class="card-description">当前内容将保存到以下位置</p>
        </div>
        <span id="folder-connection-state" class="status-badge" data-kind="muted">加载中</span>
      </div>

      <div class="folder-summary">
        <span class="folder-icon" aria-hidden="true">📁</span>
        <div class="folder-meta">
          <strong id="folder-name">正在读取…</strong>
          <span id="folder-mode-description">检查自定义文件夹状态</span>
        </div>
        <button id="choose-folder" type="button" class="secondary-button">选择文件夹</button>
        <button id="clear-folder" type="button" class="text-button danger-action" hidden>清除</button>
      </div>
      <p id="folder-status" class="inline-status" data-kind="muted" role="status" aria-live="polite"></p>

      <details id="fallback-download-settings" class="nested-details">
        <summary>
          <span>
            <strong>备用下载设置</strong>
            <small>仅未选择自定义文件夹时生效</small>
          </span>
          <span class="chevron" aria-hidden="true"></span>
        </summary>
        <div class="details-body">
          <div class="field">
            <label for="subfolder">子目录</label>
            <input
              id="subfolder"
              name="subfolder"
              type="text"
              placeholder="例如：Clip2MD/知乎"
              spellcheck="false"
            />
            <p class="hint">相对浏览器下载目录；留空则直接保存到下载目录。</p>
          </div>
          <label class="checkbox">
            <input id="save-as" name="save-as" type="checkbox" />
            <span>每次保存时询问位置</span>
          </label>
        </div>
      </details>
    </section>

    <section
      id="shortcut-card"
      class="settings-card"
      data-settings-section
      aria-labelledby="shortcut-title"
    >
      <div class="shortcut-layout">
        <div>
          <h2 id="shortcut-title">快速保存</h2>
          <p class="card-description">无需打开扩展窗口即可保存当前页面</p>
        </div>
        <kbd id="shortcut-value">加载中…</kbd>
        <button id="shortcut-btn" type="button" class="text-button">修改</button>
      </div>
    </section>

    <details
      id="obsidian-settings"
      class="settings-card details-card"
      data-settings-section
    >
      <summary>
        <span class="obsidian-mark" aria-hidden="true">O</span>
        <span class="summary-copy">
          <strong>Obsidian</strong>
          <small>通过 Local REST API 保存到笔记库</small>
        </span>
        <span id="obsidian-summary-state" class="status-badge" data-kind="muted">未配置</span>
        <span class="advanced-badge">高级设置</span>
        <span class="chevron" aria-hidden="true"></span>
      </summary>

      <div class="details-body obsidian-fields">
        <p class="hint intro-hint">
          需在 Local REST API with MCP 插件中启用
          <strong>Enable Non-encrypted (HTTP) Server</strong> 并复制 API Key。
        </p>

        <div class="field">
          <label for="obsidian-api-base-url">Local REST API 地址</label>
          <input
            id="obsidian-api-base-url"
            name="obsidian-api-base-url"
            type="text"
            placeholder="http://127.0.0.1:27123"
            spellcheck="false"
          />
        </div>

        <div class="field">
          <label for="obsidian-api-key">API Key</label>
          <div class="secret-input-row">
            <input
              id="obsidian-api-key"
              name="obsidian-api-key"
              type="password"
              placeholder="粘贴 Local REST API 插件里的 API Key"
              autocomplete="off"
              spellcheck="false"
            />
            <button
              id="toggle-api-key"
              type="button"
              class="secondary-button compact-button"
              aria-pressed="false"
              aria-label="显示 API Key"
            >显示</button>
          </div>
        </div>

        <div class="field">
          <label for="note-folder">笔记目录</label>
          <input
            id="note-folder"
            name="note-folder"
            type="text"
            placeholder="例如：Clippings/Bilibili"
            spellcheck="false"
          />
          <p class="hint">相对 vault 根目录；目录不存在时会自动创建。</p>
        </div>

        <div class="inline-actions">
          <button id="test-obsidian-btn" type="button" class="secondary-button">测试连接</button>
          <span id="obsidian-status" class="inline-status" data-kind="muted" role="status" aria-live="polite"></span>
        </div>
      </div>
    </details>

    <footer class="save-bar">
      <span id="save-status" class="inline-status" data-kind="muted" role="status" aria-live="polite"></span>
      <button id="save-btn" type="submit" class="primary-button">保存更改</button>
    </footer>
  </form>
</main>
```

- [ ] **Step 4: 运行结构测试**

```powershell
npx vitest run tests/options.test.ts
```

Expected: 2 tests PASS。

- [ ] **Step 5: 提交语义结构**

```powershell
git add -- src/options/options.html tests/options.test.ts
git commit -m "feat(options): reorganize settings page structure"
```

Expected: 提交只包含上述两个路径。

### Task 2: 根据目录句柄驱动有效保存位置与备用下载区

**Files:**

- Modify: `tests/options.test.ts`
- Modify: `src/options/options.ts:14-102,136-145`

- [ ] **Step 1: 为 options 控制器增加稳定测试基建**

在 `tests/options.test.ts` 顶部补充以下导入和 mock；将 `mountOptionsHtml()` 保留：

```ts
import { commandsGetAllMock, mockStoredSettings, runtimeSendMessageMock } from './setup';

const folderMocks = vi.hoisted(() => ({
  loadDirectoryHandle: vi.fn(),
  saveDirectoryHandle: vi.fn(),
  clearDirectoryHandle: vi.fn(),
}));

vi.mock('../src/core/custom-folder', () => folderMocks);

function fakeDirectoryHandle(name: string): FileSystemDirectoryHandle {
  return { name } as FileSystemDirectoryHandle;
}

async function bootOptions(handle: FileSystemDirectoryHandle | null = null): Promise<void> {
  folderMocks.loadDirectoryHandle.mockResolvedValue(handle);
  folderMocks.saveDirectoryHandle.mockResolvedValue(undefined);
  folderMocks.clearDirectoryHandle.mockResolvedValue(undefined);

  commandsGetAllMock.mockImplementation((callback?: (commands: chrome.commands.Command[]) => void) => {
    const commands = [{ name: 'save-clip', shortcut: 'Ctrl+Shift+S' } as chrome.commands.Command];
    callback?.(commands);
    return Promise.resolve(commands) as never;
  });
  runtimeSendMessageMock.mockImplementation((_message, callback?: (response: unknown) => void) => {
    callback?.({ success: true, service: 'Obsidian Local REST API' });
  });

  await import('../src/options/options');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await vi.waitFor(() => {
    expect(document.getElementById('shortcut-value')?.textContent).toContain('Ctrl+Shift+S');
  });
}
```

把测试文件的 Vitest 导入改为：

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
```

并用以下内容替换现有的全局 `beforeEach`：

```ts
vi.resetModules();
folderMocks.loadDirectoryHandle.mockReset();
folderMocks.saveDirectoryHandle.mockReset();
folderMocks.clearDirectoryHandle.mockReset();
commandsGetAllMock.mockReset();
runtimeSendMessageMock.mockReset();
mountOptionsHtml();
mockStoredSettings['clip2md.settings'] = {
  subfolder: '',
  saveAs: false,
  obsidianApiBaseUrl: 'http://127.0.0.1:27123',
  obsidianApiKey: '',
  noteFolder: 'Clippings',
};
```

- [ ] **Step 2: 写入目录状态失败测试**

在同一文件追加：

```ts
describe('保存位置状态', () => {
  it('有自定义目录时显示目录名称并收起备用下载设置', async () => {
    await bootOptions(fakeDirectoryHandle('Clippings'));

    expect(document.getElementById('folder-name')?.textContent).toBe('Clippings');
    expect(document.getElementById('folder-connection-state')?.textContent).toBe('已连接');
    expect(document.getElementById('folder-mode-description')?.textContent)
      .toContain('绕过浏览器下载目录');
    expect((document.getElementById('fallback-download-settings') as HTMLDetailsElement).open).toBe(false);
    expect(document.getElementById('clear-folder')?.hidden).toBe(false);
    expect(document.getElementById('choose-folder')?.textContent).toBe('更改');
  });

  it('没有自定义目录时自动展开备用下载设置', async () => {
    await bootOptions(null);

    expect(document.getElementById('folder-name')?.textContent).toBe('浏览器下载目录');
    expect(document.getElementById('folder-connection-state')?.textContent).toBe('未选择');
    expect((document.getElementById('fallback-download-settings') as HTMLDetailsElement).open).toBe(true);
    expect(document.getElementById('clear-folder')?.hidden).toBe(true);
    expect(document.getElementById('choose-folder')?.textContent).toBe('选择文件夹');
  });

  it('清除自定义目录后立即切回备用下载状态', async () => {
    await bootOptions(fakeDirectoryHandle('Clippings'));
    folderMocks.loadDirectoryHandle.mockResolvedValue(null);

    (document.getElementById('clear-folder') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(folderMocks.clearDirectoryHandle).toHaveBeenCalledOnce();
      expect((document.getElementById('fallback-download-settings') as HTMLDetailsElement).open).toBe(true);
      expect(document.getElementById('folder-status')?.textContent).toContain('浏览器下载目录');
    });
  });
});
```

- [ ] **Step 3: 运行目录状态测试并确认失败**

```powershell
npx vitest run tests/options.test.ts -t "保存位置状态"
```

Expected: FAIL，缺少 `folder-mode-description` 查询或状态仍为旧文案。

- [ ] **Step 4: 在控制器中实现单一目录状态渲染函数**

在 `src/options/options.ts` 的 DOM 查询区域补充：

```ts
const folderConnectionStateEl = document.getElementById('folder-connection-state') as HTMLSpanElement;
const folderModeDescriptionEl = document.getElementById('folder-mode-description') as HTMLSpanElement;
const fallbackDownloadDetails = document.getElementById('fallback-download-settings') as HTMLDetailsElement;
```

将原 `refreshFolderLabel()` 替换为：

```ts
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

async function refreshFolderState(): Promise<void> {
  try {
    renderFolderState(await loadDirectoryHandle());
  } catch (error) {
    renderFolderState(null);
    setFolderStatus(`读取文件夹失败：${String(error)}`, 'error');
  }
}
```

把 `onChooseFolder()`、`onClearFolder()` 和 `init()` 中的 `refreshFolderLabel()` 全部改为 `refreshFolderState()`。

- [ ] **Step 5: 运行测试并提交**

```powershell
npx vitest run tests/options.test.ts -t "保存位置状态"
npx vitest run tests/options.test.ts
git add -- src/options/options.ts tests/options.test.ts
git commit -m "feat(options): show effective save destination"
```

Expected: targeted tests 与完整 options tests 全部 PASS；提交仅含两个路径。

### Task 3: 实现表单脏状态与统一保存反馈

**Files:**

- Modify: `tests/options.test.ts`
- Modify: `src/options/options.ts:34-42,136-172`

- [ ] **Step 1: 写入保存按钮状态测试**

在 `tests/options.test.ts` 追加：

```ts
describe('表单保存状态', () => {
  it('初始化时禁用保存按钮，用户修改后启用，保存成功后再次禁用', async () => {
    await bootOptions(null);
    const input = document.getElementById('subfolder') as HTMLInputElement;
    const saveButton = document.getElementById('save-btn') as HTMLButtonElement;

    expect(saveButton.disabled).toBe(true);
    input.value = 'Clip2MD/知乎';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(saveButton.disabled).toBe(false);

    saveButton.click();
    await vi.waitFor(() => {
      expect(document.getElementById('save-status')?.textContent).toBe('设置已保存');
      expect(saveButton.disabled).toBe(true);
      expect(mockStoredSettings['clip2md.settings']).toMatchObject({
        subfolder: 'Clip2MD/知乎',
      });
    });
  });

  it('保存失败时保留可重试状态', async () => {
    const { setRuntimeLastError } = await import('./setup');
    await bootOptions(null);
    const input = document.getElementById('note-folder') as HTMLInputElement;
    const saveButton = document.getElementById('save-btn') as HTMLButtonElement;

    input.value = 'Clippings/Bilibili';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    setRuntimeLastError('storage unavailable');
    saveButton.click();

    await vi.waitFor(() => {
      expect(document.getElementById('save-status')?.textContent).toContain('保存失败');
      expect(saveButton.disabled).toBe(false);
    });
    setRuntimeLastError(null);
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

```powershell
npx vitest run tests/options.test.ts -t "表单保存状态"
```

Expected: FAIL，当前初始化后按钮不会建立脏状态，保存后 `finally` 会重新启用按钮。

- [ ] **Step 3: 增加统一状态函数与表单快照函数**

在 `src/options/options.ts` 中用以下代码替换现有 `setFolderStatus` / `setSaveStatus` 定义，并在其后加入表单状态函数：

```ts
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
    subfolder: sanitizeSubfolder(subfolderInput.value),
    saveAs: saveAsInput.checked,
    obsidianApiBaseUrl: obsidianApiBaseUrlInput.value,
    obsidianApiKey: obsidianApiKeyInput.value,
    noteFolder: noteFolderInput.value,
  };
}

let initialized = false;

function setDirty(dirty: boolean): void {
  form.dataset.dirty = String(dirty);
  saveBtn.disabled = !dirty;
}

function markDirty(): void {
  if (!initialized) return;
  setSaveStatus('');
  setDirty(true);
}
```

- [ ] **Step 4: 让初始化、输入和提交遵守脏状态**

在 `init()` 末尾加入：

```ts
initialized = true;
setDirty(false);
```

在表单 submit 监听前加入：

```ts
form.addEventListener('input', markDirty);
form.addEventListener('change', markDirty);
```

用以下实现替换 `onSubmit()`：

```ts
async function onSubmit(): Promise<void> {
  if (!initialized || form.dataset.saving === 'true' || saveBtn.disabled) return;

  const settings = readFormSettings();
  subfolderInput.value = settings.subfolder;
  form.dataset.saving = 'true';
  saveBtn.disabled = true;
  saveBtn.textContent = '保存中…';
  setSaveStatus('保存中…');

  try {
    await saveSettings(settings);
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
```

- [ ] **Step 5: 运行测试并提交**

```powershell
npx vitest run tests/options.test.ts -t "表单保存状态"
npx vitest run tests/options.test.ts
git add -- src/options/options.ts tests/options.test.ts
git commit -m "feat(options): track unsaved settings changes"
```

Expected: 保存成功与失败测试均 PASS；失败后按钮可重试。

### Task 4: 完成 Obsidian 高级区、API Key 切换与连接反馈

**Files:**

- Modify: `tests/options.test.ts`
- Modify: `src/options/options.ts:20-24,174-209`

- [ ] **Step 1: 写入 API Key 与连接测试**

在 `tests/options.test.ts` 追加：

```ts
describe('Obsidian 高级设置', () => {
  it('默认收起并允许显示或隐藏 API Key，但不把显示状态视为表单修改', async () => {
    await bootOptions(null);
    const details = document.getElementById('obsidian-settings') as HTMLDetailsElement;
    const input = document.getElementById('obsidian-api-key') as HTMLInputElement;
    const toggle = document.getElementById('toggle-api-key') as HTMLButtonElement;
    const saveButton = document.getElementById('save-btn') as HTMLButtonElement;

    expect(details.open).toBe(false);
    expect(input.type).toBe('password');
    toggle.click();
    expect(input.type).toBe('text');
    expect(toggle.textContent).toBe('隐藏');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(saveButton.disabled).toBe(true);

    toggle.click();
    expect(input.type).toBe('password');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('测试连接时保存当前字段、更新摘要并就近显示成功', async () => {
    await bootOptions(null);
    const apiKey = document.getElementById('obsidian-api-key') as HTMLInputElement;
    apiKey.value = 'secret-key';
    apiKey.dispatchEvent(new Event('input', { bubbles: true }));

    (document.getElementById('test-obsidian-btn') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(runtimeSendMessageMock).toHaveBeenCalledWith(
        { type: 'TEST_OBSIDIAN' },
        expect.any(Function),
      );
      expect(mockStoredSettings['clip2md.settings']).toMatchObject({ obsidianApiKey: 'secret-key' });
      expect(document.getElementById('obsidian-status')?.textContent)
        .toContain('连接成功');
      expect(document.getElementById('obsidian-summary-state')?.textContent).toBe('已配置');
      expect((document.getElementById('save-btn') as HTMLButtonElement).disabled).toBe(true);
    });
  });

  it('连接失败时给出可操作提示', async () => {
    runtimeSendMessageMock.mockImplementation((_message, callback?: (response: unknown) => void) => {
      callback?.({ success: false });
    });
    await bootOptions(null);

    (document.getElementById('test-obsidian-btn') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(document.getElementById('obsidian-status')?.textContent)
        .toBe('连接失败，请检查地址或 API Key。');
      expect(document.getElementById('obsidian-status')?.dataset.kind).toBe('error');
    });
  });
});
```

调整 `bootOptions()`：仅在测试没有预先指定实现时设置默认 `runtimeSendMessageMock`，避免覆盖失败测试：

```ts
if (runtimeSendMessageMock.getMockImplementation() === undefined) {
  runtimeSendMessageMock.mockImplementation((_message, callback?: (response: unknown) => void) => {
    callback?.({ success: true, service: 'Obsidian Local REST API' });
  });
}
```

- [ ] **Step 2: 运行测试并确认失败**

```powershell
npx vitest run tests/options.test.ts -t "Obsidian 高级设置"
```

Expected: FAIL，`#toggle-api-key` 尚无监听，摘要状态也不会更新。

- [ ] **Step 3: 增加 Obsidian DOM 引用与摘要函数**

在 `src/options/options.ts` 的 Obsidian DOM 查询区域补充：

```ts
const toggleApiKeyBtn = document.getElementById('toggle-api-key') as HTMLButtonElement;
const obsidianSummaryStateEl = document.getElementById('obsidian-summary-state') as HTMLSpanElement;
```

加入：

```ts
function refreshObsidianSummary(): void {
  const configured = obsidianApiKeyInput.value.trim().length > 0;
  obsidianSummaryStateEl.textContent = configured ? '已配置' : '未配置';
  obsidianSummaryStateEl.dataset.kind = configured ? 'ok' : 'muted';
}

function onToggleApiKey(): void {
  const reveal = obsidianApiKeyInput.type === 'password';
  obsidianApiKeyInput.type = reveal ? 'text' : 'password';
  toggleApiKeyBtn.textContent = reveal ? '隐藏' : '显示';
  toggleApiKeyBtn.setAttribute('aria-pressed', String(reveal));
  toggleApiKeyBtn.setAttribute('aria-label', `${reveal ? '隐藏' : '显示'} API Key`);
}
```

在 `init()` 中填充 Obsidian 字段后调用：

```ts
refreshObsidianSummary();
```

并在 `onSubmit()` 的 `await saveSettings(settings);` 之后、`setDirty(false);` 之前加入同一调用，确保普通保存也会刷新摘要：

```ts
refreshObsidianSummary();
```

- [ ] **Step 4: 用统一保存快照重写连接测试流程**

用以下实现替换 `onTestObsidian()`：

```ts
async function onTestObsidian(): Promise<void> {
  testObsidianBtn.disabled = true;
  testObsidianBtn.textContent = '测试中…';
  setInlineStatus(obsidianStatus, '正在连接…');

  try {
    await saveSettings(readFormSettings());
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
```

在底部监听器区域加入：

```ts
toggleApiKeyBtn.addEventListener('click', onToggleApiKey);
```

- [ ] **Step 5: 运行测试并提交**

```powershell
npx vitest run tests/options.test.ts -t "Obsidian 高级设置"
npx vitest run tests/options.test.ts
git add -- src/options/options.ts tests/options.test.ts
git commit -m "feat(options): polish Obsidian settings interactions"
```

Expected: Obsidian 3 个测试与全部 options 测试 PASS。

### Task 5: 应用视觉令牌、卡片样式、密码框样式和响应式布局

**Files:**

- Modify: `tests/options.test.ts`
- Modify: `src/options/options.css:1-169`

- [ ] **Step 1: 写入关键 CSS 契约测试**

在 `tests/options.test.ts` 顶部定义：

```ts
const optionsCss = readFileSync(
  join(process.cwd(), 'src', 'options', 'options.css'),
  'utf8',
);
```

追加：

```ts
describe('设置页视觉契约', () => {
  it('包含已确认的设计令牌、密码框、键盘焦点和窄屏规则', () => {
    expect(optionsCss).toContain('--page-bg: #f6f8fb');
    expect(optionsCss).toContain('max-width: 680px');
    expect(optionsCss).toMatch(/input\[type="text"\][\s\S]*input\[type="password"\]/);
    expect(optionsCss).toContain(':focus-visible');
    expect(optionsCss).toContain('@media (max-width: 540px)');
    expect(optionsCss).toContain('.settings-card');
    expect(optionsCss).toContain('.save-bar');
  });
});
```

- [ ] **Step 2: 运行视觉契约测试并确认失败**

```powershell
npx vitest run tests/options.test.ts -t "设置页视觉契约"
```

Expected: FAIL，当前背景、最大宽度、密码框和响应式规则不符合契约。

- [ ] **Step 3: 用以下职责明确的样式段重写 `options.css`**

样式必须完整覆盖这些分区；实现时按此顺序写入文件：

```css
:root {
  --page-bg: #f6f8fb;
  --surface: #ffffff;
  --text: #172033;
  --muted: #667085;
  --subtle: #98a2b3;
  --border: #e1e7ef;
  --brand: #2563eb;
  --brand-hover: #1d4ed8;
  --success: #18794e;
  --success-bg: #eaf8f0;
  --danger: #b42318;
  --focus-ring: rgba(37, 99, 235, 0.2);
}

* { box-sizing: border-box; }
[hidden] { display: none !important; }

body {
  margin: 0;
  color: var(--text);
  background: var(--page-bg);
  font: 14px/1.5 system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}

#app {
  max-width: 680px;
  margin: 0 auto;
  padding: 36px 24px 56px;
}

.app-header { margin-bottom: 22px; }
.app-header h1 { margin: 0; font-size: 24px; line-height: 1.25; font-weight: 750; }
.subtitle { margin: 6px 0 0; color: var(--muted); }
#settings-form { display: grid; gap: 14px; }

.settings-card {
  min-width: 0;
  padding: 20px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
  box-shadow: 0 4px 14px rgba(24, 39, 75, 0.04);
}

.settings-card h2,
.settings-card__header h2 { margin: 0; font-size: 15px; line-height: 1.4; }
.settings-card__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.card-description { margin: 4px 0 0; color: var(--muted); font-size: 12px; }

.status-badge,
.advanced-badge {
  flex: none;
  padding: 3px 8px;
  border-radius: 999px;
  background: #f2f4f7;
  color: var(--muted);
  font-size: 11px;
  font-weight: 650;
}
.status-badge[data-kind="ok"] { color: var(--success); background: var(--success-bg); }

.folder-summary {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
  padding: 11px 12px;
  border: 1px solid #e4e9f1;
  border-radius: 10px;
  background: #f7f9fc;
}
.folder-icon { font-size: 16px; }
.folder-meta { display: grid; min-width: 0; }
.folder-meta strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.folder-meta span { color: var(--muted); font-size: 11px; }

.nested-details { margin-top: 16px; border-top: 1px solid #edf0f4; }
.nested-details > summary,
.details-card > summary {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  list-style: none;
}
.nested-details > summary { justify-content: space-between; padding-top: 14px; color: var(--muted); font-size: 12px; }
.nested-details > summary span:first-child { display: grid; }
.nested-details > summary small,
.summary-copy small { color: var(--muted); font-weight: 400; }
summary::-webkit-details-marker { display: none; }
.chevron { width: 8px; height: 8px; border-right: 2px solid var(--muted); border-bottom: 2px solid var(--muted); transform: rotate(45deg); transition: transform 150ms ease; }
details[open] > summary .chevron { transform: rotate(225deg); }
.details-body { margin-top: 14px; padding-top: 16px; border-top: 1px solid #edf0f4; }

.shortcut-layout { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 16px; }
kbd { padding: 7px 10px; border: 1px solid #dfe5ed; border-bottom-width: 2px; border-radius: 7px; background: #f7f9fc; color: #344054; font: inherit; font-size: 12px; }

.details-card { padding: 0; }
.details-card > summary { padding: 18px 20px; }
.details-card > .details-body { margin: 0 20px 20px; }
.obsidian-mark { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 8px; background: #6c5ce7; color: white; font-weight: 750; }
.summary-copy { display: grid; flex: 1; min-width: 0; }
.intro-hint { margin-top: 0; }

.field { margin-bottom: 18px; }
.field > label { display: block; margin-bottom: 7px; font-weight: 650; }
input[type="text"],
input[type="password"] {
  width: 100%;
  min-height: 38px;
  padding: 8px 10px;
  border: 1px solid #cfd7e3;
  border-radius: 8px;
  background: white;
  color: var(--text);
  font: inherit;
}
input[type="text"]:focus,
input[type="password"]:focus { border-color: var(--brand); outline: 3px solid var(--focus-ring); }
.secret-input-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
.hint { margin: 7px 0 0; color: var(--muted); font-size: 12px; line-height: 1.5; }
.checkbox { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; }
.checkbox input { margin-top: 3px; }

button {
  min-height: 36px;
  padding: 7px 13px;
  border: 1px solid transparent;
  border-radius: 8px;
  font: inherit;
  font-weight: 650;
  cursor: pointer;
}
button:disabled { cursor: not-allowed; opacity: 0.55; }
.primary-button { background: var(--brand); color: white; }
.primary-button:hover:not(:disabled) { background: var(--brand-hover); }
.secondary-button { border-color: #d9e0ea; background: white; color: #344054; }
.secondary-button:hover:not(:disabled) { background: #f7f9fc; }
.text-button { min-height: 36px; padding-inline: 6px; background: transparent; color: var(--brand); }
.danger-action:hover,
.danger-action:focus-visible { color: var(--danger); }
.compact-button { min-width: 58px; }
button:focus-visible,
summary:focus-visible,
input:focus-visible { outline: 3px solid var(--focus-ring); outline-offset: 2px; }

.inline-actions { display: flex; align-items: center; gap: 10px; }
.inline-status { min-height: 18px; color: var(--muted); font-size: 12px; }
.inline-status[data-kind="ok"] { color: var(--success); }
.inline-status[data-kind="error"] { color: var(--danger); }

.save-bar {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 14px 0 0;
  border-top: 1px solid var(--border);
  background: rgba(246, 248, 251, 0.94);
  backdrop-filter: blur(8px);
}

@media (max-width: 540px) {
  #app { padding: 24px 16px 40px; }
  .settings-card { padding: 16px; }
  .folder-summary { grid-template-columns: auto minmax(0, 1fr); }
  .folder-summary button { grid-row: 2; }
  .folder-summary .secondary-button { grid-column: 1 / 2; }
  .shortcut-layout { grid-template-columns: minmax(0, 1fr) auto; }
  .shortcut-layout > div { grid-column: 1 / -1; }
  .details-card > summary { padding: 16px; flex-wrap: wrap; }
  .details-card > .details-body { margin: 0 16px 16px; }
  .advanced-badge { display: none; }
  .secret-input-row { grid-template-columns: 1fr; }
  .inline-actions { align-items: flex-start; flex-direction: column; }
  .save-bar { align-items: stretch; flex-direction: column; }
  .save-bar .primary-button { width: 100%; }
}
```

- [ ] **Step 4: 运行视觉契约、全部 options 测试和构建**

```powershell
npx vitest run tests/options.test.ts -t "设置页视觉契约"
npx vitest run tests/options.test.ts
npm run typecheck
npm run build
```

Expected: 所有命令退出码为 `0`，`dist/options.css` 包含密码框和响应式规则。

- [ ] **Step 5: 提交视觉样式**

```powershell
git add -- src/options/options.css tests/options.test.ts
git commit -m "style(options): apply card-based settings layout"
```

Expected: 提交只包含 CSS 和专用测试。

### Task 6: 完成真实浏览器验证与全量回归

**Files:**

- Verify only: `dist/options.html`, `dist/options.css`, `dist/options.js`
- Review: `src/options/options.html`, `src/options/options.css`, `src/options/options.ts`, `tests/options.test.ts`

- [ ] **Step 1: 运行完整自动化验证**

```powershell
npm run typecheck
npm test
npm run build
```

Expected: TypeScript、全量 Vitest 和 esbuild 全部退出码为 `0`。

- [ ] **Step 2: 在 Chrome 中加载构建产物**

1. 打开 `chrome://extensions`。
2. 开启“开发者模式”。
3. 选择“加载已解压的扩展程序”，加载项目的 `dist/`。
4. 打开 Clip2MD 的“扩展程序选项”。

Expected: 设置页正常加载，控制台无异常，标题和三组卡片完整显示。

- [ ] **Step 3: 按 320px、560px、768px 三种宽度检查布局**

对每个宽度逐项检查：

- 无横向滚动、控件重叠或文字不可读。
- 当前保存位置、快捷键和 Obsidian 折叠入口在首屏可发现。
- API Key 输入框与文本输入框尺寸一致。
- 窄屏下按钮换行但仍保持至少约 36px 高。
- Tab 顺序遵循页面视觉顺序，所有按钮、summary 和输入框都有可见焦点。

Expected: 三种宽度全部满足上述条件。

- [ ] **Step 4: 验证保存位置与备用下载状态**

1. 无自定义文件夹时确认备用下载设置自动展开。
2. 修改子目录或复选框，确认保存按钮启用。
3. 保存后刷新，确认值恢复且按钮重新禁用。
4. 选择一个自定义文件夹，确认状态变为“已连接”、备用下载区收起。
5. 清除文件夹，确认立即切回浏览器下载目录并展开备用下载区。

Expected: 所有状态切换与就近反馈符合设计说明书。

- [ ] **Step 5: 验证快捷键与 Obsidian 状态**

1. 快捷键显示为当前 Chrome 配置；“修改”打开 `chrome://extensions/shortcuts`。
2. Obsidian 初始收起，展开后字段顺序为地址、API Key、笔记目录、测试连接。
3. API Key 默认隐藏，显示/隐藏不启用底部保存按钮。
4. 修改 API Key 后测试连接，确认最新字段先保存，成功或失败在按钮旁显示。
5. 测试完成后摘要标签更新为“已配置”，保存按钮处于干净状态。

Expected: 快捷键和 Obsidian 全路径无阻塞式弹窗，状态均在当前区域反馈。

- [ ] **Step 6: 检查精确 diff，确认没有混入现有工作**

```powershell
git diff --stat 3dd4098..HEAD -- src/options/options.html src/options/options.css src/options/options.ts tests/options.test.ts
git status --short
git log --oneline --decorate -6
```

Expected: 本计划产生的产品变更只出现在三个 options 文件和一个专用测试文件；工作区原有其他修改仍保持原样。

- [ ] **Step 7: 若浏览器验证产生必要修正，单独提交**

仅当 Step 2–5 发现本计划范围内问题时执行：

```powershell
git add -- src/options/options.html src/options/options.css src/options/options.ts tests/options.test.ts
git commit -m "fix(options): address settings page verification findings"
```

Expected: 若没有发现问题，不创建空提交。

## 最终完成标准

- `npm run typecheck`、`npm test`、`npm run build` 全部通过。
- 320px、560px、768px 三种宽度的真实扩展页验证通过。
- 当前保存位置成为第一视觉层级，备用下载只在需要时展开。
- Obsidian 默认收起，API Key 样式与显示切换正确。
- 表单只有发生修改时才允许保存，成功与失败均可就近理解和重试。
- 没有新增设置字段、数据迁移、依赖或无关重构。
- 提交历史按任务拆分，且没有暂存工作区原有的其他改动。
