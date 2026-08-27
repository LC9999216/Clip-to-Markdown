import type { VisualStructureItem } from '../analysis/types';

function hasAnchor(item: VisualStructureItem): item is Extract<VisualStructureItem, { sourceBlockId: string; sourceQuote: string }> {
  return typeof item.sourceBlockId === 'string'
    && item.sourceBlockId.trim() !== ''
    && typeof item.sourceQuote === 'string'
    && item.sourceQuote.trim() !== '';
}

/** Render the flat V2 structure list, making only source-linked items interactive. */
export function renderStructure(
  container: HTMLElement,
  items: VisualStructureItem[],
  onNavigate: (item: Extract<VisualStructureItem, { sourceBlockId: string; sourceQuote: string }>) => void,
): void {
  container.replaceChildren();
  const list = document.createElement('div');
  list.className = 'structure-list';

  items.forEach((item, index) => {
    const anchored = hasAnchor(item);
    const entry = anchored ? document.createElement('button') : document.createElement('span');
    entry.className = 'structure-item';
    if (anchored) {
      (entry as HTMLButtonElement).type = 'button';
      entry.addEventListener('click', () => onNavigate(item));
    }

    const number = document.createElement('span');
    number.className = 'structure-index';
    number.textContent = String(index + 1).padStart(2, '0');
    const title = document.createElement('span');
    title.className = 'structure-title';
    title.textContent = item.title;
    entry.append(number, title);
    list.appendChild(entry);
  });

  container.appendChild(list);
}
