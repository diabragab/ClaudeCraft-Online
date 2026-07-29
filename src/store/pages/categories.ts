// Categories page: the full category list.

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import { emptyHtml, errorHtml, loadingHtml } from '../dom';
import type { StorePage } from '../page';
import { hrefFor } from '../routes';
import { listCategories } from '../shop_api';
import type { StoreCategory } from '../types';

const CONTENT_ID = 'store-categories-content';
const RETRY_ID = 'store-categories-retry';

function tileHtml(category: StoreCategory): string {
  return `<a class="store-category-tile" href="${esc(hrefFor(`categories/${category.slug}`))}">
    <div>${esc(category.name)}</div>
    ${category.description ? `<p class="store-category-desc">${esc(category.description)}</p>` : ''}
  </a>`;
}

async function loadContent(root: HTMLElement): Promise<void> {
  const slot = root.querySelector(`#${CONTENT_ID}`);
  if (!slot) return;
  try {
    const result = await listCategories({ limit: 100, sort: 'sortOrder', dir: 'asc' });
    slot.innerHTML =
      result.rows.length > 0
        ? `<div class="store-category-tiles">${result.rows.map(tileHtml).join('')}</div>`
        : emptyHtml(t('store.categories.empty'));
  } catch {
    slot.innerHTML = errorHtml(RETRY_ID);
    slot.querySelector(`#${RETRY_ID}`)?.addEventListener('click', () => void loadContent(root));
  }
}

export const categoriesPage: StorePage = {
  render() {
    return `<h1>${esc(t('store.categories.title'))}</h1><div id="${CONTENT_ID}">${loadingHtml()}</div>`;
  },
  mount(root: HTMLElement) {
    void loadContent(root);
  },
};
