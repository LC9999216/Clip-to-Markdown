import { describe, expect, it } from 'vitest';
import {
  fetchBilibiliSubtitleResource,
} from '../../src/adapters/bilibili/subtitle-service';
import { BiliSubtitleError } from '../../src/adapters/bilibili/subtitle-types';

const videoUrl = new URL('https://www.bilibili.com/video/BV1xx411c7mD/?p=2');

function makeView() {
  return {
    code: 0,
    data: {
      aid: 123,
      title: '测试视频',
      desc: '视频简介',
      pubdate: 1700000000,
      owner: { name: '测试 UP' },
      cid: 111,
      pages: [
        { cid: 111, page: 1, part: '第一 P', duration: 30 },
        { cid: 456, page: 2, part: '第二 P', duration: 60 },
      ],
    },
  };
}

function makeNav(isLogin = true) {
  return {
    code: 0,
    data: {
      isLogin,
      img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
      sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png',
    },
  };
}

const tracks = [
  {
    id: 4,
    id_str: 'other-ai',
    lan: 'ja-JP',
    lan_doc: '日本語',
    ai_type: '1',
    ai_status: '1',
    subtitle_url: 'https://subtitle.hdslb.com/other-ai.json',
  },
  {
    id: 3,
    id_str: 'other-human',
    lan: 'en-US',
    lan_doc: 'English',
    ai_type: 0,
    ai_status: 0,
    subtitle_url: 'https://subtitle.hdslb.com/other-human.json',
  },
  {
    id: 2,
    id_str: 'ai-zh',
    lan: 'zh-CN',
    lan_doc: '中文（AI）',
    ai_type: 1,
    ai_status: 1,
    subtitle_url: 'https://subtitle.hdslb.com/ai-zh.json',
  },
  {
    id: 1,
    id_str: 'human-zh',
    lan: 'ZH_cn',
    lan_doc: '中文',
    ai_type: '0',
    ai_status: '0',
    subtitle_url: 'https://subtitle.hdslb.com/human-zh.json',
  },
];

function makePlayer() {
  return {
    code: 0,
    data: {
      subtitle: { subtitles: tracks },
      view_points: [
        { content: '开场', from: 0, to: 12 },
        { content: '正文', from: 12, to: 30 },
      ],
    },
  };
}

function makeRequestJson(options: {
  nav?: unknown;
  player?: unknown;
  cdnBody?: unknown;
  requests?: Array<{ url: string; credentials?: 'include' | 'omit' }>;
}) {
  return async (requestUrl: string, credentials?: 'include' | 'omit'): Promise<unknown> => {
    options.requests?.push({ url: requestUrl, credentials });
    if (requestUrl.includes('/x/web-interface/view')) return makeView();
    if (requestUrl.includes('/x/web-interface/nav')) return options.nav ?? makeNav();
    if (requestUrl.includes('/x/player/wbi/v2')) return options.player ?? makePlayer();
    return options.cdnBody ?? { body: [{ from: 0, to: 2, content: '字幕正文' }] };
  };
}

