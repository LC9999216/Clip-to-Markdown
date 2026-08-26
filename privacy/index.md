---
title: Clip to Markdown 隐私政策
---

# Clip to Markdown 隐私政策

## 收集和处理的数据

Clip to Markdown 会在用户主动执行保存操作时处理当前网页内容，
包括文本、图片链接、标题、作者、发布时间和原始网址。

如果用户使用 ChatGPT 导出功能，
扩展会处理当前对话中用户和助手可见的消息。

如果用户启用 Obsidian 功能，
扩展会在本地保存 Obsidian Local REST API 地址、
API Key 和笔记目录等配置。

如果用户使用「一图速览」功能，
扩展会在用户主动触发（按下快捷键或点击重新生成）时，
把当前 X 页面提取的正文发送到用户在设置中填写的 AI 服务商，
用于生成一句话总结、核心观点、内容结构和结论。
AI 服务的 Endpoint、API Key 和模型名称保存在浏览器本地
（chrome.storage.local），只由扩展后台读取。
API Key 不会进入网页、扩展消息或日志。

## 数据用途

上述数据仅用于用户主动请求的：

- Markdown 导出
- 本地文件保存
- Obsidian 笔记保存
- 一图速览（调用用户配置的 AI 服务生成内容概要）

## 数据传输

Clip to Markdown 不运营用于接收用户剪藏内容的服务器。

普通 Markdown 内容保存在用户设备。

Obsidian 模式仅与用户本机配置的 Local REST API 通信。

一图速览模式把当前 X 页面正文发送到用户自己选择的 AI 服务商
（发送前需用户在设置中授权该服务域名），
不经过 Clip to Markdown 的服务器。

开发者不会接收用户剪藏的网页内容、Obsidian API Key 或 AI API Key。

## 数据出售与广告

Clip to Markdown 不出售用户数据，
不将用户数据用于广告、用户画像、信用评估或贷款用途。

## 用户控制

用户可以删除导出的 Markdown 文件，
也可以在扩展设置中清除相关配置或卸载扩展。

## 联系方式

luochengco_0707@qq.com
