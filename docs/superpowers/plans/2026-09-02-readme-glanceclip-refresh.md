# GlanceClip README 重写与演示素材实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 README 重写为以「先看懂，再收藏」为核心的中文产品介绍：品牌展示名更新为 GlanceClip（扩展内部名称保持 Clip to Markdown），重建首屏与平台能力表，按用户任务组织核心功能，并补充两段真实录制的演示 GIF（一图速览、B站字幕阅读）。

**Architecture:** 只改动 README.md 与新增演示素材，不触碰功能代码、manifest、接口、类型与测试逻辑。README 字符串测试（`tests/visual-summary.test.ts`）对字幕隐私、费用、无 ASR 与第三方参考来源的既有约束必须继续满足。

**Tech Stack:** Markdown、真实 Chrome（CDP 加载 `dist/` 扩展）、ffmpeg（GIF 合成与压缩）、Vitest。

---

## 0. 交付边界与成功标准

### 0.1 本轮必须完成

- [x] 首屏重建：标题 `👁️ GlanceClip`、「先看懂，再收藏」定位、平台统一为 X / 知乎 / Bilibili / ChatGPT / 小黑盒、真实锚点导航（安装 / 快速开始 / 功能介绍）、一句品牌过渡说明。
- [x] 以用户任务组织核心功能：不只是 Web Clipper、一图速览、B站字幕阅读、一键收藏；保留「只提取内容本体」边界。
- [x] 能力描述修正：X 原文定位限定 X Article；B站字幕只用官方人工/AI 轨；AI 翻译三条件（无官方简中 + 有英文轨 + 用户显式开启）；保留「不会发送音频或视频」「可能产生费用」「无ASR」与 `biuworks/bilibili-digest`、`THIRD_PARTY_NOTICES.md` 引用。
- [x] 平台能力表重建为「平台 / Markdown / 一图速览 / 原文定位 / 字幕阅读」五列；快捷键与 manifest 一致（`Ctrl+Shift+Y`、`Ctrl+Shift+S`、`Alt+Shift+S` + Mac 差异）；安装步骤以 `npm ci` 为主、`npm install` 兜底。
- [x] 删除全部裸占位符（`[这里放 GIF]`、`[Edge Add-ons]` 等）与重复段落。
- [ ] 新增 `docs/assets/readme/visual-summary-demo.gif` 与 `docs/assets/readme/bilibili-subtitle-demo.gif`：**由用户自行录制提供**；文件就位后 agent 核对：8–15 秒、宽约 960px、循环、单文件 ≤ 6 MB、裁切避开旧品牌抬头、账号头像、API Key、Vault 路径与个人通知，并确认 README 相对路径引用正确。
- [x] 自动验证：2026-09-02 已确认 `npm test`（39 个测试文件、643/643）、`npm run typecheck`、`npm run build`、`git diff --check` 全部通过；README 锚点、现有相对链接目标、代码块闭合与保护字符串检查通过。两个 GIF 的存在性与媒体规格不计入本项，由用户补充后单独验收。
- [x] 用户于 2026-09-02 明确授权 Agent 先提交并推送当前文档改动；本次只精确暂存 README.md 与本计划文档，不包含两个待用户后续补充的 GIF、`tmp-recording/` 或 `.playwright-cli/`。禁止 `git add .`。

### 0.2 明确不做

- 不改 manifest、源码、产品内品牌、页面标题、测试逻辑或第三方声明。
- 不写尚不存在的商店 URL 或 Edge 发布信息；Edge 兼容性仅在完成源码加载验证后才写入。
- 不触碰 `.playwright-cli/`（保持未跟踪原样）。
- 除本次用户明确授权推送当前功能分支外，不推送 `main`、不发商店、不执行其他远程仓库变更。

### 0.3 风险与默认假设

- 展示品牌与扩展内部名称暂时不一致：用过渡说明 + 素材裁切处理，不扩大为全项目重命名。
- GIF 体积：优先缩短时长、降帧率、裁切范围，不牺牲文字可读性。
- 平台 DOM / 公开示例可能变化：录制前先验证页面功能，失效则更换同等公开标准的示例。
- 一图速览 GIF 录制使用用户自配的 AI 服务；录制时注意设置页与侧栏不得露出 API Key（与既有裁切规则一致）。

## 1. 任务拆分

1. 建分支 `codex/readme-glanceclip-refresh`（基于 main/f618e4e，当前工作区，不建 worktree）。
2. 重写 README.md（内容结构见 §2）。
3. 一图速览与 B站字幕两段 GIF 由用户录制并放入 `docs/assets/readme/`（可在已构建的 `dist` 上加载扩展后录制；快捷键 `Ctrl+Shift+Y` 打开一图速览；B站测试视频参考既往验收记录：`BV1dsut6AES4` 官方中文轨、`BV1Yku16CEzX` 英文/日文 AI 轨）。文件就位后 agent 核对规格并入库。
4. Agent 完成 §3 中除 GIF 外的验证后，只精确暂存 README.md 与本计划文档，提交并推送当前功能分支；两个 GIF 由用户后续单独补充。

## 2. README 结构（目标）

```text
# 👁️ GlanceClip
定位语 + 平台列表 + 过渡说明 + 导航（安装 / 快速开始 / 功能介绍）
## 安装（源码安装步骤，Chrome 116+；Edge 仅在验证后写入）
## 快速开始（怎么用 + 快捷键表）
## 功能介绍
### 不只是 Web Clipper（先摘要、再定位、最后收藏）
### 一图速览（两句话摘要 / 核心观点 / 内容结构 / 可靠原文定位；含 GIF）
### B站字幕阅读（官方字幕轨 / 切换 / 跟随 / 跳转 / 约4秒分段；含 GIF）
### 一键收藏（Markdown 下载 / 自定义目录 / Obsidian / 文件命名 / Markdown 保留）
平台能力表（平台 / Markdown / 一图速览 / 原文定位 / 字幕阅读）
AI 配置 / Obsidian 配置 / 隐私边界 / 文件命名 / 使用提示 / 常见问题 / 已知限制 / 开发 / License
```

## 3. 验证

```powershell
npm test
npm run typecheck
npm run build
git diff --check
```

- README 专项：现有字符串测试约束（`B站独立字幕页`、`简体中文（AI 翻译）`、`不会发送音频或视频`、`可能产生费用`、`无ASR`、`https://github.com/biuworks/bilibili-digest`）全部保留；锚点跳转、相对链接、图片路径、代码块闭合、无 `[这里放`/`[Edge Add-ons]` 占位符。
- GIF 专项：可解码、循环、宽约 960px、≤ 6 MB、无隐私泄露。
- 手工场景：Chrome 116+ 从 `dist` 加载并复现安装步骤；公开文章生成一图速览并定位；B站视频进入字幕页、切轨、跟随、跳转。Edge 仅验证后写。
