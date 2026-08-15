/**
 * ChatGPT（chatgpt.com）选择器。
 * 基于真实对话页（另存 HTML）确认的结构，2026-08：
 *   div[data-message-author-role="user|assistant"]   ← 每条消息容器（按文档顺序）
 *     user      → div.whitespace-pre-wrap            ← 用户纯文本
 *     assistant → div.markdown                       ← 渲染后的富文本
 *                     ├─ p / strong / h3 / ul / table
 *                     └─ pre > .cm-editor > .cm-content > .cm-line  ← CodeMirror 代码块
 * 若真实页面变化，用 scripts/analyze-page.mjs 校准后再改这里。
 */

export const CHATGPT_SELECTORS = {
  /** 消息容器（含 user / assistant / system / tool 等，靠 role 属性区分） */
  message: '[data-message-author-role]',
  /** 角色属性名 */
  role: 'data-message-author-role',
  /** ChatGPT 正文（渲染后 markdown） */
  assistantContent: '.markdown',
  /** 用户消息文本容器 */
  userContent: '.whitespace-pre-wrap',
  /** 代码块（相对 assistant 正文）：CodeMirror 结构 */
  codeBlock: 'pre',
  /** CodeMirror 代码行 */
  codeLine: '.cm-line',
  /** 清洗干扰（代码块内的复制按钮等） */
  remove: ['button', 'script', 'style', 'svg'],
} as const;

/** 从 URL 提取对话 id（/c/{uuid}，要求是完整路径段，避免 /c/abcSomething 误匹配） */
export const CHAT_ID_RE = /^\/c\/([0-9a-zA-Z-]+)(?:\/|$)/;
