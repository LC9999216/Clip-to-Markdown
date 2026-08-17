# Clip to Markdown

Clip to Markdown（原 Clip2MD）是一款 Chrome Manifest V3 扩展，用来把网页中的帖子、文章、ChatGPT 对话和 B 站视频字幕整理成干净的 Markdown 文件。

它的核心目标是保存“内容本体”：保留标题、作者、发布时间、正文、图片、链接、引用和原文地址；尽量排除评论、回复、推荐、广告、侧边栏、操作按钮等网页外围内容。

## 一、支持的平台和内容

| 平台 | 支持内容 | 建议使用的页面 |
| --- | --- | --- |
| X / Twitter | 普通推文、X Article 文章 | https://x.com/{用户名}/status/{推文ID} 或对应的 twitter.com 页面 |
| ChatGPT | 对话中的用户消息和助手消息 | https://chatgpt.com/c/{对话ID} 或 chat.openai.com/c/{对话ID} |
| B 站 | 视频信息、简介、章节和可用字幕 | https://www.bilibili.com/video/BV... 视频详情页 |
| 知乎 | 指定回答、知乎文章 | www.zhihu.com/question/{问题ID}/answer/{回答ID}、zhuanlan.zhihu.com/p/{文章ID} |
| 小黑盒 | 帖子、图文帖子 | www.xiaoheihe.cn/app/bbs/link/{帖子ID} 等帖子详情页 |

网页提取在扩展本地完成。B 站字幕需要读取 B 站官方页面接口和字幕资源；如果使用 Obsidian，则扩展会直接连接本机 Obsidian Local REST API。项目没有自建内容服务器，也不会把文章发送到项目作者的服务器。

## 二、安装前准备

### 2.1 必需软件

需要准备：

1. Windows、macOS 或 Linux 电脑。
2. Google Chrome 或兼容 Chrome 扩展的 Chromium 浏览器。
3. Node.js，建议使用当前仍受支持的 LTS 版本。
4. Git（仅在通过 Git 克隆项目时需要）。

建议先检查 Node.js 和 npm 是否可用：

~~~bash
node --version
npm --version
~~~

如果命令不存在，请先安装 Node.js，再重新打开终端。安装 Node.js 时使用默认选项即可，npm 会随 Node.js 一起安装。

### 2.2 获取项目源码

#### 方式 A：使用 Git

~~~bash
git clone https://github.com/LC9999216/clip2md.git
cd clip2md
~~~

#### 方式 B：下载 ZIP

1. 在项目页面点击「Code」→「Download ZIP」。
2. 将 ZIP 解压到一个路径简单、权限正常的目录，例如 D:\Projects\clip2md。
3. 在解压后的项目根目录打开 PowerShell 或终端。

项目根目录应当能看到 package.json、src、tests 等文件。后续的 npm 命令必须在这个目录执行，不能在 src 或 dist 子目录执行。

## 三、从源码构建扩展

### 3.1 安装依赖

在项目根目录执行：

~~~bash
npm ci
~~~

npm ci 会按照 package-lock.json 安装确定版本，适合第一次安装和复现项目环境。如果项目没有锁文件或 npm 报锁文件不一致，可以改用：

~~~bash
npm install
~~~

如果网络较慢，可以检查公司网络、代理或 npm 镜像设置。不要把代理地址直接写进项目代码；代理只影响当前终端的依赖下载。

### 3.2 构建生产版本

~~~bash
npm run build
~~~

构建成功后，项目根目录会生成或更新 dist/。这个目录才是要加载到 Chrome 的扩展目录，不能直接加载项目根目录。

可以顺手执行类型检查：

~~~bash
npm run typecheck
~~~

如果要边修改边构建，使用：

~~~bash
npm run watch
~~~

开发时保持该终端运行；每次修改源码后，到扩展管理页点击「重新加载」才能让浏览器使用新的构建结果。

### 3.3 常见安装问题

