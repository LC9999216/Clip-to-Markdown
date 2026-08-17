import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchRuntimeMessage, runtimeSendMessageMock } from './setup';

const customFolderMocks = vi.hoisted(() => ({
  loadDirectoryHandle: vi.fn(),
  writeMarkdownToDirectory: vi.fn(),
}));

vi.mock('../src/core/custom-folder', () => customFolderMocks);

describe('offscreen Markdown 文件名', () => {
  const directory = { name: 'Clippings' } as FileSystemDirectoryHandle;

  beforeAll(async () => {
    runtimeSendMessageMock.mockResolvedValue(undefined);
    await import('../src/offscreen/offscreen');
  });

  beforeEach(() => {
    customFolderMocks.loadDirectoryHandle.mockReset();
    customFolderMocks.writeMarkdownToDirectory.mockReset();
    customFolderMocks.loadDirectoryHandle.mockResolvedValue(directory);
    customFolderMocks.writeMarkdownToDirectory.mockImplementation(
      async (_dir: FileSystemDirectoryHandle, filename: string) => filename,
    );
  });

  it.each([
    ['80 字符主体', `${'X'.repeat(80)}.md`, `${'X'.repeat(80)}.md`],
    ['79 字符主体', `${'X'.repeat(79)}.md`, `${'X'.repeat(79)}.md`],
    ['普通短文件名', 'note.md', 'note.md'],
  ])('%s 在离屏清洗后仍保留 .md', async (_caseName, input, expected) => {
    const response = await dispatchRuntimeMessage(
      { type: 'WRITE_CUSTOM', payload: { filename: input, markdown: '# body' } },
      { id: chrome.runtime.id },
    );

    expect(response).toEqual({ success: true, filename: `Clippings/${expected}` });
    expect(customFolderMocks.writeMarkdownToDirectory).toHaveBeenCalledWith(
      directory,
      expected,
      '# body',
    );
  });
});
