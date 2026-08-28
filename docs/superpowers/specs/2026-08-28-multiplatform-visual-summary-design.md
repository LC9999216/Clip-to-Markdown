# Clip2MD 多平台一图速览设计

**日期**：2026-08-28

**状态**：用户已批准

## 目标

将一图速览从 X 专用扩展到知乎、小黑盒、ChatGPT 和 B 站，同时保持统一的两句话摘要、核心观点、内容结构界面。X Article、知乎、小黑盒和 ChatGPT 结构条目支持确定性来源定位；B 站结构条目在有时间信息时跳转播放器时间点。无法唯一定位时必须保守失败。

## 架构

公共层继续负责 V2 Prompt、Schema、缓存、Background 编排和 Side Panel。`PlatformAdapter` 增加可选的 `extractVisualSource(doc, url)` 与 `navigateToVisualSource(doc, url, anchor)` 能力，平台细节留在适配器中。消息协议保持 `EXTRACT_VISUAL_SOURCE` 与 `NAVIGATE_TO_SOURCE` 的现有外形，导航响应允许同步或异步。

`ContentDocument` 继续使用 version 1，不增加 DOM、播放器或时间对象。`AnalysisSourceBlock` 只传递纯数据；平台在定位时重新构建本地的 Block→DOM 元素、消息容器或视频时间映射。AI 只能返回 Block ID 和短引用，不能直接指定跳转目标。

## 平台行为

- X：保持当前 X Tweet/X Article 行为；X Article 按正文块定位，Tweet 静态展示。
- 知乎：回答只处理 URL 指定的焦点回答，文章只处理正文容器；按正文块唯一匹配后滚动高亮。
- 小黑盒：只处理当前帖子正文，排除评论、推荐、广告和操作区；按正文块定位。
- ChatGPT：分析当前页面全部已加载的 user/assistant 消息，忽略 system/tool/thinking 和空占位；结构条目定位对应消息。
- B 站：按 BV+分P/cid 识别资源。有章节时按章节起点定位；无章节时按连续 60 秒字幕窗口定位；无字幕时使用标题、简介和官方章节生成速览，Markdown 同步保存并标注暂无字幕。跳转只设置 `video.currentTime`，保持原播放/暂停状态，播放器未就绪最多等待 3 秒。

## 数据和错误

有来源块时，V2 结构条目必须带真实且唯一的 `sourceBlockId/sourceQuote`；无来源块时必须不带锚点。Prompt 按内容类型补充文章、对话、视频指导，但输出保持统一 `schemaVersion: 2`。

页面内容变化、来源块缺失、Quote 歧义、资源/API 不可用或播放器不存在时，不执行猜测跳转，返回现有中文导航错误。只有用户主动触发或重新生成才向用户配置的 AI 服务发送内容；ChatGPT 私人对话不写入仓库夹具。

## 验收

自动化测试覆盖每个平台的来源块、身份校验、静态/可定位结构、失败行为和既有保存回归。真实验收采用每个平台至少 3 个代表性页面、累计至少 10 次定位点击；B 站额外覆盖章节字幕、无章节字幕、无字幕和分P。错误定位为 0；无法唯一定位只能保守失败。
