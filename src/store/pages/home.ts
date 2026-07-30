// Home page: hero, featured products, new arrivals, category tiles.

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import { emptyHtml, errorHtml, loadingHtml, productGridHtml } from '../dom';
import { listCategories } from '../shop_api';
import { listProducts } from '../shop_api';
import type { StorePage, StorePageContext } from '../page';
import { hrefFor } from '../routes';
import type { StoreCategory, StoreProduct } from '../types';

const CONTENT_ID = 'store-home-content';
const RETRY_ID = 'store-home-retry';

function categoryTileHtml(category: StoreCategory): string {
  return `<a class="store-category-tile" href="${esc(hrefFor(`categories/${category.slug}`))}">${esc(category.name)}</a>`;
}

async function loadContent(root: HTMLElement): Promise<void> {
  const slot = root.querySelector(`#${CONTENT_ID}`);
  if (!slot) return;
  try {
    const [featured, fresh, categories] = await Promise.all([
      listProducts({ featured: true, limit: 8 }),
      listProducts({ sort: 'createdAt', dir: 'desc', limit: 8 }),
      listCategories({ limit: 8, sort: 'sortOrder', dir: 'asc' }),
    ]);
    slot.innerHTML = renderContent(featured.rows, fresh.rows, categories.rows);
  } catch {
    slot.innerHTML = errorHtml(RETRY_ID);
    slot.querySelector(`#${RETRY_ID}`)?.addEventListener('click', () => void loadContent(root));
  }
}

function renderContent(
  featured: StoreProduct[],
  fresh: StoreProduct[],
  categories: StoreCategory[],
): string {
  return `
    <section class="store-section" aria-labelledby="store-home-featured-heading">
      <h2 id="store-home-featured-heading">${esc(t('store.home.featuredTitle'))}</h2>
      ${featured.length > 0 ? productGridHtml(featured) : emptyHtml(t('store.home.noFeatured'))}
    </section>
    <section class="store-section" aria-labelledby="store-home-new-heading">
      <h2 id="store-home-new-heading">${esc(t('store.home.newTitle'))}</h2>
      ${fresh.length > 0 ? productGridHtml(fresh) : emptyHtml(t('store.home.noNew'))}
    </section>
    <section class="store-section" aria-labelledby="store-home-categories-heading">
      <h2 id="store-home-categories-heading">${esc(t('store.home.categoriesTitle'))}</h2>
      ${
        categories.length > 0
          ? `<div class="store-category-tiles">${categories.map(categoryTileHtml).join('')}</div>`
          : ''
      }
      <a class="store-browse-all" href="${esc(hrefFor('products'))}">${esc(t('store.home.browseAll'))}</a>
    </section>
  `;
}

export const homePage: StorePage = {
  render() {
    return `
      <div class="store-hero">
        <h1>${esc(t('store.home.heroTitle'))}</h1>
        <p>${esc(t('store.home.heroSubtitle'))}</p>
      </div>
      <div id="${CONTENT_ID}">${loadingHtml()}</div>
    `;
  },
  mount(root: HTMLElement, _ctx: StorePageContext) {
    void loadContent(root);
  },
};
