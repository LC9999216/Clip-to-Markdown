# 知乎文章识别兼容性修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复知乎专栏文章 `/p/{id}` 在新版页面结构下无法提取和保存 Markdown 的问题，同时避免把可公开阅读文章误判为登录墙。

**Architecture:** 仅调整知乎 Adapter 的选择器和登录墙判定。文章容器同时兼容现有 `.Post` 与当前 `.Post-Main`；登录表单只有在页面没有可识别正文时才作为登录墙依据。普通保存、Obsidian 保存、设置页、X/小黑盒/ChatGPT Adapter 均不改动。

**Tech Stack:** TypeScript、Vitest、Chrome Extension MV3、现有 DOM-to-AST 提取器。

---

## 范围与当前证据

- 基线工作树：`C:\\Users\\HP\\OneDrive\\桌面\\Clipper\\.worktrees\\clip-to-markdown-v02`
- 基线分支：`feature/clip-to-markdown-v02`
- 目标页面：`https://zhuanlan.zhihu.com/p/382770435`
- 当前真实页面文章容器：`.Post-Main.Post-NormalMain`
- 当前真实页面正文容器：`.Post-RichTextContainer` / `.RichText`
- 当前真实页面同时包含可见 `.SignFlow` 登录表单，但文章正文仍然可读
- 当前代码的问题：文章只查找 `.Post`；并且在提取文章前看到任意 `.SignFlow` 就抛出 `LOGIN_REQUIRED`

## 明确不在本次范围内

- 不修改 `src/adapters/x/`
- 不修改小黑盒、ChatGPT、Bilibili Adapter
- 不修改设置页、保存服务、文件名、Obsidian 流程或下载流程
- 不增加依赖、不引入框架
- 不修改 `main` 工作树

## 文件变更地图

- 修改：`src/adapters/zhihu/selectors.ts`
  - 扩展知乎文章根容器选择器，兼容 `.Post-Main` 和旧 `.Post`
- 修改：`src/adapters/zhihu/extractor.ts`
  - 将登录墙判定改为“无可读正文时才生效”
  - 保留无正文登录页的 `LOGIN_REQUIRED` 错误
- 新增：`tests/fixtures/zhihu/article-post-main/index.html`
  - 模拟当前知乎文章 DOM，并故意包含 `.SignFlow` 登录表单
- 新增：`tests/fixtures/zhihu/article-post-main/expected.md`
  - 固定当前 DOM 提取后的 Markdown 结果
- 修改：`tests/adapters/zhihu.test.ts`
  - 覆盖新版容器、公开正文与登录墙回归场景

---

## Phase 1：知乎文章 Adapter 兼容性修复

### Task 1：新增新版知乎文章回归 Fixture

**Files:**

- Create: `tests/fixtures/zhihu/article-post-main/index.html`
- Create: `tests/fixtures/zhihu/article-post-main/expected.md`
- Test: `tests/adapters/zhihu.test.ts`

- [ ] **Step 1: 创建模拟新版知乎页面 Fixture**

Fixture 必须同时包含新版文章容器和登录表单，确保测试能复现真实问题：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta itemprop="datePublished" content="2026-08-17T10:00:00+08:00">
</head>
<body>
  <form class="SignFlow Login-content">
    <input name="username" type="text">
  </form>

  <article class="Post-Main Post-NormalMain">
    <header class="Post-Header">
      <h1 class="Post-Title">新版知乎文章标题</h1>
      <div class="Post-Author">
        <div class="AuthorInfo-name">
          <a class="UserLink-link" href="//www.zhihu.com/people/example">示例作者</a>
        </div>
      </div>
    </header>
    <div class="Post-RichTextContainer">
      <div class="RichText">
        <p>这是新版知乎文章正文。</p>
        <h2>正文小节</h2>
        <p>这段内容应该被保存。</p>
      </div>
    </div>
    <div class="CommentsContainer"><p>评论不应被保存。</p></div>
    <div class="Recommendations"><p>推荐内容不应被保存。</p></div>
  </article>
