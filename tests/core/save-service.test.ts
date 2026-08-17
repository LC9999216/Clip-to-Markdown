import { describe, expect, it } from 'vitest';
import { prepareSave } from '../../src/core/save-service';
import { mockStoredSettings } from '../setup';
import type { ContentDocument } from '../../src/core/schema';

const document: ContentDocument = {
  version: 1,
  metadata: {
    platform: 'zhihu',
    contentType: 'zhihu-article',
    sourceUrl: 'https://www.zhihu.com/question/1',
    author: { name: '作者' },
    published: '',
    title: '测试标题',
    id: '1',
  },
  body: {
    type: 'article',
    children: [{ type: 'paragraph', children: [{ type: 'text', value: '正文' }] }],
  },
};

describe('save service', () => {
  it('一次加载设置并共享 Markdown、filename 和 target settings', async () => {
    mockStoredSettings['clip2md.settings'] = {
      settingsVersion: 2,
      save: { subfolder: 'Notes', saveAs: false },
      filename: { template: '{date}-{platform}-{title}' },
      obsidian: {
        enabled: true,
        apiUrl: 'http://127.0.0.1:27123',
        apiKey: 'key',
        noteDirectory: 'Clippings/Inbox',
        frontmatter: {
          sourceUrl: true,
          author: true,
          published: true,
          platform: true,
          clippedAt: true,
          tags: false,
        },
      },
    };

    const prepared = await prepareSave(document, new Date(2026, 7, 17, 12, 0, 0));

    expect(prepared.filename).toBe('2026-08-17-知乎-测试标题.md');
    expect(prepared.markdown).toContain('正文');
    expect(prepared.settings.save.subfolder).toBe('Notes');
    expect(prepared.settings.obsidian.noteDirectory).toBe('Clippings/Inbox');
  });
});
