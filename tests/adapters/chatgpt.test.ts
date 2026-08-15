import { describe, it, expect } from 'vitest';
import { chatgptAdapter } from '../../src/adapters/chatgpt';
import { renderDocument } from '../../src/core/markdown-renderer';
import { checkJsonRoundTrip, validateDocument, type ContentDocument } from '../../src/core/schema';
import { mountFixture, readExpectedMd } from '../helpers';

const CHAT_URL = 'https://chatgpt.com/c/test-conversation-id';

function extract(): ContentDocument {
  mountFixture('chatgpt', 'chat');
  return chatgptAdapter.extract(document, new URL(CHAT_URL));
}

function extractFixture(platform: string, name: string, url: string): ContentDocument {
  mountFixture(platform, name);
  return chatgptAdapter.extract(document, new URL(url));
}

function setDom(html: string): void {
  document.open();
  document.write(`<!DOCTYPE html><html><head><title>T</title></head><body>${html}</body></html>`);
  document.close();
}

const USER_MSG = (body: string) =>
  `<div data-message-author-role="user"><div class="whitespace-pre-wrap">${body}</div></div>`;
const ASSISTANT_MSG = (body: string) =>
  `<div data-message-author-role="assistant"><div class="markdown prose">${body}</div></div>`;

describe('ChatGPT adapter：提取与渲染', () => {
  it('提取 + 渲染与期望一致，且通过结构校验与 JSON round-trip', () => {
    const doc = extract();
    expect(validateDocument(doc)).toEqual([]);
    expect(checkJsonRoundTrip(doc)).toBeNull();
    expect(renderDocument(doc).trim()).toBe(readExpectedMd('chatgpt', 'chat'));
  });

  it('元数据正确', () => {
    const doc = extract();
    expect(doc.metadata.platform).toBe('chatgpt');
    expect(doc.metadata.contentType).toBe('chatgpt-chat');
    expect(doc.metadata.title).toBe('D盘空间转移到C盘');
    expect(doc.metadata.author.name).toBe('ChatGPT');
    expect(doc.metadata.id).toBe('test-conversation-id');
  });

  it('system/内部消息绝不混入，且保留用户/ChatGPT 角色标题', () => {
    const md = renderDocument(extract());
    expect(md).not.toContain('这是系统提示');
    expect(md).toContain('## 用户');
    expect(md).toContain('## ChatGPT');
  });

  it('代码块渲染为合法围栏，复制按钮等噪声不混入', () => {
    const md = renderDocument(extract());
    expect(md).toContain('```\n# 磁盘分区示例');
    expect(md).toContain('D盘: 500GB');
    expect(md).not.toContain('复制');
  });

  it('matches 仅命中 chatgpt 域名', () => {
    expect(chatgptAdapter.matches(new URL('https://chatgpt.com/c/abc'))).toBe(true);
    expect(chatgptAdapter.matches(new URL('https://chat.openai.com/'))).toBe(true);
    expect(chatgptAdapter.matches(new URL('https://zhihu.com/'))).toBe(false);
    expect(chatgptAdapter.matches(new URL('https://foo.openai.com/'))).toBe(false);
  });

  it('detectTitle 读取并清洗标题', () => {
    mountFixture('chatgpt', 'chat');
    expect(chatgptAdapter.detectTitle?.(new URL(CHAT_URL), document, 'chatgpt-chat')).toBe(
      'D盘空间转移到C盘',
    );
  });
});

