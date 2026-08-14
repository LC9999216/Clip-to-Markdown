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

export interface ClipSettings {
  /** 相对浏览器下载目录的子目录（用 / 分隔）；空串 = 直接存入下载目录 */
  subfolder: string;
  /** 每次下载弹出「另存为」对话框，由用户手动选位置 */
  saveAs: boolean;
}

export const DEFAULT_SETTINGS: ClipSettings = {
  subfolder: '',
  saveAs: false,
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
  settings: ClipSettings,
): { filename: string; saveAs: boolean } {
  const sub = sanitizeSubfolder(settings.subfolder);
  return {
    filename: sub ? `${sub}/${filename}` : filename,
    saveAs: settings.saveAs === true,
  };
}

const STORAGE_KEY = 'clip2md.settings';

/** 读设置：合并默认值；读取异常时回退默认值，绝不中断下载链路。 */
export function loadSettings(): Promise<ClipSettings> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(STORAGE_KEY, (items) => {
        const raw = items?.[STORAGE_KEY];
        if (raw && typeof raw === 'object') {
          const r = raw as Partial<ClipSettings>;
          resolve({
            subfolder: typeof r.subfolder === 'string' ? r.subfolder : DEFAULT_SETTINGS.subfolder,
            saveAs: typeof r.saveAs === 'boolean' ? r.saveAs : DEFAULT_SETTINGS.saveAs,
          });
        } else {
          resolve({ ...DEFAULT_SETTINGS });
        }
      });
    } catch {
      resolve({ ...DEFAULT_SETTINGS });
    }
  });
}

/** 写设置：normalize 后持久化。 */
export function saveSettings(settings: ClipSettings): Promise<void> {
  return new Promise((resolve, reject) => {
    const normalized: ClipSettings = {
      subfolder: sanitizeSubfolder(settings.subfolder),
      saveAs: settings.saveAs === true,
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
