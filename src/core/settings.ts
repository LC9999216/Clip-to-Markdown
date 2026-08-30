/**
 * 设置模块：保存位置（子目录 + 每次询问）的模型、清洗、路径拼装与持久化。
 *
 * 约束：Chrome 扩展无法把文件写到任意绝对路径。chrome.downloads.download 的
 * `filename` 只能表达「相对浏览器默认下载目录」的路径（可含子目录），
 * `saveAs: true` 则每次弹出「另存为」由用户当场选位置。
 *
 * 设计：
 * - sanitizeSubfolder / resolveDownloadPath 是纯函数（不依赖 chrome.*），便于单元测试；
 * - loadSettings / saveSettings 封装 chrome.storage.local 的读写。
 */

import { sanitizeFilenamePart } from './filename';
import {
  DEFAULT_OBSIDIAN_SETTINGS,
  type ObsidianFrontmatterSettings,
  type ObsidianSettings,
} from './obsidian-settings';
import {
  DEFAULT_AI_SETTINGS,
  normalizeAiEndpoint,
  type AiSettings,
} from './ai-settings';

export { DEFAULT_OBSIDIAN_SETTINGS } from './obsidian-settings';
export type { ObsidianFrontmatterSettings, ObsidianSettings } from './obsidian-settings';
export { DEFAULT_AI_SETTINGS } from './ai-settings';
export type { AiSettings } from './ai-settings';

export const SETTINGS_VERSION = 4 as const;
export const DEFAULT_FILENAME_TEMPLATE = '{date}-{title}';

export interface SaveSettings {
  /** 相对浏览器下载目录的子目录（用 / 分隔）；空串 = 直接存入下载目录 */
  subfolder: string;
  /** 每次下载弹出「另存为」对话框，由用户手动选位置 */
  saveAs: boolean;
}

export interface FilenameSettings {
  /** 全部保存目标共用的文件名模板；模板变量由 Phase 2 解析。 */
  template: string;
}

export interface ClipSettings {
  settingsVersion: typeof SETTINGS_VERSION;
  save: SaveSettings;
  filename: FilenameSettings;
  obsidian: ObsidianSettings;
  ai: AiSettings;
}

export const DEFAULT_SETTINGS: ClipSettings = {
  settingsVersion: SETTINGS_VERSION,
  save: {
    subfolder: '',
    saveAs: false,
  },
  filename: {
    template: DEFAULT_FILENAME_TEMPLATE,
  },
  obsidian: DEFAULT_OBSIDIAN_SETTINGS,
  ai: DEFAULT_AI_SETTINGS,
};

/**
 * 把用户输入的子目录清洗为合法、安全的相对路径（用 / 分隔）。
 * - 先去掉前导 Windows 盘符前缀（C:\ / d:/）；
 * - 按 / 与 \ 分段；去掉非法字符、空段、`.`、`..`、纯点段；
 * - 每段复用 sanitizeFilenamePart 做保留名规避与限长；
 * - 返回 '' 表示无子目录。
 */
export function sanitizeSubfolder(raw: string): string {
  if (!raw) return '';
  const noDrive = raw.replace(/^[a-zA-Z]:[\\/]+/, '');
  const segments = noDrive
    .replace(/[<>:"|?*]/g, '')
    .split(/[\\/]+/)
    .map((p) => p.trim())
    .filter((p) => p !== '' && p !== '.' && p !== '..' && !/^\.+$/.test(p));

  const cleaned: string[] = [];
  for (const seg of segments) {
    const safe = sanitizeFilenamePart(seg);
    if (safe) cleaned.push(safe);
  }
  return cleaned.join('/');
}

/** 依据设置拼出最终下载 filename 与是否 saveAs。 */
export function resolveDownloadPath(
  filename: string,
  settings: SaveSettings,
): { filename: string; saveAs: boolean } {
  const sub = sanitizeSubfolder(settings.subfolder);
  return {
    filename: sub ? `${sub}/${filename}` : filename,
    saveAs: settings.saveAs === true,
  };
}

const STORAGE_KEY = 'clip2md.settings';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object';
}

function readString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string');
}

function cloneDefaultSettings(): ClipSettings {
  return {
    settingsVersion: SETTINGS_VERSION,
    save: { ...DEFAULT_SETTINGS.save },
    filename: { ...DEFAULT_SETTINGS.filename },
    obsidian: {
      ...DEFAULT_OBSIDIAN_SETTINGS,
      frontmatter: { ...DEFAULT_OBSIDIAN_SETTINGS.frontmatter },
    },
    ai: { ...DEFAULT_AI_SETTINGS },
  };
}