</body>
</html>
```

- [ ] **Step 2: 创建对应期望 Markdown**

```markdown
---
platform: zhihu
author: "示例作者"
published: "2026-08-17T10:00:00+08:00"
title: "新版知乎文章标题"
url: https://zhuanlan.zhihu.com/p/990001
---

# 新版知乎文章标题

这是新版知乎文章正文。

## 正文小节

这段内容应该被保存。

---

> 原文链接：https://zhuanlan.zhihu.com/p/990001
> 发布时间：2026-08-17T10:00:00+08:00
```

- [ ] **Step 3: 在知乎测试中加入新版 Fixture 用例**

将测试 URL 映射增加：

```ts
articlePostMain: 'https://zhuanlan.zhihu.com/p/990001',
```

并增加断言：

```ts
it('新版 .Post-Main 文章即使存在登录表单也能提取', () => {
  const doc = extract('article-post-main');

  expect(doc.metadata.contentType).toBe('zhihu-article');
  expect(doc.metadata.title).toBe('新版知乎文章标题');
  expect(renderDocument(doc).trim()).toBe(readExpectedMd('zhihu', 'article-post-main'));
  expect(renderDocument(doc)).not.toContain('评论不应被保存');
  expect(renderDocument(doc)).not.toContain('推荐内容不应被保存');
});
```

- [ ] **Step 4: 运行新增测试，确认当前实现先失败**

Run:

```powershell
npm test -- tests/adapters/zhihu.test.ts
```

Expected: 新增测试失败，原因应为当前 `.Post` 选择器找不到 `.Post-Main`，或被 `.SignFlow` 提前判定为登录墙。

### Task 2：扩展知乎文章容器选择器

**Files:**

- Modify: `src/adapters/zhihu/selectors.ts:36-44`

- [ ] **Step 1: 只修改文章容器选择器**

将：

```ts
item: '.Post',
```

改为：

```ts
item: '.Post-Main, .Post',
```

保留以下选择器不变，因为真实页面仍然提供这些节点：

```ts
title: '.Post-Title',
author: '.Post-Author .AuthorInfo-name, .Post-Author .UserLink-link',
body: '.Post-RichTextContainer, .RichText',
```

- [ ] **Step 2: 运行知乎测试，确认失败原因只剩登录墙判定**

Run:

```powershell
npm test -- tests/adapters/zhihu.test.ts
```

Expected: 旧 `.Post` Fixture 继续通过；新版 `.Post-Main` Fixture 仍因 `.SignFlow` 被判定为登录墙而失败。

### Task 3：让登录墙判断以正文可读性为前提

**Files:**

- Modify: `src/adapters/zhihu/extractor.ts:17-23`
- Modify: `src/adapters/zhihu/extractor.ts`（新增一个仅供本文件使用的正文存在判断函数）

- [ ] **Step 1: 新增正文存在判断**

在 `isLoginWall` 前加入：

```ts
function hasReadableContent(doc: Document, type: PlatformContentType): boolean {
  if (type === 'zhihu-article') {
    return Array.from(doc.querySelectorAll(ZHIHU_SELECTORS.article.item)).some((item) =>
      Boolean(item.querySelector(ZHIHU_SELECTORS.article.body)),
    );
  }

  return Array.from(doc.querySelectorAll(ZHIHU_SELECTORS.answer.item)).some((item) =>
    Boolean(item.querySelector(ZHIHU_SELECTORS.answer.body)),
  );
}
```

- [ ] **Step 2: 调整提取入口的判定顺序**

将当前：

```ts
if (isLoginWall(doc)) {
  throw new ExtractionError('LOGIN_REQUIRED', ERROR_MESSAGES.LOGIN_REQUIRED);
}
return type === 'zhihu-answer' ? extractAnswer(doc, url) : extractArticle(doc, url);
```

改为：

```ts
if (!hasReadableContent(doc, type) && isLoginWall(doc)) {
  throw new ExtractionError('LOGIN_REQUIRED', ERROR_MESSAGES.LOGIN_REQUIRED);
}

