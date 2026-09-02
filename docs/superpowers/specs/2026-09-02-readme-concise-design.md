# GlanceClip README 精简设计

## 目标

将 README 从约 294 行的完整使用手册压缩为约 130–160 行的用户导向产品页。普通用户应在首屏完成商店安装选择，并在一分钟内看懂核心能力；开发者仍能在文档末尾获得完整的源码构建、监听、类型检查和测试命令。

## 信息结构

1. **首屏与安装**：保留产品名、定位语、支持平台和品牌过渡说明；紧接首屏放置“安装到 Chrome”和“安装到 Edge”两个文字链接。
2. **核心能力**：只保留一图速览、B站字幕阅读、一键收藏三项，每项控制在 3–4 个高价值要点。
3. **使用入口**：合并平台能力表与快捷键，避免分别重复说明各平台操作。
4. **配置与隐私**：把 AI、字幕翻译、Obsidian 和隐私边界合并为一个短章节，只说明用户必须知道的配置条件、发送范围和费用风险。
5. **开发与许可**：保留源码安装、`npm ci`、`npm run build`、`npm run watch`、`npm run typecheck`、`npm test`、扩展重新加载、Contributing、第三方参考和 License。

## 精简规则

- 删除“先摘要、再定位、最后收藏”的重复长篇解释，只在首屏保留一句产品定位。
- 删除 AI 三阶段恢复、请求次数、缓存等内部实现细节。
- 删除字幕轨优先级、0.5 秒轮询、约 4 秒分段、会话缓存等内部机制。
- Obsidian 七步配置压缩为 API 地址、Key、Vault 相对目录三项。
- 文件命名变量表压缩为一个默认模板和一个自定义模板示例。
- 删除逐平台使用提示，平台差异统一放入能力表。
- FAQ 只保留不支持页面、找不到文件、Obsidian 连接失败三个高频问题；已知限制压缩为必要边界说明。
- 不添加、删除或替换两处 GIF 引用，素材继续由用户后续处理。

## 必须保留的准确性边界

- X 的可靠原文定位仅限 X Article；普通推文保持静态结构。
- B站只读取官方人工或 AI 字幕，不下载视频，保持“无ASR”说明。
- “简体中文（AI 翻译）”仅在无官方简体中文、有英文字幕且用户显式开启时使用；明确“不会发送音频或视频”且调用“可能产生费用”。
- 保留 `biuworks/bilibili-digest` 参考链接与 `THIRD_PARTY_NOTICES.md`。
- 扩展内部名称仍为 Clip to Markdown，README 展示名为 GlanceClip。

## 商店入口

- Chrome：`https://chromewebstore.google.com/detail/clip-to-markdown/ncfnjmgfjnggekjomeflbnoihcmelhal`
- Edge：`https://microsoftedge.microsoft.com/addons/detail/clip-to-markdown/cbjlhmmghfglniaohpodmpjhcinnbplj`

README 使用稳定的无追踪参数链接，避免保留 `hl` 与 `utm_source` 查询参数。

## 验收标准

- README 总长度控制在约 130–160 行，不通过压缩代码块或破坏可读性凑行数。
- 两个商店入口出现在首屏品牌说明之后、核心功能之前。
- 两处 GIF Markdown 引用保持原样。
- 现有 README 测试保护字符串全部保留。
- `npm test`、`npm run typecheck`、`npm run build`、`git diff --check` 通过。
- README 锚点、相对链接、代码围栏和商店链接检查通过。