describe('ChatGPT adapter：用户消息 Markdown 语义', () => {
  it('用例 A-D：纯文本 Markdown（多段、代码块、列表、引用、链接、粗体）原样保留', () => {
    const doc = extractFixture('chatgpt', 'markdown-user', 'https://chatgpt.com/c/markdown-user');
    expect(validateDocument(doc)).toEqual([]);
    expect(renderDocument(doc).trim()).toBe(readExpectedMd('chatgpt', 'markdown-user'));
    const md = renderDocument(doc);
    // 不转义、不拍平
    expect(md).toContain('```ts');
    expect(md).toContain('const x = 1;');
    expect(md).toContain('- 第一项');
    expect(md).toContain('> 注意事项');
    expect(md).toContain('[文档](https://example.com)');
    expect(md).toContain('**重点**');
    expect(md).not.toContain('\\-');
    expect(md).not.toContain('\\>');
    expect(md).not.toContain('\\`');
  });

  it('用例 E：语义化富文本用户 DOM 走 DOM-to-AST（非 raw markdown 节点）', () => {
    const doc = extractFixture('chatgpt', 'rich-user', 'https://chatgpt.com/c/rich-user');
    expect(validateDocument(doc)).toEqual([]);
    expect(renderDocument(doc).trim()).toBe(readExpectedMd('chatgpt', 'rich-user'));
    // 不应出现 raw markdown 块节点
    const blocks = doc.body.type === 'article' ? doc.body.children : [];
    expect(blocks.some((b) => b.type === 'markdown')).toBe(false);
    expect(blocks.some((b) => b.type === 'list')).toBe(true);
  });

  it('用例 F：空用户消息不产生空角色标题，后续有效消息仍提取', () => {
    setDom(`${USER_MSG('   ')}${ASSISTANT_MSG('<p>只有助手</p>')}`);
    const doc = chatgptAdapter.extract(document, new URL('https://chatgpt.com/'));
    const md = renderDocument(doc);
    expect(md).not.toContain('## 用户');
    expect(md).toContain('## ChatGPT');
    expect(md).toContain('只有助手');
  });
});

describe('ChatGPT adapter：页面类型判定（路由表）', () => {
  const detect = (url: string) => chatgptAdapter.detectType(new URL(url), document);

  it('chatgpt.com/c/abc 有消息 → 支持', () => {
    mountFixture('chatgpt', 'chat');
    expect(detect('https://chatgpt.com/c/abc')).toBe('chatgpt-chat');
  });

  it('chatgpt.com/c/abc 未加载 → 仍支持，提取时报加载错误', () => {
    setDom('<div>空页面</div>');
    expect(detect('https://chatgpt.com/c/abc')).toBe('chatgpt-chat');
    expect(() => chatgptAdapter.extract(document, new URL('https://chatgpt.com/c/abc'))).toThrow(
      '未找到对话内容',
    );
  });

  it('chatgpt.com/ 有用户消息 → 支持', () => {
    setDom(USER_MSG('你好'));
    expect(detect('https://chatgpt.com/')).toBe('chatgpt-chat');
  });

  it('chatgpt.com/ 有助手消息 → 支持', () => {
    setDom(ASSISTANT_MSG('<p>回复</p>'));
    expect(detect('https://chatgpt.com/')).toBe('chatgpt-chat');
  });

  it('chatgpt.com/ 空页面 → 不支持', () => {
    setDom('<div>空页面</div>');
    expect(detect('https://chatgpt.com/')).toBeNull();
  });

  it('settings 即使残留消息 DOM → 不支持', () => {
    mountFixture('chatgpt', 'chat');
    expect(detect('https://chatgpt.com/settings')).toBeNull();
  });

  it('auth/login 任意 DOM → 不支持', () => {
    mountFixture('chatgpt', 'chat');
    expect(detect('https://chatgpt.com/auth/login')).toBeNull();
  });

  it('login 任意 DOM → 不支持', () => {
    mountFixture('chatgpt', 'chat');
    expect(detect('https://chatgpt.com/login')).toBeNull();
  });

  it('chat.openai.com/c/abc 有消息 → 支持', () => {
    mountFixture('chatgpt', 'chat');
    expect(detect('https://chat.openai.com/c/abc')).toBe('chatgpt-chat');
  });

  it('example.com/c/abc 有消息 → 不支持', () => {
    mountFixture('chatgpt', 'chat');
    expect(detect('https://example.com/c/abc')).toBeNull();
  });

  it('system/tool 消息（无 user/assistant）→ 不支持', () => {
    setDom(
      '<div data-message-author-role="system">系统</div>' +
        '<div data-message-author-role="tool">工具</div>',
    );
    expect(detect('https://chatgpt.com/')).toBeNull();
  });

  it('空 user/assistant 容器（无有效正文）→ 不支持', () => {
    setDom(`${USER_MSG('')}${ASSISTANT_MSG('')}`);
    expect(detect('https://chatgpt.com/')).toBeNull();
  });
});