- npm 或 node 找不到：Node.js 没有安装成功，或终端是在安装前打开的；重新安装或重新打开终端。
- npm ci 报 package-lock.json 不匹配：先确认当前目录是项目根目录，再尝试 npm install；不要随意删除锁文件。
- npm run build 报权限错误：将项目移动到自己有读写权限的目录，并关闭正在占用 dist 文件的程序。
- 构建成功但 dist 不存在：确认命令没有在其他目录执行，并检查终端最后是否显示构建失败。

## 四、在 Chrome 中加载扩展

1. 打开 Chrome，在地址栏输入 chrome://extensions 并回车。
2. 打开右上角的「开发者模式」。
3. 点击「加载已解压的扩展程序」。
4. 选择项目中的 dist 文件夹。
5. 确认扩展卡片显示 Clip to Markdown，且没有红色错误提示。
6. 如果工具栏没有显示图标，点击拼图图标，将 Clip to Markdown 固定到工具栏。

更新源码后的操作顺序是：

~~~text
修改源码 → npm run build → chrome://extensions → 点击 Clip to Markdown 的「重新加载」
~~~

如果 Chrome 显示「无法加载扩展」，点击扩展卡片上的「错误」查看具体信息。最常见原因是选择了项目根目录而不是 dist，或者构建没有成功。

扩展使用的权限包括当前活动标签页、下载、存储、通知、离屏文档和本地连接权限。这些权限分别用于读取当前网页、下载 Markdown、保存设置、提示错误、完成文件写入以及连接本机 Obsidian；扩展不会因为安装而自动保存所有浏览记录。

## 五、首次使用和保存位置配置

### 5.1 第一次保存前选择文件夹

第一次点击「保存为 Markdown」时，扩展会要求完成初始设置。也可以先点击扩展图标进入设置页，选择「自定义文件夹」。

选择文件夹的步骤：

1. 点击「选择文件夹」。
2. 在系统目录选择器中选择一个用于保存剪藏的文件夹，例如 D:\Notes\Clippings。
3. 在浏览器弹出的权限提示中点击允许，并授予读写权限。
4. 回到设置页，确认已显示所选文件夹。

自定义文件夹使用浏览器的 File System Access API 保存目录授权。Chrome 105 或更高版本通常可以使用此功能；如果浏览器不支持，普通保存仍可使用浏览器默认下载目录。

### 5.2 普通下载和保存设置

设置页可以配置：

- **自定义保存文件夹**：将 Markdown 直接写入选定文件夹。
- **子目录**：不使用自定义文件夹时，作为浏览器默认下载目录下的相对目录，例如 Clippings/知乎。
- **每次询问保存位置**：打开后，每次保存时由浏览器询问文件名和位置。
- **文件名模板**：默认是 {date}-{title}。

文件名模板支持：

| 变量 | 含义 |
| --- | --- |
| {title} | 页面或内容标题 |
| {date} | 剪藏日期 |
| {author} | 作者 |
| {platform} | 平台名称 |
| {id} | 内容 ID |

文件名中的非法字符会被清理，扩展名会统一保存为 .md。如果标题过长或含有 Windows 不允许的字符，最终文件名可能会被截短或替换部分字符。

### 5.3 Obsidian 保存（可选）

如果希望直接保存到 Obsidian：

1. 在 Obsidian 的目标库中安装并启用 Local REST API with MCP 插件。
2. 在插件设置中打开 Enable Non-encrypted (HTTP) Server。
3. 复制插件生成的 API Key。
4. 打开 Clip to Markdown 设置页的「Obsidian」区域。
5. 填写 API 地址，默认是：

   ~~~text
   http://127.0.0.1:27123
   ~~~

6. 粘贴 API Key。
7. 填写笔记目录，例如 Clippings/Bilibili。该目录按 Vault 根目录计算，不要填写电脑上的绝对路径。
8. 点击「测试连接」，确认连接成功。

