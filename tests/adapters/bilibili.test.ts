import { describe, it, expect } from 'vitest';
import {
  buildBodyMarkdown,
  extractBvid,
  extractPageIndex,
} from '../../src/adapters/bilibili/extractor';

describe('bilibili URL 解析', () => {
  it('从视频页 URL 提取 BV 号', () => {
    const url = new URL('https://www.bilibili.com/video/BV1xx411c7mD/?p=2');
    expect(extractBvid(url)).toBe('BV1xx411c7mD');
  });

  it('提取分 P 参数，缺省为 1', () => {
    expect(extractPageIndex(new URL('https://www.bilibili.com/video/BV1xx411c7mD/?p=2'))).toBe(2);
    expect(extractPageIndex(new URL('https://www.bilibili.com/video/BV1xx411c7mD/'))).toBe(1);
  });
});

describe('buildBodyMarkdown', () => {
  it('无章节：输出字幕时间戳行', () => {
    const md = buildBodyMarkdown({
      description: '',
      chapters: [],
      body: [
        { from: 0, to: 3, content: '你好' },
        { from: 4, to: 7, content: '世界' },
      ],
    });
    expect(md).toContain('## 字幕');
    expect(md).toContain('`00:00` 你好');
    expect(md).toContain('`00:04` 世界');
    expect(md).not.toContain('## 章节');
  });

  it('含简介与章节：输出简介、章节列表与按章节分组的字幕', () => {
    const md = buildBodyMarkdown({
      description: '这是一个简介',
      chapters: [
        { title: '开场', from: 0, to: 10 },
        { title: '正题', from: 10, to: 20 },
      ],
      body: [
        { from: 1, to: 2, content: '开场白' },
        { from: 12, to: 14, content: '正题内容' },
      ],
    });
    expect(md).toContain('## 简介');
    expect(md).toContain('这是一个简介');
    expect(md).toContain('## 章节');
    expect(md).toContain('- `00:00` 开场');
    expect(md).toContain('### 开场');
    expect(md).toContain('### 正题');
    expect(md).toContain('`00:01` 开场白');
    expect(md).toContain('`00:12` 正题内容');
  });

  it('不含时间戳：只输出纯文本字幕', () => {
    const md = buildBodyMarkdown({
      description: '',
      chapters: [],
      body: [{ from: 0, to: 3, content: '纯文本' }],
      includeTimestamp: false,
    });
    expect(md).toContain('纯文本');
    expect(md).not.toContain('`00:00`');
  });

  it('超过 1 小时：时间戳带小时位', () => {
    const md = buildBodyMarkdown({
      description: '',
      chapters: [],
      body: [{ from: 3661, to: 3665, content: '一小时后的内容' }],
    });
    expect(md).toContain('`01:01:01` 一小时后的内容');
  });

  it('空字幕：输出暂无字幕占位', () => {
    const md = buildBodyMarkdown({ description: '', chapters: [], body: [] });
    expect(md).toContain('（暂无字幕）');
  });
});
