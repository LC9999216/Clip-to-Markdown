# Preserve Markdown Extension in Offscreen Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复快捷键保存长标题贴文时，离屏写入二次截断文件名并丢失 `.md` 扩展名的问题。

**Architecture:** 保留现有 `prepareSave()`、`WRITE_CUSTOM` 消息和自定义文件夹写入流程，只修改离屏写入边界的防御性文件名清洗。清洗时先移除已有 `.md`，仅截断并清洗文件名主体，再统一补回 `.md`；通过真实消息监听回归测试验证最终传给 `writeMarkdownToDirectory()` 的名称。

**Tech Stack:** TypeScript、Chrome Manifest V3、File System Access API、Vitest、jsdom、esbuild

---

## File map

- Create: `tests/offscreen.test.ts` — 覆盖 `WRITE_CUSTOM` 离屏消息到自定义目录写入的文件名回归场景。
- Modify: `src/offscreen/offscreen.ts:7-34` — 在防御性清洗时保留 Markdown 扩展名。
- Verify only: `src/core/filename.ts` — 复用现有 `sanitizeFilenamePart()` 与 `ensureMarkdownFilename()`，不改变全局 80 字符规则。
- Verify only: `src/background/quick-save.ts` — 确认快捷保存继续通过 `writeViaOffscreen()` 发送相同消息，不改生命周期逻辑。

### Task 1: 用离屏写入回归测试复现扩展名丢失

**Files:**
- Create: `tests/offscreen.test.ts`
- Reference: `tests/setup.ts:27-65`
- Reference: `src/offscreen/offscreen.ts:15-35`

- [ ] **Step 1: 创建离屏写入测试并 mock 自定义文件夹模块**

创建 `tests/offscreen.test.ts`：

```ts
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchRuntimeMessage, runtimeSendMessageMock } from './setup';

const customFolderMocks = vi.hoisted(() => ({
  loadDirectoryHandle: vi.fn(),
  writeMarkdownToDirectory: vi.fn(),
}));

vi.mock('../src/core/custom-folder', () => customFolderMocks);

describe('offscreen Markdown 文件名', () => {
  const directory = { name: 'Clippings' } as FileSystemDirectoryHandle;

  beforeAll(async () => {
    runtimeSendMessageMock.mockResolvedValue(undefined);
    await import('../src/offscreen/offscreen');
  });

  beforeEach(() => {
    customFolderMocks.loadDirectoryHandle.mockReset();
    customFolderMocks.writeMarkdownToDirectory.mockReset();
    customFolderMocks.loadDirectoryHandle.mockResolvedValue(directory);
    customFolderMocks.writeMarkdownToDirectory.mockImplementation(
      async (_dir: FileSystemDirectoryHandle, filename: string) => filename,
    );
  });

  it.each([
    ['80 字符主体', `${'X'.repeat(80)}.md`, `${'X'.repeat(80)}.md`],
    ['79 字符主体', `${'X'.repeat(79)}.md`, `${'X'.repeat(79)}.md`],
    ['普通短文件名', 'note.md', 'note.md'],
  ])('%s 在离屏清洗后仍保留 .md', async (_caseName, input, expected) => {
    const response = await dispatchRuntimeMessage(
      { type: 'WRITE_CUSTOM', payload: { filename: input, markdown: '# body' } },
      { id: chrome.runtime.id },
    );

    expect(response).toEqual({ success: true, filename: `Clippings/${expected}` });
    expect(customFolderMocks.writeMarkdownToDirectory).toHaveBeenCalledWith(
      directory,
      expected,
      '# body',
    );
  });
});
```

- [ ] **Step 2: 运行回归测试，确认当前代码会失败**

Run:

```powershell
npx vitest run tests/offscreen.test.ts
```

Expected: FAIL。80 字符输入实际写入名称缺少 `.md`；79 字符输入可能在截断位置留下不完整后缀。普通短文件名用例应通过。

### Task 2: 在离屏边界先清洗主体，再补回 Markdown 扩展名

**Files:**
- Modify: `src/offscreen/offscreen.ts:7-34`
- Test: `tests/offscreen.test.ts`

- [ ] **Step 1: 扩展文件名工具导入**

把：