目录不存在时，扩展会请求 Obsidian 创建目录。Obsidian 保存使用 Alt + Shift + S，也可以在弹出窗口点击「保存到 Obsidian」。如果目标笔记已存在，扩展会先提示是否覆盖。

## 六、通用使用流程

对五个平台的基本操作都遵循下面的流程：

1. 登录对应网站（如果内容需要登录）。
2. 打开要保存的具体内容详情页。
3. 等待页面正文、图片、字幕或对话消息加载完成。
4. 点击工具栏中的 Clip to Markdown 图标。
5. 在弹出窗口确认识别到的平台和内容类型。
6. 点击「保存为 Markdown」，或点击「保存到 Obsidian」。
7. 保存完成后，在浏览器下载目录、自定义文件夹或 Obsidian 中检查结果。

也可以使用快捷键：

- Ctrl + Shift + S：保存当前内容为 Markdown。
- Alt + Shift + S：保存当前内容到 Obsidian。

如果快捷键与其他扩展冲突，可以在 chrome://extensions/shortcuts 中找到 Clip to Markdown 并重新设置。Mac 上对应的普通保存快捷键是 Command + Shift + S。

扩展通过当前页面的 URL 和 DOM 判断平台。单页应用切换到另一条内容后，建议等待页面刷新完成；如果弹出窗口仍显示上一条内容，先刷新页面再保存。

## 七、五个平台的具体使用方法

### 7.1 X / Twitter

#### 普通推文

1. 打开类似下面的推文详情页：

   ~~~text
   https://x.com/username/status/1234567890123456789
   ~~~

2. 确认推文正文已经显示；带图片的推文要等待图片加载。
3. 点击扩展图标。
4. 确认类型显示为「推文」。
5. 点击「保存为 Markdown」。

普通推文会保存作者、发布时间、正文、图片、链接和尽力识别的引用推文。文件标题默认取推文正文开头的一部分，并会自动生成 .md 扩展名。

#### X Article 文章

1. 打开 X Article 的文章页，而不是只停留在时间线卡片。
2. 等待文章标题、正文和内嵌媒体加载完成。
3. 点击扩展图标，确认类型显示为「文章」。
4. 保存为 Markdown。

X Article 会尽量保留正式标题、封面、正文段落、标题层级、列表、引用、代码块、图片、内嵌推文和卡片链接。文章中的视频通常保留海报图或来源链接，不会把完整视频下载到 Markdown 文件中。

#### X 使用注意

- 只支持包含数字推文 ID 的 /status/{id} 页面；个人主页、搜索页、趋势页和时间线列表不是目标页面。
- 如果看到登录墙、正文尚未加载或页面处于骨架屏状态，先登录、等待或刷新。
- X 的图片以远程 pbs.twimg.com URL 写入 Markdown，不会复制成项目本地图片。
- 评论、回复、推荐、广告和侧栏不会作为正文保存。

### 7.2 ChatGPT

1. 打开一个已经有消息的 ChatGPT 对话，例如：

   ~~~text
   https://chatgpt.com/c/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   ~~~

2. 等待需要保存的消息加载完成。长对话如果只加载了部分消息，建议先滚动到需要的范围并确认内容已经显示。
3. 点击扩展图标，确认类型显示为「对话」。
4. 点击「保存为 Markdown」。

导出的对话会按消息顺序保留用户和助手的文本、Markdown、标题、列表、链接、表格、代码块和引用等语义结构。系统消息、工具内部消息和页面外围控件不会写入正文。

ChatGPT 还支持首页已经显示消息的临时对话，但空首页不能保存。以下页面不是对话内容页，不能直接保存：

- 登录页、注册页；
- 设置页；
- 没有用户或助手消息的空首页；
- 仅显示文件、图片、Canvas、语音或 Thinking 内部过程而没有可提取文本的区域。

文件附件、图片附件、Canvas、语音以及 Thinking 内部过程暂不作为独立内容保存。需要保留的代码块应先确认代码已经在页面中展开并显示。