return type === 'zhihu-answer' ? extractAnswer(doc, url) : extractArticle(doc, url);
```

这样，页面同时存在登录表单和正文时会继续提取；页面没有正文且存在登录表单时仍会提示登录。

- [ ] **Step 3: 增加登录墙负向回归测试**

在 `tests/adapters/zhihu.test.ts` 增加：

```ts
it('没有正文且存在登录表单时仍提示需要登录', () => {
  document.body.innerHTML = '<form class="SignFlow Login-content"><input type="text"></form>';

  expect(() => zhihuAdapter.extract(
    document,
    new URL('https://zhuanlan.zhihu.com/p/990002'),
  )).toThrow('需要登录');
});
```

- [ ] **Step 4: 运行知乎 Adapter 全部测试**

Run:

```powershell
npm test -- tests/adapters/zhihu.test.ts
```

Expected: 旧文章、旧回答、新版 `.Post-Main` 文章、正文缺失和登录墙测试全部通过。

### Task 4：Phase 1 全量验证并提交

**Files:**

- Verify: `src/adapters/zhihu/selectors.ts`
- Verify: `src/adapters/zhihu/extractor.ts`
- Verify: `tests/adapters/zhihu.test.ts`
- Verify: `tests/fixtures/zhihu/article-post-main/index.html`
- Verify: `tests/fixtures/zhihu/article-post-main/expected.md`

- [ ] **Step 1: 运行类型检查**

```powershell
npm run typecheck
```

Expected: exit code 0。

- [ ] **Step 2: 运行全量测试**

```powershell
npm test
```

Expected: 全部测试通过，既有 X、知乎、小黑盒、ChatGPT、Bilibili、保存和设置测试不回归。

- [ ] **Step 3: 运行构建**

```powershell
npm run build
```

Expected: exit code 0，并生成新的 `dist/` 构建产物。

- [ ] **Step 4: 检查变更范围**

```powershell
git status --short
git diff --stat
git diff -- src/adapters/zhihu/selectors.ts src/adapters/zhihu/extractor.ts tests/adapters/zhihu.test.ts
```

Expected: 只有本计划列出的知乎 Adapter 和测试 Fixture 发生变化；不出现 `src/adapters/x/`、设置页、保存流程或其他平台文件变更。

- [ ] **Step 5: 提交 Phase 1**

只有前述三个命令全部通过后执行：

```powershell
git add src/adapters/zhihu/selectors.ts src/adapters/zhihu/extractor.ts tests/adapters/zhihu.test.ts tests/fixtures/zhihu/article-post-main/index.html tests/fixtures/zhihu/article-post-main/expected.md
git commit -m "fix(zhihu): support current article layout"
```

Expected: 生成一个只包含知乎文章兼容性修复的 commit。

## 完成标准

- `https://zhuanlan.zhihu.com/p/382770435` 能识别为知乎文章并提取正文。
- 页面存在全局登录表单但正文可读时，不再误报“需要登录”。
- 真正没有正文且存在登录墙时，仍返回 `LOGIN_REQUIRED`。
- 旧 `.Post` 页面结构继续可用。
- 评论、推荐、按钮等非正文内容不进入 Markdown。
- `npm run typecheck`、`npm test`、`npm run build` 全部通过后才提交。
- X、知乎以外的平台、设置页、保存流程和 `main` 均未被修改。

## 风险与回滚

- 风险：知乎后续继续调整正文 class，需继续在 `selectors.ts` 集中更新选择器。
- 风险：某些真正受限页面可能同时渲染少量预览正文；本计划用正文容器存在性作为放行条件，测试需覆盖“无正文登录墙”场景。
- 回滚：只需回滚本 Phase 的单个 commit，不涉及保存数据、设置数据或其他平台适配器。
