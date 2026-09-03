import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FILENAME_TEMPLATE,
  DEFAULT_OBSIDIAN_SETTINGS,
  DEFAULT_SETTINGS,
  SETTINGS_VERSION,
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

describe('Settings V5', () => {
  it('默认设置包含版本、文件名模板、Obsidian 与 AI 默认值', () => {
    expect(SETTINGS_VERSION).toBe(5);
    expect(DEFAULT_SETTINGS.settingsVersion).toBe(5);
    expect(DEFAULT_SETTINGS.filename.template).toBe(DEFAULT_FILENAME_TEMPLATE);
    expect(DEFAULT_SETTINGS.obsidian).toEqual(DEFAULT_OBSIDIAN_SETTINGS);
    expect(DEFAULT_SETTINGS.ai).toEqual(DEFAULT_AI_SETTINGS);
  });

  it('把 V0.1 扁平设置迁移为 V5，并保留现有 Obsidian 配置、补齐 AI 默认值', () => {
    expect(migrateSettings({
      subfolder: 'Clip2MD/知乎',
      saveAs: true,
      obsidianApiBaseUrl: 'http://localhost:27123/',
      obsidianApiKey: ' secret ',
      noteFolder: 'Clippings',
    })).toEqual({
      settingsVersion: 5,
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

  it('V2 迁移到 V5 时无损保留 save/filename/obsidian，只补 ai 默认值', () => {
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

    expect(migrated.settingsVersion).toBe(5);
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

    expect(settings.settingsVersion).toBe(5);
    expect(settings.save).toEqual({ subfolder: '', saveAs: true });
    expect(settings.filename).toEqual({ template: DEFAULT_FILENAME_TEMPLATE });
    expect(settings.obsidian.apiKey).toBe('key');
    expect(settings.ai).toEqual({
      enabled: true,
      endpoint: 'https://api.deepseek.com/chat/completions',
      apiKey: '',
      model: 'deepseek-v4-flash',
      outputLanguage: 'zh-CN',
      translateBilibiliSubtitles: false,
    });
  });

  it('V4 配置中缺失或纯空白的 AI endpoint 与 model 回填默认值', () => {
    const missing = migrateSettings({
      settingsVersion: 4,
      ai: {},
    });
    const blank = migrateSettings({
      settingsVersion: 4,
      ai: {
        endpoint: '   ',
        model: '\t',
      },
    });

    expect(missing.settingsVersion).toBe(5);
    expect(missing.ai.endpoint).toBe('https://api.deepseek.com/chat/completions');
    expect(missing.ai.model).toBe('deepseek-v4-flash');
    expect(blank.ai.endpoint).toBe('https://api.deepseek.com/chat/completions');
    expect(blank.ai.model).toBe('deepseek-v4-flash');
  });

  it('V5 配置中显式空白的 AI endpoint 保持为空', () => {
    const settings = migrateSettings({
      settingsVersion: 5,
      ai: {
        endpoint: '   ',
        model: '   ',
      },
    });

    expect(settings.ai.endpoint).toBe('');
    expect(settings.ai.model).toBe('deepseek-v4-flash');
  });

  it('V5 配置中缺失的 AI endpoint 仍回填默认值', () => {
    const settings = migrateSettings({
      settingsVersion: 5,
      ai: {},
    });

    expect(settings.ai.endpoint).toBe('https://api.deepseek.com/chat/completions');
  });

  it('合法非空自定义 AI endpoint 与 model 不被默认值覆盖', () => {
    const settings = migrateSettings({
      settingsVersion: 4,
      ai: {
        endpoint: '  https://api.openai.com/v1/chat/completions  ',
        model: '  gpt-5-mini  ',
      },
    });

    expect(settings.ai.endpoint).toBe('https://api.openai.com/v1/chat/completions');
    expect(settings.ai.model).toBe('gpt-5-mini');
  });

  it('迁移结果再次迁移保持不变', () => {
    const raw = {
      settingsVersion: 4,
      ai: {
        endpoint: 'http://example.com/chat/completions',
        model: 'deepseek-chat',
      },
    };

    const migrated = migrateSettings(raw);
    expect(migrateSettings(migrated)).toEqual(migrated);
  });

  it('全新用户继续获得完整默认设置', () => {
    expect(migrateSettings(undefined)).toEqual(DEFAULT_SETTINGS);
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

  it('非空非法 AI endpoint 保存并读取后仍保持为空', async () => {
    await saveSettings({
      ...DEFAULT_SETTINGS,
      ai: {
        ...DEFAULT_SETTINGS.ai,
        endpoint: 'http://example.com/chat/completions',
      },
    });

    expect((await loadSettings()).ai.endpoint).toBe('');
  });

  it('非空非法 AI endpoint 清空后，修改无关设置再保存仍保持为空', async () => {
    await saveSettings({
      ...DEFAULT_SETTINGS,
      ai: {
        ...DEFAULT_SETTINGS.ai,
        endpoint: 'http://example.com/chat/completions',
      },
    });
    const firstLoad = await loadSettings();

    await saveSettings({
      ...firstLoad,
      save: { ...firstLoad.save, saveAs: true },
    });

    const secondLoad = await loadSettings();
    expect(secondLoad.save.saveAs).toBe(true);
    expect(secondLoad.ai.endpoint).toBe('');
  });

  it('保存后可以读取完整的 V5 设置（含 AI 字段）', async () => {
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

  it('V3 迁移到 V5 时字幕翻译默认关闭且其他 AI 字段无损', () => {
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

    expect(migrated.settingsVersion).toBe(5);
    expect(migrated.ai).toMatchObject({
      enabled: true,
      endpoint: 'https://api.deepseek.com/chat/completions',
      apiKey: 'sk-test',
      model: 'deepseek-chat',
      outputLanguage: 'zh-CN',
      translateBilibiliSubtitles: false,
    });
  });

  it('V5 保存并读取字幕翻译开关', async () => {
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