### 7.3 B 站

B 站的保存对象是**视频详情页中的字幕和视频信息**，不是整个视频文件。

1. 打开完整的视频详情页，例如：

   ~~~text
   https://www.bilibili.com/video/BV1xx411c7mD/
   ~~~

2. 如果从「稍后再看」或列表页进入，先点击进入具体视频详情页。列表页本身不能作为视频字幕导出对象。
3. 确认视频页面已经加载，并且视频存在可用字幕。
4. 点击扩展图标，确认类型显示为「视频字幕」。
5. 点击「保存为 Markdown」。

导出的 Markdown 通常包含：

- 视频标题、作者、发布时间和原文链接；
- 视频简介；
- 章节信息（如果页面提供）；
- 「字幕」标题；
- 带时间戳的字幕文本。

字幕语言选择顺序是中文优先、英文其次、其他语言再次。如果视频没有可用字幕，扩展会提示「这个视频暂时没有可用字幕」。扩展不会自动进行本地语音识别，也不会下载 B 站视频或音频文件。

B 站字幕读取需要当前页面会话、B 站官方接口和字幕资源都能正常访问。因此以下情况可能导致失败：

- 视频没有字幕或字幕文件为空；
- 登录状态失效、视频受地区或权限限制；
- B 站接口、字幕 CDN 或当前网络不可访问；
- 浏览器扩展权限或站点页面尚未加载完成。

遇到失败时，先在 B 站页面直接播放并确认字幕可见，再刷新视频详情页后重试。

### 7.4 知乎

#### 保存指定回答

1. 打开完整回答页：

   ~~~text
   https://www.zhihu.com/question/问题ID/answer/回答ID
   ~~~

2. 确认目标回答已经展开。
3. 点击扩展图标，确认类型显示为「回答」。
4. 保存为 Markdown。

扩展会根据 URL 中的回答 ID 定位目标回答，尽量只提取该回答，不把同一页面中的其他回答、评论、推荐和侧栏混入正文。

#### 保存知乎文章

1. 打开：

   ~~~text
   https://zhuanlan.zhihu.com/p/文章ID
   ~~~

2. 等待文章标题和正文完成渲染。
3. 点击扩展图标，确认类型显示为「文章」。
4. 保存为 Markdown。

知乎文章会保留标题、正文、图片、链接、列表、引用等内容本体。图片以远程 URL 保存，不会自动下载到本地。

#### 知乎使用注意

- 问题页、搜索页、知乎首页不是指定回答页；最好直接打开含 /answer/ 的 URL。
- 折叠的长回答只会保存当前已经展开、实际出现在页面 DOM 中的部分；保存前请点击「展开全文」。
- 需要登录的回答或文章会提示登录，登录后刷新页面再试。
- 发布时间取页面可用的元信息，取不到时可能为空。

### 7.5 小黑盒

1. 打开小黑盒帖子详情页，推荐使用：

   ~~~text
   https://www.xiaoheihe.cn/app/bbs/link/帖子ID
   ~~~

2. 等待帖子正文、图片和图文内容加载完成。
3. 点击扩展图标，确认类型显示为「帖子」。
4. 保存为 Markdown。

扩展会尽量保留帖子标题、作者、正文、图片、链接、引用和图文内容，并移除评论、回复、标签、操作按钮、游戏组件、导航和页脚等外围元素。

小黑盒使用注意：

- 个人主页、登录页、注册页、搜索页、下载页和设置页不能作为帖子详情页保存。
- 如果帖子需要登录，先登录小黑盒，再刷新帖子详情页。
- 页面只提供相对时间或没有公开时间时，导出的发布时间可能为空。
- 小黑盒页面结构变化较快。如果弹出窗口不能识别平台，先使用 www.xiaoheihe.cn 的帖子详情页并刷新后重试。

## 八、Markdown 文件和 Obsidian 输出说明

### 8.1 Markdown 文件内容