```ts
import { sanitizeFilenamePart } from '../core/filename';
```

改为：

```ts
import { ensureMarkdownFilename, sanitizeFilenamePart } from '../core/filename';
```

- [ ] **Step 2: 修改离屏写入的防御性清洗顺序**

把：

```ts
const safeName = sanitizeFilenamePart(payload.filename) || `clip2md-${Date.now()}.md`;
```

改为：

```ts
const safeBase = sanitizeFilenamePart(payload.filename.replace(/\.md$/i, ''));
const safeName = safeBase
  ? ensureMarkdownFilename(safeBase)
  : `clip2md-${Date.now()}.md`;
```

该改动只处理保存边界：已有 `.md` 先从主体中剥离，主体继续遵守 80 字符及 Windows 非法字符规则，随后统一补回扩展名。不要修改 `sanitizeFilenamePart()` 的通用语义，也不要改快捷键生命周期或文件冲突处理。

- [ ] **Step 3: 运行目标测试，确认三个场景通过**

Run:

```powershell
npx vitest run tests/offscreen.test.ts
```

Expected: PASS，3 tests passed；`writeMarkdownToDirectory()` 收到的三个文件名都以 `.md` 结尾，且没有 `..md`。

- [ ] **Step 4: 运行文件名与快捷保存相关回归测试**

Run:

```powershell
npx vitest run tests/core/filename.test.ts tests/core/custom-folder.test.ts tests/quick-save.test.ts tests/offscreen-lifecycle.test.ts tests/offscreen.test.ts
```

Expected: PASS；普通下载、自定义文件夹、重名 `uniquify` 和 offscreen 生命周期行为保持不变。

- [ ] **Step 5: 提交最小修复**

```powershell
git add -- src/offscreen/offscreen.ts tests/offscreen.test.ts
git commit -m "fix(save): preserve markdown extension for long filenames"
```

### Task 3: 完整验证并重建扩展产物

**Files:**
- Verify only: `src/offscreen/offscreen.ts`
- Verify only: `tests/offscreen.test.ts`
- Rebuild: `dist/`

- [ ] **Step 1: 运行类型检查**

Run:

```powershell
npm run typecheck
```

Expected: PASS，`tsc --noEmit` 退出码为 0。

- [ ] **Step 2: 运行全量测试**

Run:

```powershell
npm test
```

Expected: PASS，无失败测试。若当前受限环境再次出现 `spawn EPERM`，在允许子进程启动的终端中重跑；不能把该环境错误记作测试通过。

- [ ] **Step 3: 构建可加载扩展**

Run:

```powershell
npm run build
```

Expected: PASS，`dist/offscreen.js`、`dist/background.js`、`dist/popup.js` 成功更新。

- [ ] **Step 4: 检查工作树，只确认预期文件发生变化**

Run:

```powershell
git status --short
git diff -- src/offscreen/offscreen.ts tests/offscreen.test.ts
```

Expected: 源码差异只包含离屏文件名清洗修复和对应回归测试；不包含 DOM 选择器、Markdown 正文渲染、设置页或 Obsidian 逻辑变更。

- [ ] **Step 5: Chrome 手工验收快捷保存**

1. 打开 `chrome://extensions`，重新加载当前项目的 `dist/`。
2. 打开一个生成主体不少于 80 字符文件名的 X 长贴文。
3. 使用 `Ctrl + Shift + S` 快捷保存到自定义文件夹。
4. 检查最终文件名以 `.md` 结尾，Windows 文件类型与 Obsidian 均识别为 Markdown。
5. 打开文件，确认 frontmatter、正文、图片和原文链接内容与修复前一致。

Expected: 长贴文保存为 `<80 字符主体>.md`；不再出现 80 字符但无扩展名的文件；正文内容没有变化。

## Self-review result

- 覆盖了已确认的根因：离屏边界对完整文件名二次截断。
- 覆盖 80 字符、79 字符和普通短文件名，避免只修复单一边界以及产生 `..md`。
- 修改范围仅限 `src/offscreen/offscreen.ts` 和新回归测试；没有改变平台提取、Markdown 渲染、下载回退和 Obsidian 行为。
- 验证包含目标测试、相关回归、类型检查、全量测试、构建及 Chrome 真实快捷保存。
