import { describe, it, expect } from 'vitest';
import {
  checkJsonRoundTrip,
  validateDocument,
  type ContentDocument,
} from '../../src/core/schema';

function validTweetDoc(): ContentDocument {
  return {
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
      content: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'hello ' },
            { type: 'strong', children: [{ type: 'text', value: 'world' }] },
            { type: 'link', url: 'https://example.com', children: [{ type: 'text', value: 'link' }] },
          ],
        },
      ],
      media: [{ type: 'image', url: 'https://pbs.twimg.com/1.jpg', alt: 'pic' }],
    },
  };
}

describe('validateDocument', () => {
  it('合法文档返回空错误数组', () => {
    expect(validateDocument(validTweetDoc())).toEqual([]);
  });

  it('合法 article 文档通过', () => {
    const doc: ContentDocument = {
      version: 1,
      metadata: {
        platform: 'zhihu',
        contentType: 'zhihu-answer',
        sourceUrl: 'https://www.zhihu.com/question/1/answer/2',
        author: { name: '张三' },
        published: '2024-01-01T00:00:00Z',
        title: '问题标题',
        id: '2',
      },
      body: {
        type: 'article',
        children: [
          { type: 'heading', depth: 2, children: [{ type: 'text', value: '小节' }] },
          { type: 'blockquote', children: [{ type: 'paragraph', children: [{ type: 'text', value: '引用' }] }] },
          { type: 'list', ordered: true, children: [{ type: 'listItem', children: [{ type: 'paragraph', children: [{ type: 'text', value: '项' }] }] }] },
        ],
      },
    };
    expect(validateDocument(doc)).toEqual([]);
  });

  it('未知块类型被标记', () => {
    const doc = validTweetDoc();
    if (doc.body.type !== 'tweet') throw new Error('fixture 应为 tweet');
    (doc.body.content[0] as unknown as Record<string, unknown>).type = 'bogus';
    const errors = validateDocument(doc);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('未知块类型');
  });

  it('缺少 metadata.author.name 被标记', () => {
    const doc = validTweetDoc();
    (doc.metadata.author as unknown as Record<string, unknown>).name = undefined;
    const errors = validateDocument(doc);
    expect(errors.some((e) => e.includes('metadata.author'))).toBe(true);
  });

  it('version 非 1 被标记', () => {
    const doc = validTweetDoc();
    (doc as unknown as Record<string, unknown>).version = 2;
    expect(validateDocument(doc)[0]).toContain('version');
  });

  it('quotedTweet 递归校验', () => {
    const doc = validTweetDoc();
    if (doc.body.type !== 'tweet') throw new Error('fixture 应为 tweet');
    const body = doc.body;
    body.quotedTweet = {
      type: 'tweet',
      author: { name: 'Bob', handle: 'bob' },
      published: '',
      id: '9',
      content: [],
      media: [],
    };
    expect(validateDocument(doc)).toEqual([]);

    // 破坏引用中的节点
    body.quotedTweet.content = [{ type: 'nope' }] as never;
    const errors = validateDocument(doc);
    expect(errors.some((e) => e.includes('quotedTweet'))).toBe(true);
  });
});

describe('checkJsonRoundTrip', () => {
  it('合法文档 round-trip 通过', () => {
    expect(checkJsonRoundTrip(validTweetDoc())).toBeNull();
  });
});
