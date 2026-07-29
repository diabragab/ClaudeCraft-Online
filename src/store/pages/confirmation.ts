// Purchase confirmation page: shown right after checkout submits. There is
// no payment gateway yet, so this confirms the ORDER was PLACED (created
// pending), not that a payment completed - store.confirmation.body says so
// plainly, matching SHOP_SYSTEM.md's Phase 3 scope note that pending -> paid
// is a manual step until a gateway exists.

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import type { StorePage, StorePageContext } from '../page';
import { hrefFor } from '../routes';

export const confirmationPage: StorePage = {
  render(ctx: StorePageContext) {
    const id = ctx.param ?? '';
    return `
      <div class="store-state store-confirmation">
        <h1>${esc(t('store.confirmation.title'))}</h1>
        <p>${esc(t('store.confirmation.body', { id }))}</p>
        <a href="${esc(hrefFor(`orders/${id}`))}">${esc(t('store.confirmation.viewOrder'))}</a>
        <a href="${esc(hrefFor('products'))}">${esc(t('store.common.continueShopping'))}</a>
      </div>
    `;
  },
};
