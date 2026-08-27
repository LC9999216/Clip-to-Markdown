import { describe, expect, it, vi } from 'vitest';
import { renderStructure } from '../src/sidepanel/structure-renderer';
import type { VisualStructureItem } from '../src/analysis/types';

const ANCHORED: VisualStructureItem = {
  title: '可定位章节',
  sourceBlockId: 'B001',
  sourceQuote: '原文片段',
};

describe('V2 structure renderer', () => {
  it('renders anchored items as buttons and unanchored items as static spans', () => {
    const container = document.createElement('div');
    const items: VisualStructureItem[] = [ANCHORED, { title: '不可定位章节' }];

    renderStructure(container, items, vi.fn());

    expect(container.querySelectorAll('button.structure-item')).toHaveLength(1);
    expect(container.querySelectorAll('span.structure-item')).toHaveLength(1);
    expect(container.querySelector('button')?.type).toBe('button');
    expect(container.querySelectorAll('.structure-index')[0]?.textContent).toBe('01');
    expect(container.querySelectorAll('.structure-index')[1]?.textContent).toBe('02');
  });

  it('passes only the clicked anchored item to the navigation callback', () => {
    const container = document.createElement('div');
    const onNavigate = vi.fn();

    renderStructure(container, [ANCHORED, { title: '静态' }], onNavigate);
    (container.querySelector('button.structure-item') as HTMLButtonElement).click();

    expect(onNavigate).toHaveBeenCalledWith(ANCHORED);
  });

  it('renders titles as text and replaces old children', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>旧内容</p>';

    renderStructure(container, [{ title: '<img src=x onerror=alert(1)>' }], vi.fn());

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.structure-title')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(container.textContent).not.toContain('旧内容');
  });
});
