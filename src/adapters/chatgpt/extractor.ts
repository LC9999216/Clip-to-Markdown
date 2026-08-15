/**
 * ChatGPT 提取器：把当前对话提取为「一问一答」的 ContentDocument。
 * - 只取 role ∈ {user, assistant}，忽略 system/tool/thinking 等内部消息；
 * - 每轮前加 ## 用户 / ## ChatGPT 标题（正文为空时不写角色标题）；
 * - 用户纯文本 Markdown 保留语义（markdown 块），不拆成段落、不转义；
 * - 助手正文里 CodeMirror 代码块先归一化为 <pre><code>，再交给通用 dom-to-ast。
 */

import { createDomToAstContext, elementToBlocks } from '../../core/dom-to-ast';
import type { DomToAstContext } from '../../core/dom-to-ast';
import { ExtractionError, ERROR_MESSAGES } from '../../core/error';
import { CHATGPT_SELECTORS, CHAT_ID_RE } from './selectors';
import type { BlockNode, ContentDocument, PlatformContentType } from '../../core/schema';

// ---------- 页面类型判定 ----------

/** 只允许 chatgpt.com 与 chat.openai.com 两个域名 */
export function isChatgptHost(url: URL): boolean {
  return url.hostname === 'chatgpt.com' || url.hostname === 'chat.openai.com';
}

/** 明确禁止路由（登录/认证/设置），优先级高于 DOM 消息检测 */
export function isBlockedChatgptRoute(pathname: string): boolean {
  return /^\/(auth|login|settings)(\/|$)/.test(pathname);
}

/** 用户正文容器内被视为「语义化富文本」的结构（存在即走 DOM-to-AST） */
const USER_RICH_SELECTOR =
  'p, h1, h2, h3, h4, h5, h6, ul, ol, li, blockquote, pre, code, table, a, strong, em, img, figure';

function hasMessageBody(el: Element): boolean {
  if ((el.textContent ?? '').trim()) return true;
  return !!el.querySelector(USER_RICH_SELECTOR);
}

/** 只返回有效 user/assistant 消息容器（严格 role，过滤空占位、system/tool/thinking） */
export function getSupportedMessages(doc: Document): Element[] {
  return Array.from(doc.querySelectorAll(CHATGPT_SELECTORS.message)).filter((el) => {
    const role = el.getAttribute(CHATGPT_SELECTORS.role);
    if (role !== 'user' && role !== 'assistant') return false;
    if (!el.isConnected) return false;
    return hasMessageBody(el);
  });
}

export function hasSupportedMessages(doc: Document): boolean {
  return getSupportedMessages(doc).length > 0;
}

/**
 * 判定规则（顺序固定）：
 * 1. 域名不匹配 → null
 * 2. 命中登录/认证/设置等禁止路由 → null
 * 3. URL 命中 /c/{id} → chatgpt-chat（即使消息未加载也支持，保存时报加载错误）
 * 4. 非 /c/{id}，但 DOM 已有有效 user/assistant 消息 → chatgpt-chat（首页临时对话）
 * 5. 其他 → null
 */
export function detectChatgptType(url: URL, doc: Document): PlatformContentType | null {
  if (!isChatgptHost(url)) return null;
  if (isBlockedChatgptRoute(url.pathname)) return null;
  if (CHAT_ID_RE.test(url.pathname)) return 'chatgpt-chat';
  if (hasSupportedMessages(doc)) return 'chatgpt-chat';
  return null;
}

// ---------- 提取 ----------

export function extractChatgpt(doc: Document, url: URL): ContentDocument {
  const type = detectChatgptType(url, doc);
  if (!type) throw new ExtractionError('UNSUPPORTED_PAGE', ERROR_MESSAGES.UNSUPPORTED_PAGE);

  const messages = getSupportedMessages(doc);
  if (messages.length === 0) {
    throw new ExtractionError('NOT_FOUND_BODY', '未找到对话内容，可能页面尚未加载完成。');
  }

  const ctx = createDomToAstContext(url.href);
  const blocks: BlockNode[] = [];
  for (const msg of messages) {
    const role = msg.getAttribute(CHATGPT_SELECTORS.role) as 'user' | 'assistant';
    const messageBlocks = role === 'assistant' ? extractAssistant(msg, ctx) : extractUser(msg, ctx);
    // 空消息不生成角色标题（避免流式占位/空容器产生孤立标题）
    if (messageBlocks.length === 0) continue;
    blocks.push({
      type: 'heading',
      depth: 2,
      children: [{ type: 'text', value: role === 'user' ? '用户' : 'ChatGPT' }],
    });
    blocks.push(...messageBlocks);
  }

  return {
    version: 1,
    metadata: {
      platform: 'chatgpt',
      contentType: 'chatgpt-chat',
      sourceUrl: url.href,
      author: { name: 'ChatGPT' },
      published: '',
      title: detectChatgptTitle(doc),
      id: extractConversationId(url),
    },
    body: { type: 'article', children: blocks },
  };
}

