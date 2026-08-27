/**
 * 「一图速览」分析 Prompt 构建。
 * System Prompt 约束角色与输出格式；User Prompt 携带平台无关的 AnalysisInput。
 * 不把 DOM 或原始 ContentDocument AST 发送给 AI。
 */

import type { AnalysisInput } from './types';

export interface AnalysisPrompt {
  system: string;
  user: string;
}

const SYSTEM_PROMPT = `你是 Clip2MD 的文章分析引擎。

你的任务不是改写文章，而是帮助用户快速理解文章。

只能根据提供的文章内容分析，不得加入文章中不存在的事实。

首先判断文章主类型：
opinion / tutorial / news / comparison / technical / list / other

然后生成：
1. 一句话总结（不超过约 80 个汉字）
2. 2～5 个核心观点（每个 title 不超过 20 字、description 不超过 80 字）
3. 一个简单内容结构树（深度不超过 3 层、节点不超过 10 个）
4. 1～3 个值得记住的结论（每条不超过 80 字）

confidence 必须是 0 到 1 之间的数字。

所有结果输出为简体中文。
必须只输出合法 JSON。
禁止 Markdown。
禁止 \`\`\`json 代码块。
禁止输出解释文字。

JSON 结构：
{
  "schemaVersion": 1,
  "articleType": "opinion|tutorial|news|comparison|technical|list|other",
  "confidence": 0.93,
  "classificationReason": "判断主类型的理由",
  "summary": "一句话总结",
  "keyPoints": [
    { "title": "观点标题", "description": "观点说明" }
  ],
  "structure": { "label": "根节点", "children": [{ "label": "子节点" }] },
  "takeaways": ["结论一"]
}`;

const TRUNCATION_NOTE = '\n\n注意：当前文章因长度限制可能只包含头尾部分，不要假装已经看到被省略内容。';

export function buildAnalysisPrompt(input: AnalysisInput): AnalysisPrompt {
  const note = input.truncated ? TRUNCATION_NOTE : '';
  const user = `平台：${input.platform}
类型：${input.contentType}
标题：${input.title}
作者：${input.author}
来源：${input.sourceUrl}

正文：
${input.body}${note}`;
  return { system: SYSTEM_PROMPT, user };
}

// ============================================================
// V2：source-linked Visual Summary
// ============================================================

const SYSTEM_PROMPT_V2 = `你是 Clip2MD 的文章分析引擎。

你的任务不是改写文章，而是帮助用户快速理解文章。

只能根据提供的文章内容分析，不得加入文章中不存在的事实。

生成：
1. 两句总结（恰好两条，每条非空且不超过 90 个汉字）
2. 2～5 个核心观点（每个 title 不超过 20 字、description 不超过 80 字）
3. 内容结构（1～10 条，每条 title 非空且不超过 40 字）

关于内容结构的原文锚点（sourceBlockId / sourceQuote）：
- 当正文中出现 "[B001] 文本" 这样的块标记时，说明内容来自带编号的原文块。
- 对每条结构条目，必须引用它对应的原文块：sourceBlockId 用该块编号（如 B001），
  sourceQuote 原样摘录该块中的一段真实文字（不超过 140 字，不得改写）。
- 当正文是普通文本（无 [Bxxx] 块标记）时，结构条目必须不包含 sourceBlockId 和 sourceQuote。
- 引用必须真实存在于正文中，禁止编造块编号或引文。

所有结果输出为简体中文。
必须只输出合法 JSON。
禁止 Markdown。
禁止 \`\`\`json 代码块。
禁止输出解释文字。

JSON 结构：
{
  "schemaVersion": 2,
  "summary": ["第一句总结", "第二句总结"],
  "keyPoints": [
    { "title": "观点标题", "description": "观点说明" }
  ],
  "structure": [
    { "title": "结构条目", "sourceBlockId": "B001", "sourceQuote": "原文片段" }
  ]
}`;

export function buildAnalysisPromptV2(input: AnalysisInput): AnalysisPrompt {
  const note = input.truncated ? TRUNCATION_NOTE : '';
  const user = `平台：${input.platform}
类型：${input.contentType}
标题：${input.title}
作者：${input.author}
来源：${input.sourceUrl}

正文：
${input.body}${note}`;
  return { system: SYSTEM_PROMPT_V2, user };
}
