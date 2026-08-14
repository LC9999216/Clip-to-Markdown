/**
 * 下载模块：仅在 background 使用。
 * 用 data URL 写 Markdown，无临时文件；conflictAction 使用 uniquify。
 */

export interface DownloadArgs {
  markdown: string;
  filename: string;
}

export async function downloadMarkdown(args: DownloadArgs): Promise<{ filename: string }> {
  const dataUrl = `data:text/markdown;charset=utf-8,${encodeURIComponent(args.markdown)}`;
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url: dataUrl,
        filename: args.filename,
        conflictAction: 'uniquify',
        saveAs: false,
      },
      () => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(`下载失败：${err.message}`));
        } else {
          resolve({ filename: args.filename });
        }
      },
    );
  });
}