/** 规范化 AI 设置：Endpoint 非法则清空、apiKey 去空白、outputLanguage 固定。 */
function normalizeAiSettings(raw: unknown): AiSettings {
  const value = isRecord(raw) ? raw : {};
  return {
    enabled: typeof value.enabled === 'boolean'
      ? value.enabled
      : DEFAULT_AI_SETTINGS.enabled,
    endpoint: normalizeAiEndpoint(readString(value.endpoint) ?? '') ?? '',
    apiKey: readString(value.apiKey)?.trim() ?? '',
    model: readString(value.model)?.trim() ?? '',
    outputLanguage: DEFAULT_AI_SETTINGS.outputLanguage,
    translateBilibiliSubtitles: typeof value.translateBilibiliSubtitles === 'boolean'
      ? value.translateBilibiliSubtitles
      : false,
  };
}

function normalizeFrontmatter(raw: unknown): ObsidianFrontmatterSettings {
  const value = isRecord(raw) ? raw : {};
  return {
    sourceUrl: typeof value.sourceUrl === 'boolean'
      ? value.sourceUrl
      : DEFAULT_OBSIDIAN_SETTINGS.frontmatter.sourceUrl,
    author: typeof value.author === 'boolean'
      ? value.author
      : DEFAULT_OBSIDIAN_SETTINGS.frontmatter.author,
    published: typeof value.published === 'boolean'
      ? value.published
      : DEFAULT_OBSIDIAN_SETTINGS.frontmatter.published,
    platform: typeof value.platform === 'boolean'
      ? value.platform
      : DEFAULT_OBSIDIAN_SETTINGS.frontmatter.platform,
    clippedAt: typeof value.clippedAt === 'boolean'
      ? value.clippedAt
      : DEFAULT_OBSIDIAN_SETTINGS.frontmatter.clippedAt,
    tags: typeof value.tags === 'boolean'
      ? value.tags
      : DEFAULT_OBSIDIAN_SETTINGS.frontmatter.tags,
  };
}

/** 把 V0.1 扁平设置或不完整的 V2 设置转换为完整的 V2 模型。 */
export function migrateSettings(raw: unknown): ClipSettings {
  if (!isRecord(raw)) return cloneDefaultSettings();

  const save = isRecord(raw.save) ? raw.save : raw;
  const filename = isRecord(raw.filename) ? raw.filename : {};
  const obsidian = isRecord(raw.obsidian) ? raw.obsidian : {};

  const rawNoteDirectory = readString(obsidian.noteDirectory, raw.noteFolder);
  const noteDirectory = rawNoteDirectory === undefined
    ? DEFAULT_OBSIDIAN_SETTINGS.noteDirectory
    : sanitizeSubfolder(rawNoteDirectory) || DEFAULT_OBSIDIAN_SETTINGS.noteDirectory;

  const rawTemplate = readString(filename.template, raw.filenameTemplate);

  return {
    settingsVersion: SETTINGS_VERSION,
    save: {
      subfolder: typeof save.subfolder === 'string'
        ? save.subfolder
        : DEFAULT_SETTINGS.save.subfolder,
      saveAs: typeof save.saveAs === 'boolean'
        ? save.saveAs
        : DEFAULT_SETTINGS.save.saveAs,
    },
    filename: {
      template: rawTemplate?.trim() || DEFAULT_FILENAME_TEMPLATE,
    },
    obsidian: {
      enabled: typeof obsidian.enabled === 'boolean' ? obsidian.enabled : false,
      apiUrl: normalizeBaseUrl(readString(obsidian.apiUrl, raw.obsidianApiBaseUrl)),
      apiKey: readString(obsidian.apiKey, raw.obsidianApiKey)?.trim() ?? '',
      noteDirectory,
      frontmatter: normalizeFrontmatter(obsidian.frontmatter),
    },
    ai: normalizeAiSettings(raw.ai),
  };
}

/** 读设置：合并默认值；读取异常时回退默认值，绝不中断下载链路。 */
export function loadSettings(): Promise<ClipSettings> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(STORAGE_KEY, (items) => {
        const raw = items?.[STORAGE_KEY];
        resolve(migrateSettings(raw));
      });
    } catch {
      resolve(cloneDefaultSettings());
    }
  });
}

/** 写设置：normalize 后持久化。 */
export function saveSettings(settings: ClipSettings): Promise<void> {
  return new Promise((resolve, reject) => {
    const migrated = migrateSettings(settings);
    const normalized: ClipSettings = {
      ...migrated,
      save: {
        ...migrated.save,
        subfolder: sanitizeSubfolder(migrated.save.subfolder),
        saveAs: migrated.save.saveAs === true,
      },
      obsidian: {
        ...migrated.obsidian,
        apiKey: migrated.obsidian.apiKey.trim(),
        frontmatter: { ...migrated.obsidian.frontmatter },
      },
      ai: normalizeAiSettings(migrated.ai),
    };
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: normalized }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/** 清洗 Obsidian 地址：去掉末尾 /，空串兜底默认值 */
function normalizeBaseUrl(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  const base = value.replace(/\/+$/, '');
  return base || DEFAULT_OBSIDIAN_SETTINGS.apiUrl;
}
