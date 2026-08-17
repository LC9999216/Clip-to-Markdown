import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FILENAME_TEMPLATE,
  DEFAULT_OBSIDIAN_SETTINGS,
  DEFAULT_SETTINGS,
  loadSettings,
  migrateSettings,
  resolveDownloadPath,
  saveSettings,
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
    const r = resolveDownloadPath('tweet.md', { ...DEFAULT_SETTINGS.save, saveAs: true });
    expect(r).toEqual({ filename: 'tweet.md', saveAs: true });
  });

  it('非空子目录：前缀拼装', () => {
    const r = resolveDownloadPath('tweet.md', { ...DEFAULT_SETTINGS.save, subfolder: 'Clip2MD/知乎', saveAs: false });
    expect(r).toEqual({ filename: 'Clip2MD/知乎/tweet.md', saveAs: false });
  });

  it('子目录被清洗后再拼装', () => {
    const r = resolveDownloadPath('tweet.md', { ...DEFAULT_SETTINGS.save, subfolder: '../../Clip2MD', saveAs: false });
    expect(r.filename).toBe('Clip2MD/tweet.md');
  });
});

describe('Settings V2', () => {
  it('默认设置包含版本、文件名模板和 Obsidian 默认值', () => {
    expect(DEFAULT_SETTINGS.settingsVersion).toBe(2);
    expect(DEFAULT_SETTINGS.filename.template).toBe(DEFAULT_FILENAME_TEMPLATE);
    expect(DEFAULT_SETTINGS.obsidian).toEqual(DEFAULT_OBSIDIAN_SETTINGS);
  });

  it('把 V0.1 扁平设置迁移为 V2，并保留现有 Obsidian 配置', () => {
    expect(migrateSettings({
      subfolder: 'Clip2MD/知乎',
      saveAs: true,
      obsidianApiBaseUrl: 'http://localhost:27123/',
      obsidianApiKey: ' secret ',
      noteFolder: 'Clippings',
    })).toEqual({
      settingsVersion: 2,
      save: { subfolder: 'Clip2MD/知乎', saveAs: true },
      filename: { template: DEFAULT_FILENAME_TEMPLATE },
      obsidian: {
        ...DEFAULT_OBSIDIAN_SETTINGS,
        apiUrl: 'http://localhost:27123',
        apiKey: 'secret',
        noteDirectory: 'Clippings',
      },
    });
  });

  it('V2 缺字段时补齐默认值', () => {
    const settings = migrateSettings({
      settingsVersion: 2,
      save: { saveAs: true },
      filename: {},
      obsidian: { apiKey: 'key' },
    });

    expect(settings.settingsVersion).toBe(2);
    expect(settings.save).toEqual({ subfolder: '', saveAs: true });
    expect(settings.filename).toEqual({ template: DEFAULT_FILENAME_TEMPLATE });
    expect(settings.obsidian.apiKey).toBe('key');
    expect(settings.obsidian.noteDirectory).toBe(DEFAULT_OBSIDIAN_SETTINGS.noteDirectory);
  });

  it('保存后可以读取完整的 V2 设置', async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      save: { subfolder: 'Notes', saveAs: true },
      filename: { template: '{platform}-{title}' },
      obsidian: {
        ...DEFAULT_OBSIDIAN_SETTINGS,
        apiKey: 'local-only-key',
        frontmatter: { ...DEFAULT_OBSIDIAN_SETTINGS.frontmatter, tags: true },
      },
    };

    await saveSettings(settings);
    await expect(loadSettings()).resolves.toEqual(settings);
  });
});
