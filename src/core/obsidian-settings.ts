/** Obsidian Local REST API 的设置模型与默认值。 */

export interface ObsidianFrontmatterSettings {
  sourceUrl: boolean;
  author: boolean;
  published: boolean;
  platform: boolean;
  clippedAt: boolean;
  tags: boolean;
}

export interface ObsidianSettings {
  enabled: boolean;
  apiUrl: string;
  apiKey: string;
  noteDirectory: string;
  frontmatter: ObsidianFrontmatterSettings;
}

export const DEFAULT_OBSIDIAN_SETTINGS: ObsidianSettings = {
  enabled: false,
  apiUrl: 'http://127.0.0.1:27123',
  apiKey: '',
  noteDirectory: 'Clippings/Inbox',
  frontmatter: {
    sourceUrl: true,
    author: true,
    published: true,
    platform: true,
    clippedAt: true,
    tags: false,
  },
};
