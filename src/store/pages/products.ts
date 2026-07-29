// Products listing page: search, sort, pagination, and (via ctx.param) an
// optional category scope. The same module backs both the /store/products
// route (route id 'products', ctx.param undefined) and the /store/categories/
// :slug route (route id 'category', ctx.param the category slug).

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import { emptyHtml, errorHtml, loadingHtml, paginationHtml, productGridHtml } from '../dom';
import type { StorePage, StorePageContext } from '../page';
import { getCategory, listProducts } from '../shop_api';
import type { ListProductsParams } from '../shop_api';

const PAGE_SIZE = 20;
const CONTENT_ID = 'store-products-content';
const SEARCH_ID = 'store-products-search';
const SORT_ID = 'store-products-sort';
const RETRY_ID = 'store-products-retry';

interface FilterState {
  q: string;
  sort: 'createdAt' | 'name' | 'updatedAt';
  dir: 'asc' | 'desc';
  page: number;
}

function initialFilters(): FilterState {
  return { q: '', sort: 'createdAt', dir: 'desc', page: 1 };
}

async function loadContent(
  root: HTMLElement,
  filters: FilterState,
  categorySlug: string | undefined,
): Promise<void> {
  const slot = root.querySelector(`#${CONTENT_ID}`);
  if (!slot) return;
  slot.innerHTML = loadingHtml();
  try {
    let categoryId: number | undefined;
    if (categorySlug !== undefined) {
      const category = await getCategory(categorySlug);
      categoryId = category.id;
    }
    const params: ListProductsParams = {
      page: filters.page,
      limit: PAGE_SIZE,
      q: filters.q || undefined,
      sort: filters.sort,
      dir: filters.dir,
      categoryId,
    };
    const result = await listProducts(params);
    slot.innerHTML =
      result.rows.length > 0
        ? productGridHtml(result.rows) +
          paginationHtml(result.page, result.limit, result.total, 'store-products-page')
        : emptyHtml(t('store.products.empty'));
    wirePagination(root, slot, filters, categorySlug, result.total, PAGE_SIZE);
  } catch {
    if (categorySlug !== undefined) {
      slot.innerHTML = emptyHtml(t('store.products.categoryNotFound'));
      return;
    }
    slot.innerHTML = errorHtml(RETRY_ID);
    slot
      .querySelector(`#${RETRY_ID}`)
      ?.addEventListener('click', () => void loadContent(root, filters, categorySlug));
  }
}

function wirePagination(
  root: HTMLElement,
  slot: Element,
  filters: FilterState,
  categorySlug: string | undefined,
  total: number,
  limit: number,
): void {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  slot.querySelector('#store-products-page-prev')?.addEventListener('click', () => {
    if (filters.page > 1) {
      filters.page -= 1;
      void loadContent(root, filters, categorySlug);
    }
  });
  slot.querySelector('#store-products-page-next')?.addEventListener('click', () => {
    if (filters.page < totalPages) {
      filters.page += 1;
      void loadContent(root, filters, categorySlug);
    }
  });
}

export const productsPage: StorePage = {
  render() {
    return `
      <h1>${esc(t('store.products.title'))}</h1>
      <div class="store-controls">
        <input id="${SEARCH_ID}" type="search" placeholder="${esc(t('store.products.searchPlaceholder'))}" aria-label="${esc(t('store.products.searchPlaceholder'))}" />
        <label>${esc(t('store.products.sortLabel'))}
          <select id="${SORT_ID}">
            <option value="createdAt:desc">${esc(t('store.products.sortNewest'))}</option>
            <option value="name:asc">${esc(t('store.products.sortName'))}</option>
            <option value="updatedAt:desc">${esc(t('store.products.sortUpdated'))}</option>
          </select>
        </label>
      </div>
      <div id="${CONTENT_ID}">${loadingHtml()}</div>
    `;
  },
  mount(root: HTMLElement, ctx: StorePageContext) {
    const filters = initialFilters();
    const categorySlug = ctx.param;
    void loadContent(root, filters, categorySlug);

    let searchTimer: ReturnType<typeof setTimeout> | null = null;
    const searchInput = root.querySelector<HTMLInputElement>(`#${SEARCH_ID}`);
    const onSearchInput = (): void => {
      filters.q = searchInput?.value.trim() ?? '';
      filters.page = 1;
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => void loadContent(root, filters, categorySlug), 300);
    };
    searchInput?.addEventListener('input', onSearchInput);

    const sortSelect = root.querySelector<HTMLSelectElement>(`#${SORT_ID}`);
    const onSortChange = (): void => {
      const [sort, dir] = (sortSelect?.value ?? 'createdAt:desc').split(':');
      filters.sort = sort as FilterState['sort'];
      filters.dir = dir as FilterState['dir'];
      filters.page = 1;
      void loadContent(root, filters, categorySlug);
    };
    sortSelect?.addEventListener('change', onSortChange);

    return () => {
      if (searchTimer) clearTimeout(searchTimer);
      searchInput?.removeEventListener('input', onSearchInput);
      sortSelect?.removeEventListener('change', onSortChange);
    };
  },
};
