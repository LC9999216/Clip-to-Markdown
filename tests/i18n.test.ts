import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const manifestPath = resolve(root, 'src/manifest.json');
const manifestText = readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(manifestText) as {
  manifest_version: number;
  name: string;
  version: string;
  description: string;
  default_locale?: string;
  commands: {
    'save-clip': { description: string };
    'save-to-obsidian': { description: string };
  };
};

const expectedMessages = {
  zh_CN: {
    extensionName: 'Clip to Markdown',
    extensionDescription:
      '一键将 X、知乎、小黑盒、B站和 ChatGPT 内容保存为干净 Markdown，并支持发送到 Obsidian',
    saveClipCommandDescription: '保存当前帖子、文章、视频字幕或对话为 Markdown',
    saveToObsidianCommandDescription: '保存当前内容到 Obsidian',
  },
  en: {
    extensionName: 'Clip to Markdown',
    extensionDescription:
      'Save content from X, Zhihu, Xiaoheihe, Bilibili and ChatGPT as clean Markdown, with optional Obsidian integration.',
    saveClipCommandDescription:
      'Save the current post, article, video transcript, or conversation as Markdown',
    saveToObsidianCommandDescription: 'Save the current content to Obsidian',
  },
} as const;

describe('Manifest V3 国际化', () => {
  it('使用简体中文默认语言和消息占位符，同时保持版本与命令名称', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.version).toBe('0.2.0');
    expect(manifest.default_locale).toBe('zh_CN');
    expect(manifest.name).toBe('__MSG_extensionName__');
    expect(manifest.description).toBe('__MSG_extensionDescription__');
    expect(Object.keys(manifest.commands)).toEqual(['save-clip', 'save-to-obsidian']);
    expect(manifest.commands['save-clip'].description).toBe(
      '__MSG_saveClipCommandDescription__',
    );
    expect(manifest.commands['save-to-obsidian'].description).toBe(
      '__MSG_saveToObsidianCommandDescription__',
    );
  });

  it.each(Object.entries(expectedMessages))('%s 定义 Manifest 引用的全部消息', (locale, expected) => {
    const messages = JSON.parse(
      readFileSync(resolve(root, 'src/_locales/' + locale + '/messages.json'), 'utf8'),
    ) as Record<string, { message: string }>;
    const referencedKeys = [
      ...new Set(
        [...manifestText.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)].map((match) => match[1]),
      ),
    ];

    expect(referencedKeys.sort()).toEqual(Object.keys(expected).sort());
    for (const [key, message] of Object.entries(expected)) {
      expect(messages[key]?.message).toBe(message);
    }
  });

  it('构建脚本会递归复制完整的 _locales 目录', () => {
    const buildScript = readFileSync(resolve(root, 'build.mjs'), 'utf8');

    expect(buildScript).toContain(
      "copyDir(join(root, 'src/_locales'), join(dist, '_locales'));",
    );
  });
});
