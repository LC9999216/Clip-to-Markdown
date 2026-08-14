# Clip2MD

一键把当前帖子 / 文章保存为干净 Markdown 的 Chrome 扩展（Manifest V3）。

支持的平台（V0.1）：

| 平台 | 内容类型 | URL 形态 |
|------|----------|----------|
| X / Twitter | 单条推文 | `x.com/*/status/*` |
| 知乎 | 回答 / 文章 | `zhihu.com/question/*/answer/*`、`zhuanlan.zhihu.com/p/*` |
| 小黑盒 | 帖子 / 文章 | `www.xiaoheihe.cn` 网页文章页 |

**核心理念：保存"内容本体"**——只保留标题、作者、发布时间、原文 URL、正文、图片、链接、引用。评论、回复、推荐、侧边栏、广告一律不保存。

所有处理都在浏览器本地完成：不使用服务器、不使用任何平台 API，只读取当前已打开页面的 DOM。

---

## 安装

```bash
npm install          # 若网络受限，可加 --proxy http://127.0.0.1:7890
npm run build
```

1. 打开 `chrome://extensions`
2. 右上角开启「开发者模式」
3. 点击「加载已解压的扩展程序」，选择 `dist/` 目录

## 使用

1. 打开一条 X 推文、知乎回答/文章，或小黑盒文章
2. 点击工具栏的 Clip2MD 图标
3. Popup 显示当前平台与识别到的标题
4. 点击「保存为 Markdown」，文件自动下载到默认下载目录

## 开发

| 命令 | 说明 |
|------|------|
| `npm run build` | 构建到 `dist/` |
| `npm run watch` | 监听并增量构建 |
| `npm run typecheck` | `tsc --noEmit` 类型检查 |
| `npm test` | Vitest 全量测试 |
| `node scripts/capture-structure.mjs <页面.html>` | 开发期抓取页面容器结构，帮助校准选择器 |

## 架构

三平面划分（借鉴 XClipper 的架构思想，代码为独立实现）：

```
用户打开页面 → content script 注入（仅白名单域名）
  → popup 打开 → GET_STATUS → PlatformRegistry.match → 识别平台/类型/标题
  → 点保存 → EXTRACT → adapter.extract(DOM, url) → ContentDocument(AST)
  → popup 用纯函数 renderer 渲染 Markdown + 生成文件名
  → DOWNLOAD → background 校验 sender → data URL → chrome.downloads.download
```

```
src/
├── core/           # 纯逻辑层（无 chrome.* / 无 DOM 依赖）
│   ├── schema.ts             # ContentDocument + 节点类型 + validateDocument
│   ├── dom-to-ast.ts         # 通用 HTML → AST（三平台共用）
│   ├── platform-registry.ts  # 平台注册与路由
│   ├── markdown-renderer.ts  # AST → Markdown（纯函数）
│   ├── filename.ts / downloader.ts / error.ts
├── adapters/       # 各平台提取器（DOM → ContentDocument）
│   ├── x/  zhihu/  heybox/
│   └── types.ts    # PlatformAdapter 接口
├── content/        # content script（GET_STATUS / EXTRACT 消息入口）
├── background/     # DOWNLOAD handler（sender 校验 + 下载）
├── popup/          # 极简 UI
└── types/messages.ts   # 消息协议
```

关键约定：

- **统一中间结构**：三个平台 adapter 只负责解析网站，输出统一的 `ContentDocument`（纯 JSON，可跨 `chrome.runtime` 消息边界）。Markdown Renderer 不感知 DOM 来源。
- **新增平台**：只需新建 `src/adapters/<platform>/`（`selectors.ts` + `extractor.ts` + `index.ts`），在 `src/adapters/index.ts` 里副作用导入，无需改动 renderer。
- **adapter 只抛 `ExtractionError`**（中文 message），content-script 统一捕获，绝不静默失败。

## 测试

Vitest + jsdom + HTML fixture。测试管线：

```
fixtures/<platform>/<case>/index.html  →  adapter.extract  →  ContentDocument
                                                              ├→ 与 .ast.json（若有）比对
                                                              └→ markdown-renderer  →  与 expected.md 比对
```

重点：每个平台 fixture 都**故意包含评论 / 推荐等干扰节点**，并断言"绝不混入输出"。

```bash
npm test                    # 全量
npx vitest run tests/adapters/x.test.ts   # 单平台
```

## 各平台选择器维护指南

平台页面 DOM 会变化。所有选择器集中在各平台 `selectors.ts`，结构变动时只改那里：

- **X**（`src/adapters/x/selectors.ts`）：基于 `data-testid`。用 URL 中的 tweetId 反查含 `/status/{tweetId}` 链接的 `article[role="article"]` 定位当前推文，排除 `promotedIndicator`。
- **知乎**（`src/adapters/zhihu/selectors.ts`）：URL 判断优先（`/question/*/answer/*` 与 `/p/*`）；正文用 `.RichContent-inner` / `.Post-RichTextContainer` 等多年稳定的 class。若失效，按真实页面调整。
- **小黑盒**（`src/adapters/heybox/selectors.ts`）：真实结构未知，selectors 是**候选数组**。开发时必须先打开真实文章页（或另存 HTML 后跑 `scripts/capture-structure.mjs`）确认结构再填，不要凭猜测写死。

修改任一选择器后，跑对应平台的 fixture 测试确认无回归。

## 已知限制（V0.1）

- 图片以**远程 URL** 形式保留在 Markdown 中（不下载本地）；X 的 `pbs.twimg.com` 图片会统一附加 `&name=large`。
- **Obsidian 中查看图片**：Obsidian 默认在**阅读模式**（Ctrl/Cmd+E）就会加载远程 https 图片。若图片不显示，先确认不在源码模式；其次排查 Obsidian 里会自动"美化/转义"Markdown 的格式化插件——这类插件会把 `![Image](url)` 转成 `!\[Image](url)`（转义方括号），图片语法就被破坏了。被破坏的文件重新用 Clip2MD 保存一次即可恢复。
- 知乎长回答若未展开，只保存已展开部分（`.RichContent-collapsedText` 会被移除）。
- X 引用推文为尽力识别；识别失败时引用内容不写入。
- 知乎/小黑盒的发布时间取自页面 meta，取不到时留空。
- 需要登录才能查看的内容会提示「需要登录」。

## 许可

本项目为独立实现，仅参考了 [zendegani/XClipper](https://github.com/zendegani/XClipper) 的架构与产品设计思想；XClipper 采用 PolyForm Noncommercial License，其代码不被本项目复用。
