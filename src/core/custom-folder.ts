/**
 * 自定义保存文件夹：通过 File System Access API 把 Markdown 直接写入用户选定的任意目录。
 *
 * 说明：
 * - FileSystemDirectoryHandle 是结构化可克隆对象，但不能 JSON 序列化，
 *   因此不能放进 chrome.storage，只能用 IndexedDB 存（扩展各页面同源共享）。
 * - showDirectoryPicker 必须在「标签页」的用户手势里调用（options 页，open_in_tab），
 *   弹窗里打开系统选择器会因失焦关闭 popup，所以选择动作固定在设置页。
 * - File System Access API 在 service worker 中不可用，因此写入在 popup（窗口上下文）完成。
 */

const DB_NAME = 'clip2md';
const STORE_NAME = 'handles';
const KEY = 'directory';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'));
  });
}

/** 保存选中的目录句柄。 */
export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(handle, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('保存文件夹句柄失败'));
  });
  db.close();
}

/** 读取已保存的目录句柄；未设置时返回 null。 */
export async function loadDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDb();
  try {
    return await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(KEY);
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error('读取文件夹句柄失败'));
    });
  } finally {
    db.close();
  }
}

/** 清除已保存的目录句柄。 */
export async function clearDirectoryHandle(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('清除文件夹句柄失败'));
  });
  db.close();
}

/**
 * 在目录里写入 Markdown，返回最终使用的文件名。
 * 同名文件自动加 " (n)" 后缀，避免覆盖既有内容。
 */
export async function writeMarkdownToDirectory(
  dir: FileSystemDirectoryHandle,
  filename: string,
  markdown: string,
): Promise<string> {
  const finalName = await uniquifyAsync(filename, async (name) => {
    try {
      await dir.getFileHandle(name, { create: false });
      return true;
    } catch {
      return false;
    }
  });

  const fileHandle = await dir.getFileHandle(finalName, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(markdown);
  } finally {
    await writable.close();
  }
  return finalName;
}

/**
 * 生成不与既有文件冲突的文件名：base.md → base (1).md → base (2).md …
 * 纯逻辑（不依赖浏览器 API），便于单元测试。
 */
export async function uniquifyAsync(
  base: string,
  isTaken: (name: string) => Promise<boolean>,
): Promise<string> {
  if (!(await isTaken(base))) return base;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  for (let i = 1; i < 1000; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
}
