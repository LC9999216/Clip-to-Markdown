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
import { DEFAULT_AI_SETTINGS } from '../../src/core/ai-settings';

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

describe('Settings V4', () => {
  it('默认设置包含版本、文件名模板、Obsidian 与 AI 默认值', () => {
    expect(DEFAULT_SETTINGS.settingsVersion).toBe(4);
    expect(DEFAULT_SETTINGS.filename.template).toBe(DEFAULT_FILENAME_TEMPLATE);
    expect(DEFAULT_SETTINGS.obsidian).toEqual(DEFAULT_OBSIDIAN_SETTINGS);
    expect(DEFAULT_SETTINGS.ai).toEqual(DEFAULT_AI_SETTINGS);
  });

  it('把 V0.1 扁平设置迁移为 V3，并保留现有 Obsidian 配置、补齐 AI 默认值', () => {
    expect(migrateSettings({
      subfolder: 'Clip2MD/知乎',
      saveAs: true,
      obsidianApiBaseUrl: 'http://localhost:27123/',
      obsidianApiKey: ' secret ',
      noteFolder: 'Clippings',
    })).toEqual({
      settingsVersion: 4,
      save: { subfolder: 'Clip2MD/知乎', saveAs: true },
      filename: { template: DEFAULT_FILENAME_TEMPLATE },
      obsidian: {
        ...DEFAULT_OBSIDIAN_SETTINGS,
        apiUrl: 'http://localhost:27123',
        apiKey: 'secret',
        noteDirectory: 'Clippings',
      },
      ai: DEFAULT_AI_SETTINGS,
    });
  });

  it('V2 迁移到 V4 时无损保留 save/filename/obsidian，只补 ai 默认值', () => {
    const v2 = {
      settingsVersion: 2,
      save: { subfolder: 'Clippings/知乎', saveAs: true },
      filename: { template: '{platform}-{title}' },
      obsidian: {
        ...DEFAULT_OBSIDIAN_SETTINGS,
        apiUrl: 'http://127.0.0.1:27123',
        apiKey: 'key',
        noteDirectory: 'Notes',
        frontmatter: { ...DEFAULT_OBSIDIAN_SETTINGS.frontmatter, tags: true },
      },
    };
    const migrated = migrateSettings(v2);

    expect(migrated.settingsVersion).toBe(4);
    expect(migrated.save).toEqual(v2.save);
    expect(migrated.filename).toEqual(v2.filename);
    expect(migrated.obsidian).toEqual(v2.obsidian);
    expect(migrated.ai).toEqual(DEFAULT_AI_SETTINGS);
  });

  it('V3 缺字段时补齐默认值', () => {
    const settings = migrateSettings({
      settingsVersion: 3,
      save: { saveAs: true },
      filename: {},
      obsidian: { apiKey: 'key' },
      ai: { enabled: true },
    });

    expect(settings.settingsVersion).toBe(4);
    expect(settings.save).toEqual({ subfolder: '', saveAs: true });
    expect(settings.filename).toEqual({ template: DEFAULT_FILENAME_TEMPLATE });
    expect(settings.obsidian.apiKey).toBe('key');
    expect(settings.ai).toEqual({
      enabled: true,
      endpoint: '',
      apiKey: '',
      model: '',
      outputLanguage: 'zh-CN',
      translateBilibiliSubtitles: false,
    });
  });

  it('AI 字段在迁移时被规范化：endpoint 非法则清空、apiKey 去空白', () => {
    const settings = migrateSettings({
      settingsVersion: 3,
      ai: {
        enabled: true,
        endpoint: 'http://example.com/chat/completions',
        apiKey: '  secret  ',
        model: 'deepseek-chat',
        outputLanguage: 'zh-CN',
      },
    });

    expect(settings.ai).toEqual({
      enabled: true,
      endpoint: '',
      apiKey: 'secret',
      model: 'deepseek-chat',
      outputLanguage: 'zh-CN',
      translateBilibiliSubtitles: false,
    });
  });

  it('保存后可以读取完整的 V3 设置（含 AI 字段）', async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      save: { subfolder: 'Notes', saveAs: true },
      filename: { template: '{platform}-{title}' },
      obsidian: {
        ...DEFAULT_OBSIDIAN_SETTINGS,
        apiKey: 'local-only-key',
        frontmatter: { ...DEFAULT_OBSIDIAN_SETTINGS.frontmatter, tags: true },
      },
      ai: {
        enabled: true,
        endpoint: 'https://api.deepseek.com/chat/completions',
        apiKey: 'ai-key',
        model: 'deepseek-chat',
        outputLanguage: 'zh-CN' as const,
        translateBilibiliSubtitles: false,
      },
    };

    await saveSettings(settings);
    await expect(loadSettings()).resolves.toEqual(settings);
  });

  it('V3 迁移到 V4 时字幕翻译默认关闭且其他 AI 字段无损', () => {
    const migrated = migrateSettings({
      settingsVersion: 3,
      ai: {
        enabled: true,
        endpoint: 'https://api.deepseek.com/chat/completions',
        apiKey: 'sk-test',
        model: 'deepseek-chat',
        outputLanguage: 'zh-CN',
      },
    });

    expect(migrated.settingsVersion).toBe(4);
    expect(migrated.ai).toMatchObject({
      enabled: true,
      endpoint: 'https://api.deepseek.com/chat/completions',
      apiKey: 'sk-test',
      model: 'deepseek-chat',
      outputLanguage: 'zh-CN',
      translateBilibiliSubtitles: false,
    });
  });

  it('V4 保存并读取字幕翻译开关', async () => {
    await saveSettings({
      ...DEFAULT_SETTINGS,
      ai: { ...DEFAULT_SETTINGS.ai, translateBilibiliSubtitles: true },
    });
    expect((await loadSettings()).ai.translateBilibiliSubtitles).toBe(true);
  });

  it('V4 规范化字幕翻译开关：非布尔值回退为 false', () => {
    const migrated = migrateSettings({
      settingsVersion: 4,
      ai: {
        enabled: true,
        endpoint: 'https://api.deepseek.com/chat/completions',
        apiKey: 'sk-test',
        model: 'deepseek-chat',
        outputLanguage: 'zh-CN',
        translateBilibiliSubtitles: 'true',
      },
    });

    expect(migrated.ai.translateBilibiliSubtitles).toBe(false);
  });
});
