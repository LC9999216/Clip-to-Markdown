import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const optionsHtml = readFileSync(
  join(process.cwd(), 'src', 'options', 'options.html'),
  'utf8',
).replace('<script src="options.js"></script>', '');

function mountOptionsHtml(): void {
  document.open();
  document.write(optionsHtml);
  document.close();
}

beforeEach(() => {
  mountOptionsHtml();
});

describe('Clip2MD 设置页结构', () => {
  it('按保存位置、快捷键、Obsidian、保存栏的优先级组织页面', () => {
    const form = document.getElementById('settings-form');
    expect(form).not.toBeNull();

    const sectionIds = [...form!.querySelectorAll<HTMLElement>('[data-settings-section]')]
      .map((element) => element.id);
    expect(sectionIds).toEqual([
      'save-location-card',
      'shortcut-card',
      'obsidian-settings',
    ]);

    expect(document.getElementById('fallback-download-settings')).toBeInstanceOf(HTMLDetailsElement);
    expect((document.getElementById('obsidian-settings') as HTMLDetailsElement).open).toBe(false);
    expect(document.querySelector('.save-bar')).not.toBeNull();
  });

  it('保留现有控制器绑定 ID 并提供新增状态控件', () => {
    const requiredIds = [
      'choose-folder',
      'clear-folder',
      'folder-name',
      'folder-status',
      'shortcut-value',
      'shortcut-btn',
      'subfolder',
      'save-as',
      'obsidian-api-base-url',
      'obsidian-api-key',
      'note-folder',
      'test-obsidian-btn',
      'obsidian-status',
      'save-btn',
      'save-status',
      'folder-connection-state',
      'obsidian-summary-state',
      'toggle-api-key',
    ];

    for (const id of requiredIds) {
      expect(document.getElementById(id), `missing #${id}`).not.toBeNull();
    }

    expect((document.getElementById('obsidian-api-key') as HTMLInputElement).type).toBe('password');
    expect(document.getElementById('save-status')?.getAttribute('aria-live')).toBe('polite');
  });
});
