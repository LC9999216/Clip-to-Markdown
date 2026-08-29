import { describe, it, expect, vi } from 'vitest';
import {
  buildBodyMarkdown,
  buildBilibiliSourceBlocks,
  extractBvid,
  extractPageIndex,
} from '../../src/adapters/bilibili/extractor';
import { navigateBilibiliSource, rememberBilibiliSource } from '../../src/adapters/bilibili/source';
import { bilibiliAdapter } from '../../src/adapters/bilibili';
import { mockSessionStorage, runtimeSendMessageMock } from '../setup';
import { renderDocument } from '../../src/core/markdown-renderer';

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

describe('B 站视觉来源块', () => {
  it('有章节时按章节聚合字幕并保留起始时间', () => {
    const result = buildBilibiliSourceBlocks({
      description: '视频简介',
      chapters: [
        { title: '开场', from: 0, to: 10 },
        { title: '正题', from: 10, to: 30 },
      ],
      body: [
        { from: 1, to: 2, content: '开场白' },
        { from: 12, to: 14, content: '正题内容' },
      ],
    });
    expect(result.map((entry) => entry.block.text)).toEqual(['开场 开场白', '正题 正题内容']);
    expect(result.map((entry) => entry.start)).toEqual([0, 10]);
  });

  it('无章节时按 60 秒窗口聚合字幕', () => {
    const result = buildBilibiliSourceBlocks({
      description: '',
      chapters: [],
      body: [
        { from: 1, to: 2, content: '第一句' },
        { from: 59, to: 60, content: '同窗口' },
        { from: 61, to: 62, content: '下一窗口' },
      ],
    });
    expect(result.map((entry) => entry.block.text)).toEqual(['第一句 同窗口', '下一窗口']);
    expect(result.map((entry) => entry.start)).toEqual([1, 61]);
  });

  it('无字幕时使用简介作为唯一来源块', () => {
    const result = buildBilibiliSourceBlocks({ description: '暂无字幕的视频简介', chapters: [], body: [] });
    expect(result).toHaveLength(1);
    expect(result[0]!.block.text).toBe('暂无字幕的视频简介');
  });

  it('无字幕但有章节时保留简介与章节来源', () => {
    const result = buildBilibiliSourceBlocks({
      description: '视频简介',
      chapters: [{ title: '章节一', from: 0, to: 10 }],
      body: [],
    });
    expect(result.map((entry) => entry.block.text)).toEqual(['视频简介', '章节一']);
  });
});

describe('B 站时间定位', () => {
  it('根据已分析的来源块 seek 播放器且不自动播放暂停视频', async () => {
    const url = new URL('https://www.bilibili.com/video/BV1xx411c7mD/');
    const entries = buildBilibiliSourceBlocks({
      description: '',
      chapters: [{ title: '开场', from: 12, to: 30 }],
      body: [{ from: 13, to: 15, content: '开场白' }],
    });
    rememberBilibiliSource(url, entries);
    expect(mockSessionStorage['clip2md.visualSummary.timeline.BV1xx411c7mD:p1']).toEqual(entries);
    document.body.innerHTML = '<video></video>';
    const video = document.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'readyState', { configurable: true, value: 1 });
    Object.defineProperty(video, 'paused', { configurable: true, value: true });
    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 0 });
    video.play = vi.fn();
    const response = await navigateBilibiliSource(document, url, {
      expectedSourceUrl: url.href,
      sourceBlockId: 'B001',
      sourceQuote: '开场白',
    });
    expect(response).toEqual({ success: true });
    expect(video.currentTime).toBe(12);
    expect(video.play).not.toHaveBeenCalled();
  });

  it('BV 或分 P 变化时拒绝定位', async () => {
    const url = new URL('https://www.bilibili.com/video/BV1xx411c7mD/');
    expect(await navigateBilibiliSource(document, url, {
      expectedSourceUrl: 'https://www.bilibili.com/video/BV2yy411c7mD/?p=2',
      sourceBlockId: 'B001',
      sourceQuote: '开场白',
    })).toMatchObject({ success: false, error: { code: 'SOURCE_CHANGED' } });
  });

  it('简介来源块不伪装成可跳转时间点', async () => {
    const url = new URL('https://www.bilibili.com/video/BV1xx411c7mD/');
    const entries = buildBilibiliSourceBlocks({ description: '视频简介', chapters: [], body: [] });
    rememberBilibiliSource(url, entries);
    document.body.innerHTML = '<video></video>';
    const response = await navigateBilibiliSource(document, url, {
      expectedSourceUrl: url.href,
      sourceBlockId: 'B001',
      sourceQuote: '视频简介',
    });
    expect(response).toMatchObject({ success: false, error: { code: 'TARGET_NOT_FOUND' } });
  });
});

