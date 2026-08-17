/** Background 与 Obsidian Core client 的适配层。 */

import { createObsidianClient } from '../core/obsidian-client';
import { loadSettings, sanitizeSubfolder, type ClipSettings } from '../core/settings';

interface ObsidianWriteArgs {
  markdown: string;
  filename: string;
  /** true 时跳过「已存在」拦截直接覆盖 */
  overwrite?: boolean;
}

/** 保存笔记到 Obsidian，返回 vault 相对路径。 */
export async function saveToObsidian(args: ObsidianWriteArgs, existingSettings?: ClipSettings): Promise<string> {
  const settings = existingSettings ?? await loadSettings();
  const folder = sanitizeSubfolder(settings.obsidian.noteDirectory);
  const filepath = folder ? `${folder}/${args.filename}` : args.filename;
  const client = createObsidianClient(settings.obsidian);

  await client.writeNote({
    path: filepath,
    markdown: args.markdown,
    overwrite: args.overwrite,
  });
  return filepath;
}

/** 测试 Obsidian 连接并返回服务名称。 */
export async function testObsidian(): Promise<string> {
  const settings = await loadSettings();
  const client = createObsidianClient(settings.obsidian);
  const result = await client.testConnection();
  return result.service;
}
