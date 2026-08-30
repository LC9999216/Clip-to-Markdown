# Bilibili 细粒度字幕分段进度报告

## 一、目标与非目标

**目标：** 将 B 站字幕侧栏从"十几秒一大段"改为"约 4 秒一小段、文字与该时间范围对应"。只重写 `groupTranscript` 的展示分段策略：逐条处理源字幕行、绝不跨源行合并；行内按标点/空格/确定性切点拆分，按字符偏移比例分配该源行的原始时间范围。官方字幕与"简体中文（AI 翻译）"虚拟轨使用同一套规则；点击跳转、播放高亮、翻译缓存、失败回退、刷新语义保持不变。

**非目标：** 不新增 ASR/音频下载、不改字幕接口与 WBI、不改 AI 翻译协议/提示词/费用开关、不加设置项、不改布局样式、不加依赖/网络/AI 请求、不 merge/push/PR/改 main。

**精度边界：** B 站源字幕只有整行 `from/to`，子段时间按 code point 比例估算，不是逐字语音对齐（需 ASR 或词级时间码才能更精确）。

**执行方式说明：** 计划要求使用 superpowers:executing-plans 或 superpowers:subagent-driven-development 技能；当前会话技能目录中不存在这两个技能（目录已更换为不含 superpowers 前缀的版本）。按计划自带的任务分解（Task 0–6、checkbox、TDD、小提交）直接执行，效果等同。

## 二、开始状态与保护文件哈希

- 分支：`codex/bilibili-subtitle-sidepanel`；起始 HEAD：`2c72489`
- 基线门禁：`npm test` 38 文件 / 595 测试全过（退出码 0）；`npm run typecheck` 0；`npm run build` 0；`git diff --check` 无输出
- 工作树：仅 3 个既有未提交保护文件 + 本计划文档（未跟踪），无来源不明修改

保护文件 SHA256（开始时）：

| 文件 | SHA256 |
|---|---|
| `src/adapters/bilibili/subtitle-service.ts` | `D13CE7BB7C8070D8EA29FB96F3F26FCFF0EB5A4DEC1EB0040BA37FED07B2FBBE` |
| `tests/adapters/bilibili-subtitle-service.test.ts` | `D3002CB2E7429CD9BDEC2FABFFFEF2E8B632ECF2C5853021796975A6B762E21E` |
| `tests/adapters/bilibili.test.ts` | `96E0DB754D987834D62103AEDD2BDE387CB57117A0F74A821D8245E0EB308CA7` |

承诺：不回退/不覆盖/不格式化/不暂存/不提交这 3 个文件；不使用 stash/clean/checkout --/reset 处理它们。

## 三、红灯测试证据

（待 Task 1 回填）

## 四、实现摘要

（待 Task 2 回填）

## 五、自动化验证

（待最终门禁回填）

## 六、手工 Chrome 验收

（待 Task 5 回填）

## 七、未验证项和已知限制

（待回填）

## 八、提交记录与最终工作树状态

（待回填）
