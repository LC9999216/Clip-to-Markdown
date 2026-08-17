# Clip to Markdown

一键把 **X / Twitter、ChatGPT、B 站、知乎、小黑盒** 中的内容保存为干净 Markdown，并支持直接发送到 **Obsidian**。

> 只保存“内容本体”：标题、作者、发布时间、正文、图片、链接、引用和原文地址；尽量排除评论、回复、推荐、广告、侧边栏和操作按钮。

## ✨ 支持的平台

| 平台 | 支持内容 |
| --- | --- |
| X / Twitter | 普通推文、X Article |
| ChatGPT | 用户与助手对话 |
| B 站 | 视频信息、简介、章节、可用字幕 |
| 知乎 | 指定回答、知乎文章 |
| 小黑盒 | 帖子、图文帖子 |

网页提取主要在浏览器本地完成。B 站字幕会读取 B 站官方页面接口和字幕资源；Obsidian 模式连接本机 Local REST API。项目不自建内容服务器。

---

## 🚀 快速开始

### 1. 获取并构建

需要：**Chrome + Node.js**

```bash
git clone https://github.com/LC9999216/clip2md.git
cd clip2md
npm ci
npm run build
```

如果 `npm ci` 因锁文件问题失败：

```bash
npm install
npm run build
```

### 2. 加载到 Chrome

1. 打开 `chrome://extensions`
2. 开启 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择项目里的 `dist` 文件夹
5. 将 **Clip to Markdown** 固定到工具栏

完成 🎉

---

## ⚡ 怎么用

打开支持的内容详情页，然后：

- **保存为 Markdown** → 保存到浏览器下载目录或自定义文件夹
- **保存到 Obsidian** → 直接进入 Obsidian 知识库

### 快捷键

| 功能 | 默认快捷键 |
| --- | --- |
| 普通保存 | `Ctrl + Shift + S` |
| 保存到 Obsidian | `Alt + Shift + S` |

Mac 普通保存：`Command + Shift + S`

快捷键冲突时，可前往：

```text
chrome://extensions/shortcuts
```

重新绑定。

---

## 🧩 主要功能

- **干净正文提取**：尽量排除评论、推荐、广告和页面外围内容
- **多平台支持**：X、ChatGPT、B 站、知乎、小黑盒
- **自定义保存目录**：Markdown 可直接写入指定文件夹
- **全局文件命名规则**：普通下载、自定义文件夹、Obsidian 共用
- **Obsidian 模式**：通过本机 Local REST API 直接写入 Vault
- **双快捷键**：普通保存与 Obsidian 保存互不干扰
- **Markdown 语义保留**：标题、列表、链接、引用、代码块、表格、图片等

---

## 📝 文件命名

默认模板：

```text
{date}-{title}
```

支持：

| 变量 | 含义 |
| --- | --- |
| `{title}` | 标题 |
| `{date}` | 剪藏日期 |
| `{author}` | 作者 |
| `{platform}` | 平台 |
| `{id}` | 内容 ID |

例如：

```text
{date}-{platform}-{title}
```

可生成：

```text
2026-08-17-知乎-如何使用DeepSeek.md
```

非法字符会自动清理，并统一补齐 `.md`。

---

## 🟣 Obsidian（可选）

如果希望直接保存到 Obsidian：

1. 在目标 Vault 中安装并启用 **Local REST API with MCP**
2. 开启 **Enable Non-encrypted (HTTP) Server**
3. 复制 API Key
4. 打开 Clip to Markdown 设置页
5. 填写 API 地址：

```text
http://127.0.0.1:27123
```

6. 填写 Vault 内笔记目录，例如：

```text
Clippings/Inbox
```

7. 点击 **测试连接**

连接成功后，即可使用 `Alt + Shift + S` 一键保存到 Obsidian。

> 笔记目录使用 Vault 内相对路径，不要填写 `C:\...` 这类电脑绝对路径。

---

## 📌 使用提示

- **X / Twitter**：打开具体 `/status/{id}` 页面
- **ChatGPT**：打开已有消息的 `/c/...` 对话页
- **B 站**：打开 `/video/BV...` 视频详情页；只保存视频信息与可用字幕，不下载视频
- **知乎**：推荐具体 `/answer/...` 回答页或 `zhuanlan.zhihu.com/p/...` 文章页
- **小黑盒**：打开 `/app/bbs/link/...` 帖子详情页

保存前请确认正文、图片、字幕或对话消息已经加载完成。

---

## ❓ 常见问题

### 显示“不支持当前页面”
确认打开的是具体内容详情页，刷新页面并等待正文加载完成后重试。

### 保存后找不到文件
检查设置页中的自定义文件夹、Chrome 默认下载目录、下载子目录或 Obsidian Vault。

### Obsidian 连接失败
确认 Obsidian 正在运行、Local REST API 已启用、HTTP Server 已开启、API 地址和 API Key 正确。

---

## 🛠️ 开发

```bash
npm run build
npm run watch
npm run typecheck
npm test
```

修改源码后：

```text
npm run build
→ chrome://extensions
→ 点击 Clip to Markdown 的“重新加载”
```

核心结构：

```text
src/
├── core/        # 文档结构、渲染、文件名、保存逻辑
├── adapters/    # 各平台适配器
├── content/     # 页面内容脚本
├── background/  # 下载、快捷保存、接口代理
├── popup/       # 扩展弹窗
├── options/     # 设置页
└── types/       # 共享类型
```

---

## ⚠️ 已知限制

- 需要登录的内容，只能保存当前账号实际可见部分
- 图片默认保留远程 URL，不会批量下载到本地
- X 视频不会完整下载
- 知乎折叠长回答只保存已展开部分
- B 站没有可用字幕时不会自动语音识别
- ChatGPT 的文件附件、图片附件、Canvas、语音和 Thinking 内部过程暂不作为独立内容保存
- Obsidian 模式需要本机运行 Local REST API

---

## 📄 License & Feedback

本项目采用 **MIT License**，详见 [LICENSE](LICENSE)。

GitHub：
https://github.com/LC9999216/clip2md

发现平台结构变化、识别失败或导出异常时，欢迎提交 GitHub Issue。