describe('B站官方字幕服务', () => {
  it('按 view → nav → 签名 player → CDN 完成请求并选择优先轨道', async () => {
    const requests: Array<{ url: string; credentials?: 'include' | 'omit' }> = [];
    const resource = await fetchBilibiliSubtitleResource({
      url: videoUrl,
      requestJson: makeRequestJson({ requests }),
      nowSeconds: 1702204169,
    });

    expect(requests.map((request) => request.url)).toHaveLength(4);
    expect(requests[0]!.url).toContain('/x/web-interface/view?bvid=BV1xx411c7mD');
    expect(requests[1]!.url).toContain('/x/web-interface/nav');
    const playerUrl = new URL(requests[2]!.url);
    expect(playerUrl.pathname).toBe('/x/player/wbi/v2');
    expect(playerUrl.searchParams.get('wts')).toBe('1702204169');
    expect(playerUrl.searchParams.get('w_rid')).toMatch(/^[0-9a-f]{32}$/);
    expect(requests.slice(0, 3).every((request) => request.credentials === undefined)).toBe(true);
    expect(requests[3]).toMatchObject({
      url: 'https://subtitle.hdslb.com/human-zh.json',
      credentials: 'omit',
    });

    expect(resource.identity).toEqual({ bvid: 'BV1xx411c7mD', pageIndex: 2, cid: 456 });
    expect(resource.title).toBe('测试视频');
    expect(resource.author).toBe('测试 UP');
    expect(resource.part).toBe('第二 P');
    expect(resource.description).toBe('视频简介');
    expect(resource.publishedAt).toBe(1700000000);
    expect(resource.tracks.map((track) => track.id)).toEqual(['human-zh', 'ai-zh', 'other-human', 'other-ai']);
    expect(resource.tracks.map((track) => track.isAi)).toEqual([false, true, false, true]);
    expect(resource.selectedTrackId).toBe('human-zh');
    expect(resource.lines).toEqual([{ from: 0, to: 2, content: '字幕正文' }]);
    expect(resource.chapters).toEqual([
      { title: '开场', from: 0, to: 12 },
      { title: '正文', from: 12, to: 30 },
    ]);
  });

  it('有效 preferredTrackId 覆盖自动优先级', async () => {
    const requests: Array<{ url: string; credentials?: 'include' | 'omit' }> = [];
    const resource = await fetchBilibiliSubtitleResource({
      url: videoUrl,
      requestJson: makeRequestJson({ requests, cdnBody: { body: [{ from: 1, to: 2, content: 'AI 字幕' }] } }),
      preferredTrackId: 'ai-zh',
    });

    expect(resource.selectedTrackId).toBe('ai-zh');
    expect(requests.at(-1)!.url).toBe('https://subtitle.hdslb.com/ai-zh.json');
    expect(resource.lines[0]!.content).toBe('AI 字幕');
  });

  it('空轨道根据登录状态抛出 NEED_LOGIN 或 NO_SUBTITLE', async () => {
    for (const [isLogin, code] of [[false, 'NEED_LOGIN'], [true, 'NO_SUBTITLE']] as const) {
      const requestJson = makeRequestJson({
        nav: makeNav(isLogin),
        player: { code: 0, data: { subtitle: { subtitles: [] }, view_points: [] } },
      });
      await expect(fetchBilibiliSubtitleResource({ url: videoUrl, requestJson }))
        .rejects.toMatchObject({ code });
    }
  });

  it('allowEmpty 允许无轨道时返回完整元数据', async () => {
    const resource = await fetchBilibiliSubtitleResource({
      url: videoUrl,
      requestJson: makeRequestJson({
        nav: makeNav(false),
        player: { code: 0, data: { subtitle: { subtitles: [] }, view_points: [{ content: '开场', from: 0, to: 1 }] } },
      }),
      allowEmpty: true,
    });

    expect(resource).toMatchObject({
      identity: { bvid: 'BV1xx411c7mD', pageIndex: 2, cid: 456 },
      title: '测试视频',
      description: '视频简介',
      tracks: [],
      selectedTrackId: null,
      lines: [],
      chapters: [{ title: '开场', from: 0, to: 1 }],
    });
  });

  it('空字幕正文抛出 EMPTY_TRANSCRIPT', async () => {
    await expect(fetchBilibiliSubtitleResource({
      url: videoUrl,
      requestJson: makeRequestJson({ cdnBody: { body: [] } }),
    })).rejects.toMatchObject({ code: 'EMPTY_TRANSCRIPT' });
  });

  it('API -412、网络异常和格式错误统一抛出 FETCH_FAILED', async () => {
    for (const requestJson of [
      makeRequestJson({ player: { code: -412, message: '风控' } }),
      async () => { throw new Error('network down'); },
      makeRequestJson({ player: { code: 0, data: { subtitle: {} } } }),
    ]) {
      await expect(fetchBilibiliSubtitleResource({ url: videoUrl, requestJson }))
        .rejects.toMatchObject({ code: 'FETCH_FAILED' });
    }
  });

  it('仅接受 HTTPS 且主机属于 hdslb.com 的字幕 URL', async () => {
    const player = {
      code: 0,
      data: {
        subtitle: {
          subtitles: [
            { id: 1, lan: 'zh-CN', lan_doc: '中文', ai_type: 0, subtitle_url: 'http://subtitle.hdslb.com/http.json' },
            { id: 2, lan: 'zh-CN', lan_doc: '中文', ai_type: 0, subtitle_url: 'https://evil.example/subtitle.json' },
            { id: 3, lan: 'zh-CN', lan_doc: '中文', ai_type: 0, subtitle_url: 'https://subtitle.hdslb.com/good.json' },
          ],
        },
        view_points: [],
      },
    };
    const requests: Array<{ url: string; credentials?: 'include' | 'omit' }> = [];
    const resource = await fetchBilibiliSubtitleResource({
      url: videoUrl,
      requestJson: makeRequestJson({ requests, player }),
    });

    expect(resource.tracks).toHaveLength(1);
    expect(resource.tracks[0]!.url).toBe('https://subtitle.hdslb.com/good.json');
    expect(requests.at(-1)!.url).toBe('https://subtitle.hdslb.com/good.json');
  });

  it('错误类型保持公开的 BiliSubtitleError 类型', async () => {
    const requestJson = makeRequestJson({
      nav: makeNav(false),
      player: { code: 0, data: { subtitle: { subtitles: [] }, view_points: [] } },
    });
    await expect(fetchBilibiliSubtitleResource({ url: videoUrl, requestJson }))
      .rejects.toBeInstanceOf(BiliSubtitleError);
  });
});
