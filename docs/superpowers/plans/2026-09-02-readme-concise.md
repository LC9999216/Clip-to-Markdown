# Concise GlanceClip README Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 README 精简为面向普通安装用户的单页产品介绍，同时保留完整的源码构建与测试命令。

**Architecture:** 只重组并压缩 `README.md` 的信息层级，不修改扩展代码、测试或媒体文件。首屏直接提供 Chrome 与 Edge 商店入口，正文聚焦三项核心能力，开发信息集中到末尾。

**Tech Stack:** Markdown、Vitest、TypeScript、esbuild。

---

### Task 1: 重写用户向 README

**Files:**
- Modify: `README.md`
- Preserve unchanged: `docs/assets/readme/visual-summary-demo.gif` 与 `docs/assets/readme/bilibili-subtitle-demo.gif` 的 Markdown 引用

- [x] **Step 1: 重建首屏与安装入口**

保留 `👁️ GlanceClip`、“先看懂，再收藏”、支持平台和内部名称说明；在首屏说明之后加入以下无追踪参数链接：

```markdown
**[安装到 Chrome](https://chromewebstore.google.com/detail/clip-to-markdown/ncfnjmgfjnggekjomeflbnoihcmelhal)** · **[安装到 Edge](https://microsoftedge.microsoft.com/addons/detail/clip-to-markdown/cbjlhmmghfglniaohpodmpjhcinnbplj)**
```

- [x] **Step 2: 将功能压缩为三个章节**

保留“一图速览”“B站字幕阅读”“一键收藏”，每项只写 3–4 个用户可感知能力。删除 AI 三阶段恢复、请求次数、缓存、字幕轨内部优先级、0.5 秒轮询与约 4 秒分段等实现细节。两处 GIF 引用逐字保持不变。

- [x] **Step 3: 合并使用与平台信息**

保留五列平台能力表和三个快捷键；删除逐平台使用提示。文件命名只保留 `{date}-{title}` 与 `{date}-{platform}-{author}-{title}` 两个示例。

- [x] **Step 4: 合并配置、隐私与限制**

用一个章节说明 OpenAI-Compatible API、Obsidian Local REST API 与隐私边界。必须保留以下现有测试字符串：

```text
B站独立字幕页
简体中文（AI 翻译）
不会发送音频或视频
可能产生费用
无ASR
https://github.com/biuworks/bilibili-digest
```

- [x] **Step 5: 保留完整开发命令**

末尾保留源码克隆、`npm ci`、`npm run build`、加载 `dist`，以及完整开发命令：

```bash
npm run build
npm run watch
npm run typecheck
npm test
```

保留 Contributing、`THIRD_PARTY_NOTICES.md` 和 MIT License。目标总长度约 130–160 行。

### Task 2: 验证精简结果

**Files:**
- Test: `tests/visual-summary.test.ts`
- Inspect: `README.md`

- [x] **Step 1: 运行 README 专项检查**

Run:

```powershell
node tmp-recording/check-readme.mjs
```

Expected: 锚点、代码围栏、现有相对链接、保护字符串和占位符检查通过；两个 GIF 只报告由用户后续提供。

- [x] **Step 2: 检查长度与商店链接**

Run:

```powershell
(Get-Content README.md).Count
rg -n "安装到 Chrome|安装到 Edge|chromewebstore.google.com|microsoftedge.microsoft.com" README.md
```

Expected: 约 130–160 行；两个商店入口均位于 README 前部。

- [x] **Step 3: 运行项目验证**

Run:

```powershell
npm test
npm run typecheck
npm run build
git diff --check
```

Expected: 39 个测试文件、643 项测试通过；typecheck、build 与 diff check 均返回 0。
