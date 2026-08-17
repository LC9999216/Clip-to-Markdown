/**
 * 共享保存准备层：ContentDocument → Markdown + filename + settings。
 * 具体保存目标由调用方处理，避免普通下载与 Obsidian 复制内容处理逻辑。
 */

import { buildFilename } from './filename';
import { renderDocument } from './markdown-renderer';
import { InitialSetupRequiredError, isInitialSetupComplete } from './setup-state';
import { loadSettings, type ClipSettings } from './settings';
import type { ContentDocument } from './schema';

export type SaveTarget = 'default' | 'obsidian';

export interface PreparedSave {
  markdown: string;
  filename: string;
  settings: ClipSettings;
}

export async function prepareSave(
  document: ContentDocument,
  now = new Date(),
  target: SaveTarget = 'default',
): Promise<PreparedSave> {
  const settings = await loadSettings();
  if (target === 'default' && !(await isInitialSetupComplete())) {
    throw new InitialSetupRequiredError();
  }
  return {
    markdown: renderDocument(document),
    filename: buildFilename(document, {
      template: settings.filename.template,
      now,
    }),
    settings,
  };
}