describe('B 站无字幕降级', () => {
  it('API 返回无字幕时保留元数据/章节并输出暂无字幕', async () => {
    runtimeSendMessageMock.mockImplementation((message: { url: string }, callback: (response: unknown) => void) => {
      if (message.url.includes('/x/web-interface/view')) {
        callback({ success: true, data: {
          code: 0,
          data: {
            aid: 10,
            title: '无字幕视频',
            desc: '视频简介',
            pubdate: 0,
            cid: 20,
            duration: 60,
            owner: { name: 'UP 主' },
            pages: [{ cid: 20, page: 1, part: '', duration: 60 }],
          },
        } });
        return;
      }
      if (message.url.includes('/x/web-interface/nav')) {
        callback({ success: true, data: {
          code: 0,
          data: {
            isLogin: true,
            img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
            sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png',
          },
        } });
        return;
      }
      callback({ success: true, data: { code: 0, data: { subtitle: { subtitles: [] }, view_points: [{ content: '开场', from: 0, to: 20 }] } } });
    });
    const result = await bilibiliAdapter.extractVisualSource!(document, new URL('https://www.bilibili.com/video/BV1xx411c7mD/'));
    expect(result.sourceBlocks.map((b) => b.text)).toEqual(['视频简介', '开场']);
    expect(renderDocument(result.document)).toContain('（暂无字幕）');
  });
});

describe('B 站字幕请求凭据', () => {
  it('字幕 CDN 使用 omit，view/player API 保持默认 include', async () => {
    const messages: Array<{ type: string; url: string; credentials?: string }> = [];
    runtimeSendMessageMock.mockImplementation((message: { type: string; url: string; credentials?: string }, callback: (response: unknown) => void) => {
      messages.push(message);
      if (message.url.includes('/x/web-interface/view')) {
        callback({ success: true, data: {
          code: 0,
          data: {
            aid: 10,
            title: '有字幕视频',
            desc: '视频简介',
            pubdate: 0,
            cid: 20,
            duration: 60,
            owner: { name: 'UP 主' },
            pages: [{ cid: 20, page: 1, part: '', duration: 60 }],
          },
        } });
        return;
      }
      if (message.url.includes('/x/web-interface/nav')) {
        callback({ success: true, data: {
          code: 0,
          data: {
            isLogin: true,
            img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
            sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png',
          },
        } });
        return;
      }
      if (message.url.includes('/x/player/wbi/v2')) {
        callback({ success: true, data: {
          code: 0,
          data: {
            subtitle: {
              subtitles: [{
                id: 1,
                lan: 'zh-CN',
                lan_doc: '中文',
                subtitle_url: 'https://aisubtitle.hdslb.com/a.json',
              }],
            },
            view_points: [],
          },
        } });
        return;
      }
      callback({ success: true, data: { body: [{ from: 0, to: 2, content: '字幕正文' }] } });
    });

    await bilibiliAdapter.extractVisualSource!(document, new URL('https://www.bilibili.com/video/BV1xx411c7mD/'));

    expect(messages.filter((message) => message.url.includes('api.bilibili.com'))
      .every((message) => message.credentials === undefined)).toBe(true);
    expect(messages.find((message) => message.url.includes('aisubtitle.hdslb.com')))
      .toMatchObject({ credentials: 'omit' });
  });
});