// ---------- 用户 / 助手 ----------

function extractUser(msg: Element, ctx: DomToAstContext): BlockNode[] {
  const textEl = msg.querySelector(CHATGPT_SELECTORS.userContent) ?? msg;

  // 路径 A：用户消息包含语义化富文本 DOM → 复用通用 DOM-to-AST
  if (textEl.querySelector(USER_RICH_SELECTOR)) {
    return elementToBlocks(textEl, ctx);
  }

  // 路径 B：纯文本 Markdown → 保留语义，输出单个 markdown 块
  const text = normalizeMarkdownText(textEl.textContent ?? '');
  if (!text) return []; // 路径 C：空消息
  return [{ type: 'markdown', value: text }];
}

/** CRLF/CR → LF，去 NUL，只移除首尾空白行（保留内部空行与 Markdown 标记） */
export function normalizeMarkdownText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/^(?:[ \t]*\n)+/, '')
    .replace(/(?:\n[ \t]*)+$/, '');
}

function extractAssistant(msg: Element, ctx: DomToAstContext): BlockNode[] {
  const clone = msg.cloneNode(true) as Element;
  for (const sel of CHATGPT_SELECTORS.remove) {
    for (const el of Array.from(clone.querySelectorAll(sel))) el.remove();
  }
  // 归一化 CodeMirror 代码块 → 简单 <pre><code>
  for (const pre of Array.from(clone.querySelectorAll(CHATGPT_SELECTORS.codeBlock))) {
    normalizeCodeBlock(pre);
  }
  const contentEl = clone.querySelector(CHATGPT_SELECTORS.assistantContent) ?? clone;
  return elementToBlocks(contentEl, ctx);
}

/** 把 CodeMirror 代码块（.cm-line 每行一个 div）重写为 <pre><code class="language-*"> */
function normalizeCodeBlock(pre: Element): void {
  const lines = Array.from(pre.querySelectorAll(CHATGPT_SELECTORS.codeLine)).map((l) =>
    (l.textContent ?? '').replace(/\n$/, ''),
  );
  if (lines.length === 0) return;
  const codeText = lines.join('\n');

  const owner = pre.ownerDocument;
  const code = owner.createElement('code');
  code.textContent = codeText;
  const lang = detectCodeLang(pre);
  if (lang) code.className = `language-${lang}`;

  const newPre = owner.createElement('pre');
  newPre.appendChild(code);
  pre.replaceWith(newPre);
}

/** 尽力探测代码语言：language-* class，或独立的 <code> 标签文本 */
function detectCodeLang(pre: Element): string | undefined {
  const codeEl = pre.querySelector('code');
  if (!codeEl) return undefined;
  const cls = codeEl.className;
  if (typeof cls === 'string') {
    for (const part of cls.split(/\s+/)) {
      if (part.startsWith('language-')) return part.slice('language-'.length);
    }
  }
  const text = (codeEl.textContent ?? '').trim();
  if (text && text.length <= 20 && /^[a-zA-Z+#.-]+$/.test(text)) return text;
  return undefined;
}

// ---------- 元数据 ----------

export function detectChatgptTitle(doc: Document): string | undefined {
  const t = (doc.title ?? '').trim();
  if (!t) return undefined;
  const cleaned = t.replace(/\s*[-–—|]\s*ChatGPT\s*$/i, '').trim();
  if (!cleaned || /^(ChatGPT|New chat|New conversation)$/i.test(cleaned)) return undefined;
  return cleaned;
}

function extractConversationId(url: URL): string | undefined {
  return CHAT_ID_RE.exec(url.pathname)?.[1];
}
