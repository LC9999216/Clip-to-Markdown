import { describe, it, expect } from 'vitest';
import { renderBlocks, renderDocument, renderInline } from '../../src/core/markdown-renderer';
import type { BlockNode, ContentDocument, InlineNode } from '../../src/core/schema';

describe('renderInline', () => {
  it('转义特殊字符', () => {
    expect(renderInline([{ type: 'text', value: 'a*b[c](d)' }])).toBe('a\\*b\\[c\\]\\(d\\)');
  });

  it('行首块级标记被转义（防注入 H1）', () => {
    expect(
      renderInline([
        { type: 'text', value: '刚发现这个！' },
        { type: 'break' },
        { type: 'text', value: '# 标题来了' },
        { type: 'break' },
        { type: 'text', value: '- 列表项' },
      ]),
    ).toBe('刚发现这个！  \n\\# 标题来了  \n\\- 列表项');
  });

  it('行内代码按反引号数自适应围栏（M1）', () => {
    expect(renderInline([{ type: 'inlineCode', value: '`foo`' }])).toBe('`` `foo` ``');
    expect(renderInline([{ type: 'inlineCode', value: 'npm i' }])).toBe('`npm i`');
  });

  it('链接/加粗/斜体/行内代码/换行', () => {
    const nodes: InlineNode[] = [
      { type: 'text', value: '看看 ' },
      { type: 'link', url: 'https://example.com', children: [{ type: 'text', value: '这篇' }] },
      { type: 'text', value: '，' },
      { type: 'strong', children: [{ type: 'text', value: '重点' }] },
      { type: 'text', value: '，' },
      { type: 'emphasis', children: [{ type: 'text', value: '斜' }] },
      { type: 'text', value: '，' },
      { type: 'inlineCode', value: 'code' },
      { type: 'break' },
      { type: 'text', value: '下一行' },
    ];
    expect(renderInline(nodes)).toBe(
      '看看 [这篇](https://example.com)，**重点**，*斜*，`code`  \n下一行',
    );
  });
});

describe('renderBlocks', () => {
  it('引用多行加 > 前缀', () => {
    const blocks: BlockNode[] = [
      {
        type: 'blockquote',
        children: [
          { type: 'paragraph', children: [{ type: 'text', value: '第一行' }] },
          { type: 'paragraph', children: [{ type: 'text', value: '第二行' }] },
        ],
      },
    ];
    expect(renderBlocks(blocks)).toBe('> 第一行\n>\n> 第二行');
  });

  it('有序列表编号', () => {
    const blocks: BlockNode[] = [
      {
        type: 'list',
        ordered: true,
        children: [
          { type: 'listItem', children: [{ type: 'paragraph', children: [{ type: 'text', value: '甲' }] }] },
          { type: 'listItem', children: [{ type: 'paragraph', children: [{ type: 'text', value: '乙' }] }] },
        ],
      },
    ];
    expect(renderBlocks(blocks)).toBe('1. 甲\n2. 乙');
  });

  it('代码块按内容反引号数自适应围栏', () => {
    const blocks: BlockNode[] = [{ type: 'code', lang: 'md', value: 'a\n```\nb' }];
    expect(renderBlocks(blocks)).toBe('````md\na\n```\nb\n````');
  });

  it('代码块无反引号时用 3 个反引号围栏（合法代码块）', () => {
    const blocks: BlockNode[] = [{ type: 'code', value: 'print("hi")' }];
    expect(renderBlocks(blocks)).toBe('```\nprint("hi")\n```');
  });

  it('表格输出 GFM 语法', () => {
    const blocks: BlockNode[] = [
      {
        type: 'table',
        header: {
          type: 'tableRow',
          children: [
            { type: 'tableCell', children: [{ type: 'text', value: '名称' }] },
            { type: 'tableCell', children: [{ type: 'text', value: '值' }] },
          ],
        },
        children: [
          {
            type: 'tableRow',
            children: [
              { type: 'tableCell', children: [{ type: 'text', value: '甲' }] },
              { type: 'tableCell', children: [{ type: 'text', value: '1|2' }] },
            ],
          },
        ],
      },
    ];
    expect(renderBlocks(blocks)).toBe('| 名称 | 值 |\n| --- | --- |\n| 甲 | 1\\|2 |');
  });

  it('图片', () => {
    expect(renderBlocks([{ type: 'image', url: 'https://x/1.jpg', alt: '图' }])).toBe('![图](https://x/1.jpg)');
  });

  it('图片 alt 含 ] 被转义，URL 含空格用尖括号包裹（M6）', () => {
    expect(renderBlocks([{ type: 'image', url: 'https://x/1 2.jpg', alt: '图[1]' }])).toBe(
      '![图\\[1\\]](<https://x/1 2.jpg>)',
    );
  });

  it('markdown 块：保留代码围栏、列表、链接、粗体，不转义', () => {
    const blocks: BlockNode[] = [
      {
        type: 'markdown',
        value: '请检查：\n\n```ts\nconst x = 1;\n```\n\n- 第一项\n\n[文档](https://example.com) **重点**',
      },
    ];
    expect(renderBlocks(blocks)).toBe(
      '请检查：\n\n```ts\nconst x = 1;\n```\n\n- 第一项\n\n[文档](https://example.com) **重点**',
    );
  });

  it('markdown 块：CRLF 转 LF，内部空行保留，NUL 去除', () => {
    const blocks: BlockNode[] = [{ type: 'markdown', value: 'a\r\n\r\nb\u0000c' }];
    expect(renderBlocks(blocks)).toBe('a\n\nbc');
  });

  it('markdown 块：去除首尾空白行', () => {
    const blocks: BlockNode[] = [{ type: 'markdown', value: '\n\n正文\n\n' }];
    expect(renderBlocks(blocks)).toBe('正文');
  });

  it('普通 TextNode 仍继续转义 Markdown（不影响既有平台安全行为）', () => {
    expect(renderInline([{ type: 'text', value: '- 不是列表' }])).toBe('\\- 不是列表');
  });
});

