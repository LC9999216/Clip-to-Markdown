import { describe, expect, it } from 'vitest';
import { extractWbiKeys, signWbiParams } from '../../src/adapters/bilibili/wbi';

describe('B站 WBI 签名', () => {
  it('从 nav 图片 URL 提取密钥', () => {
    expect(extractWbiKeys({
      img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
      sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png',
    })).toEqual({
      imgKey: '7cd084941338484aae1ad9425b84077c',
      subKey: '4932caff0ff746eab6f01bf08b70ac45',
    });
  });

  it('匹配公开 WBI 签名向量', () => {
    expect(signWbiParams(
      { foo: '114', bar: '514', zab: 1919810 },
      {
        imgKey: '7cd084941338484aae1ad9425b84077c',
        subKey: '4932caff0ff746eab6f01bf08b70ac45',
      },
      1702204169,
    )).toBe('bar=514&foo=114&wts=1702204169&zab=1919810&w_rid=8f6f2b5b3d485fe1886cec6a0be8c5d4');
  });
});
