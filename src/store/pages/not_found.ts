import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import type { StorePage } from '../page';
import { hrefFor } from '../routes';

export const notFoundPage: StorePage = {
  render() {
    return `
      <div class="store-state">
        <h1>${esc(t('store.notFound.title'))}</h1>
        <p>${esc(t('store.notFound.body'))}</p>
        <a href="${esc(hrefFor(''))}">${esc(t('store.notFound.backHome'))}</a>
      </div>
    `;
  },
};
