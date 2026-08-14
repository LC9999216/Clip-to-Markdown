import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SETTINGS,
  resolveDownloadPath,
  sanitizeSubfolder,
} from '../../src/core/settings';

describe('sanitizeSubfolder', () => {
  it('空串 / 纯空白 → 空串', () => {
    expect(sanitizeSubfolder('')).toBe('');
    expect(sanitizeSubfolder('   ')).toBe('');
  });

  it('正常子目录：按 / 与 \\ 分段后用 / 归一', () => {
    expect(sanitizeSubfolder('Clip2MD/知乎')).toBe('Clip2MD/知乎');
    expect(sanitizeSubfolder('Clip2MD\\知乎')).toBe('Clip2MD/知乎');
  });

  it('去掉路径穿越与点段', () => {
    expect(sanitizeSubfolder('../../etc')).toBe('etc');
    expect(sanitizeSubfolder('./a/../b')).toBe('a/b');
    expect(sanitizeSubfolder('a/.../b')).toBe('a/b');
  });

  it('去掉绝对路径前导斜杠与盘符段', () => {
    expect(sanitizeSubfolder('/foo')).toBe('foo');
    expect(sanitizeSubfolder('C:\\foo')).toBe('foo');
    expect(sanitizeSubfolder('c:/bar')).toBe('bar');
  });

  it('去掉非法字符', () => {
    expect(sanitizeSubfolder('a<b>:c')).toBe('abc');
    expect(sanitizeSubfolder('a|b?c*d')).toBe('abcd');
  });

  it('保留名段被规避', () => {
    expect(sanitizeSubfolder('CON')).toBe('_CON');
  });
});

describe('resolveDownloadPath', () => {
  it('空子目录：文件名不变、saveAs 透传', () => {
    const r = resolveDownloadPath('tweet.md', { ...DEFAULT_SETTINGS, saveAs: true });
    expect(r).toEqual({ filename: 'tweet.md', saveAs: true });
  });

  it('非空子目录：前缀拼装', () => {
    const r = resolveDownloadPath('tweet.md', { subfolder: 'Clip2MD/知乎', saveAs: false });
    expect(r).toEqual({ filename: 'Clip2MD/知乎/tweet.md', saveAs: false });
  });

  it('子目录被清洗后再拼装', () => {
    const r = resolveDownloadPath('tweet.md', { subfolder: '../../Clip2MD', saveAs: false });
    expect(r.filename).toBe('Clip2MD/tweet.md');
  });
});
