import { md5 } from '@noble/hashes/legacy.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

export interface WbiKeys {
  imgKey: string;
  subKey: string;
}

export function extractWbiKeys(nav: { img_url?: string; sub_url?: string }): WbiKeys {
  const extract = (url: string | undefined): string | undefined => {
    if (!url) return undefined;
    const filename = url.split(/[/?#]/).pop();
    return filename?.replace(/\.[^.]+$/, '');
  };

  const imgKey = extract(nav.img_url);
  const subKey = extract(nav.sub_url);
  if (!imgKey || !subKey) throw new Error('无法取得 WBI 密钥');
  return { imgKey, subKey };
}

export function signWbiParams(
  params: Record<string, string | number>,
  keys: WbiKeys,
  wts = Math.floor(Date.now() / 1000),
): string {
  const mixinKey = MIXIN_KEY_ENC_TAB.map((index) => `${keys.imgKey}${keys.subKey}`[index]).join('').slice(0, 32);
  const signedParams: Record<string, string | number> = { ...params, wts };
  const query = Object.keys(signedParams)
    .sort()
    .map((key) => {
      const value = String(signedParams[key]).replace(/[!'()*]/g, '');
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    })
    .join('&');
  const wRid = bytesToHex(md5(utf8ToBytes(query + mixinKey)));
  return `${query}&w_rid=${wRid}`;
}