普通导出会生成 UTF-8 编码的 .md 文件。文件通常包含 YAML frontmatter：

~~~yaml
---
platform: X
author: example
published: 2026-08-17T12:00:00.000Z
title: 示例标题
url: https://example.com/...
---
~~~

正文随后以 Markdown 形式写入，最后附带原文链接和发布时间。不同平台能取得的字段不同，因此某些 frontmatter 字段可能为空。

图片默认保留为远程 Markdown 图片链接，例如：

~~~markdown
![图片说明](https://example.com/image.jpg)
~~~

扩展不会自动把所有图片下载为本地附件。Obsidian 阅读模式可以加载远程 HTTPS 图片；如果图片没有显示，先按 Ctrl/Cmd + E 切换到阅读模式，并检查是否有格式化插件把图片语法转义成了带反斜杠的形式。

### 8.2 文件名没有 .md 的处理

文件名由标题模板生成。无论标题是否过长、含有特殊字符或经过清理，最终保存名都会补齐 .md 后缀。若旧版本已经生成了没有扩展名的文件，可以直接将其重命名为 .md；文件内容本身仍是 Markdown。

### 8.3 Obsidian 连接失败

检查以下项目：

1. Obsidian 正在运行。
2. Local REST API with MCP 插件已安装并启用。
3. 插件设置中的非加密 HTTP 服务已打开。
4. Clip to Markdown 的地址与插件端口一致，默认是 http://127.0.0.1:27123。
5. API Key 没有多复制空格或换行。
6. 笔记目录填写的是 Vault 内相对路径，而不是 C:\... 电脑路径。
7. 点击设置页的「测试连接」确认配置后再保存。

## 九、故障排查

### 9.1 弹出窗口显示“不支持当前页面”

确认：

- 当前是具体的帖子、文章、回答、对话或 B 站视频详情页；
- 地址栏域名是受支持的域名；
- X 页面含有 /status/{数字ID}；
- 知乎页面含有 /answer/ 或是 zhuanlan.zhihu.com/p/；
- B 站页面是 www.bilibili.com/video/BV...，而不是列表页；
- 小黑盒页面是帖子详情页而不是搜索或个人页面。

刷新页面后再次点击扩展。如果刚从站内 SPA 链接切换过来，等待正文加载完成再操作。

### 9.2 能识别平台，但保存时报错

先确认正文已经在页面中显示。然后按下面顺序排查：

1. 刷新当前网页。
2. 等待图片、对话消息或 B 站字幕加载完成。
3. 关闭可能遮挡正文的登录弹窗，再重试。
4. 检查扩展卡片是否有错误提示。
5. 打开 chrome://extensions，点击扩展的「重新加载」后重试。

如果只有 B 站失败，重点检查字幕是否存在以及 B 站接口/CDN 是否能访问；如果只有 ChatGPT 失败，重点检查是否处于登录页、设置页或空首页。

### 9.3 文件保存后找不到

- 未选择自定义文件夹时，检查 Chrome 设置中的默认下载位置。
- 开启「每次询问保存位置」后，查看保存时选择的目录。
- 设置了子目录时，子目录位于浏览器默认下载目录下。
- 选择自定义文件夹后，检查设置页显示的目录权限是否仍然有效。
- 如果使用 Obsidian，直接在 Vault 内搜索导出的标题。

### 9.4 修改源码后浏览器仍使用旧版本

重新执行：

~~~bash
npm run build
~~~

然后打开 chrome://extensions，点击 Clip to Markdown 卡片的「重新加载」。如果仍无变化，确认加载的路径确实是当前项目的 dist，而不是另一个项目副本的 dist。

## 十、开发与测试

### 10.1 常用命令

| 命令 | 作用 |
| --- | --- |
| npm ci | 按锁文件安装依赖 |
| npm install | 安装或更新依赖 |
| npm run build | 构建扩展到 dist/ |
| npm run watch | 监听源码并持续构建 |
| npm run typecheck | TypeScript 类型检查 |
| npm test | 运行全部 Vitest 测试 |
| npm run test:watch | 监听模式运行测试 |
| node scripts/capture-structure.mjs {页面.html} | 抓取页面结构，辅助维护选择器 |
| node scripts/analyze-page.mjs {页面.html} {target} | 分析保存的页面结构 |

### 10.2 按平台运行测试

~~~bash
npx vitest run tests/adapters/x.test.ts
npx vitest run tests/adapters/chatgpt.test.ts
npx vitest run tests/adapters/bilibili.test.ts
npx vitest run tests/adapters/zhihu.test.ts
npx vitest run tests/adapters/heybox.test.ts
~~~

测试使用 Vitest、jsdom 和 HTML fixture，重点验证：

~~~text
fixtures/<platform>/<case>/index.html
  → adapter.extract
  → ContentDocument
  → markdown-renderer
  → expected.md
~~~

平台 fixture 会故意包含评论、推荐和其他干扰节点，用来确保“内容本体”边界不会被破坏。

### 10.3 项目结构

~~~text
src/
├── core/                 # 纯逻辑层：文档结构、AST、渲染、文件名和错误
│   ├── schema.ts
│   ├── dom-to-ast.ts
│   ├── platform-registry.ts
│   ├── markdown-renderer.ts
│   ├── filename.ts
│   └── downloader.ts
├── adapters/             # 各网站的 DOM/API 提取器
│   ├── x/
│   ├── chatgpt/
│   ├── bilibili/
│   ├── zhihu/
│   └── heybox/
├── content/              # content script，负责页面消息入口
├── background/           # 下载、B 站接口代理和权限校验
├── popup/                # 工具栏弹出窗口
├── options/              # 保存位置、文件名、Obsidian 配置
└── types/                # Chrome 消息和共享类型
~~~

各平台 adapter 只负责从网页中提取数据并输出统一的 ContentDocument；Markdown renderer 不依赖具体网站的 DOM。页面选择器发生变化时，应先保存真实页面结构，再修改对应平台的 selectors.ts，并运行该平台测试。

## 十一、已知限制

- 页面需要登录时，扩展只能保存当前账号实际能看到的内容。
- 评论、回复、推荐、广告、侧栏和操作控件不属于导出正文。
- 图片默认使用远程 URL，不会批量下载为本地图片。
- X 视频不会完整下载，通常保留海报图或来源链接。
- X 引用推文是尽力识别，页面结构变化时可能无法完整展开。
- 知乎折叠长回答只保存已展开部分。
- 小黑盒和知乎的发布时间依赖页面提供的元信息，取不到时可能为空。
- B 站只支持视频详情页的可用字幕；没有字幕时不会自动语音识别。
- B 站字幕依赖官方接口、当前登录状态和字幕资源网络可达。
- ChatGPT 的文件附件、图片附件、Canvas、语音和 Thinking 内部过程暂不保存。
- ChatGPT 登录页、设置页和没有消息的空首页不是可导出的对话。
- Obsidian 保存需要本机运行 Local REST API 服务；它不是普通 Markdown 下载的必需条件。

## 十二、许可与反馈

本项目为独立实现，仅参考了 [zendegani/XClipper](https://github.com/zendegani/XClipper) 的架构与产品设计思想；XClipper 采用 PolyForm Noncommercial License，其代码不被本项目复用。

项目采用 MIT License，详见 [LICENSE](LICENSE)。如果遇到网站结构变化、平台识别错误或某种内容没有被正确提取，请在提交 Issue 时附上：

1. 平台和页面类型；
2. 脱敏后的 URL 形态；
3. Chrome 版本和扩展版本；
4. 弹出窗口或 chrome://extensions 中的错误信息；
5. 是否登录、是否展开正文、是否存在字幕；
6. 不包含隐私信息的 HTML fixture 或结构说明。

项目地址：[github.com/LC9999216/clip2md](https://github.com/LC9999216/clip2md)