describe('renderDocument', () => {
  it('tweet 文档输出 frontmatter + 标题 + 正文 + footer', () => {
    const doc: ContentDocument = {
      version: 1,
      metadata: {
        platform: 'x',
        contentType: 'tweet',
        sourceUrl: 'https://x.com/alice/status/123',
        author: { name: 'Alice', handle: 'alice' },
        published: '2024-01-01T00:00:00Z',
      },
      body: {
        type: 'tweet',
        author: { name: 'Alice', handle: 'alice' },
        published: '2024-01-01T00:00:00Z',
        id: '123',
        content: [{ type: 'paragraph', children: [{ type: 'text', value: 'hello' }] }],
        media: [{ type: 'image', url: 'https://pbs.twimg.com/1.jpg?name=large', alt: '' }],
      },
    };
    expect(renderDocument(doc)).toBe(
      [
        '---',
        'platform: x',
        'author: "Alice (@alice)"',
        'published: "2024-01-01T00:00:00Z"',
        'url: https://x.com/alice/status/123',
        '---',
        '',
        '# Alice (@alice)',
        '',
        'hello',
        '',
        '![Image](https://pbs.twimg.com/1.jpg?name=large)',
        '',
        '---',
        '',
        '> 原文链接：https://x.com/alice/status/123',
        '> 发布时间：2024-01-01T00:00:00Z',
      ].join('\n'),
    );
  });

  it('article 文档输出 # 标题', () => {
    const doc: ContentDocument = {
      version: 1,
      metadata: {
        platform: 'zhihu',
        contentType: 'zhihu-article',
        sourceUrl: 'https://zhuanlan.zhihu.com/p/9',
        author: { name: '张三' },
        published: '',
        title: '我的文章',
      },
      body: {
        type: 'article',
        children: [{ type: 'paragraph', children: [{ type: 'text', value: '正文' }] }],
      },
    };
    const md = renderDocument(doc);
    expect(md).toContain('# 我的文章');
    expect(md).toContain('author: "张三"');
    expect(md).toContain('published: ""');
    expect(md).toContain('> 原文链接：https://zhuanlan.zhihu.com/p/9');
  });
});

describe('Obsidian 图片渲染兼容性（回归）', () => {
  function docWithImage(): ContentDocument {
    return {
      version: 1,
      metadata: {
        platform: 'heybox',
        contentType: 'heybox-post',
        sourceUrl: 'https://www.xiaoheihe.cn/app/bbs/link/187550351',
        author: { name: '测试作者' },
        published: '',
        title: '测试文章',
      },
      body: {
        type: 'article',
        children: [
          { type: 'paragraph', children: [{ type: 'text', value: '正文第一段' }] },
          { type: 'image', url: 'https://cdn.example.com/pic1.jpg', alt: '' },
          { type: 'paragraph', children: [{ type: 'text', value: '正文第二段' }] },
        ],
      },
    };
  }

  it('图片语法干净：!\\[ 与 \\] 绝不出现', () => {
    const md = renderDocument(docWithImage());
    expect(md).toContain('![Image](https://cdn.example.com/pic1.jpg)');
    expect(md).not.toContain('!\\[');
    expect(md).not.toContain('\\]');
  });

  it('frontmatter 与 footer 分隔线无反斜杠', () => {
    const md = renderDocument(docWithImage());
    const lines = md.split('\n');
    expect(lines[0]).toBe('---'); // frontmatter 开
    expect(md).not.toMatch(/^\\---/m); // 任何行都不以 \--- 开头
    const footerIdx = lines.findIndex((l) => l.startsWith('> 原文链接'));
    // 结构为 ...正文 / --- / 空行 / > 原文链接
    expect(lines[footerIdx - 2]).toBe('---'); // footer 分隔线干净
  });
});
