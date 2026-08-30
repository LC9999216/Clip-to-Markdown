# 一图速览 Anchor 自动恢复进度报告

## 一、目标与非目标

**目标：** 当"一图速览"因 `sourceQuote` 与对应 Source Block 不一致而校验失败时，先在本地高置信度重匹配真实原句（只改 `sourceQuote`，绝不猜测或更改 `sourceBlockId`）；现有 AI repair 仍失败时自动完整重生成一次（fresh，使用原始 prompt）；只有三阶段都失败才显示最终错误和"重新生成"。一次用户主动生成最多 3 次 Provider 请求，三阶段共享现有 30 秒总超时，HTTP/鉴权/限流/网络/超时错误不触发额外重试，只有严格校验通过的结果才进入缓存和 done state。

**非目标：** 不降低或删除严格 Anchor 校验；不跨 Block 猜测 Block ID；不用 title 反向猜 Block；不取 Block 开头兜底；不缓存未通过校验的结果；不在 Side Panel 自动重新触发任务；不修改页面抓取/Source Block 编号/导航算法/字幕/WBI；不新增 npm 依赖；不 merge/push/PR/改 main。

**执行方式说明：** 计划要求使用 superpowers:subagent-driven-development 或 superpowers:executing-plans 技能；当前会话技能目录中不存在这两个技能（目录已更换为不含 superpowers 前缀的版本）。按计划自带的任务分解（Task 0–7、checkbox、TDD、小提交）直接执行，效果等同。

## 二、开始状态与保护文件哈希

- 分支：`codex/bilibili-subtitle-sidepanel`；起始 HEAD：`36d11f9`（与计划编写时一致，无前移）
- 基线门禁：`npm test` 38 文件 / 613 测试全过；typecheck 0；build 0；`git diff --check` 0
- 工作树：仅 3 个保护文件（未提交修改）+ 本计划文档（未跟踪），无来源不明修改

保护文件 SHA256（开始时，与计划参考值逐一相同）：

| 文件 | SHA256 |
|---|---|
| `src/adapters/bilibili/subtitle-service.ts` | `D13CE7BB7C8070D8EA29FB96F3F26FCFF0EB5A4DEC1EB0040BA37FED07B2FBBE` |
| `tests/adapters/bilibili-subtitle-service.test.ts` | `D3002CB2E7429CD9BDEC2FABFFFEF2E8B632ECF2C5853021796975A6B762E21E` |
| `tests/adapters/bilibili.test.ts` | `96E0DB754D987834D62103AEDD2BDE387CB57117A0F74A821D8245E0EB308CA7` |

承诺：不回退/不覆盖/不格式化/不暂存/不提交这 3 个文件；不使用 stash/clean/checkout --/reset 处理它们。

## 三、设计合同与请求上限

- 本地恢复合同：相似度 ≥ 0.72；第一名领先第二名 ≥ 0.08；归一化后 < 6 code points 不做模糊恢复；返回 Quote 必须是对应 Block 的精确原文子串且 ≤ 140 code points；跨 Block 重复、低相似度、歧义、错误 Block ID 保守失败；只修改 `sourceQuote`。
- 请求状态机：Stage 1 INITIAL（原始 prompt）→ Stage 2 REPAIR（一次）→ Stage 3 FRESH（原始 prompt、不带旧输出/repair 错误）；最多 3 次；非校验错误直接传播；三阶段共享 30 秒 AbortController。
- 校验门：parse → 本地恢复 → `validateVisualSummaryAnchors` 三阶段统一；只有通过者可写缓存/done。

## 四、TDD 红灯证据

（待 Task 1/3 回填）

## 五、实现摘要

（待 Task 2/4 回填）

## 六、自动化门禁

（待回填）

## 七、独立审查与处置

（待 Task 6 回填）

## 八、Chrome/API 验收

（待 Task 7 回填）

## 九、未验证项与已知限制

（待回填）

## 十、提交记录和最终状态

（待回填）
