// Maps the storefront order-creation ApiError (server/http/error_codes.ts's
// shop.* codes, reused verbatim from Phase 1/3, no new codes for the
// storefront) to a player-facing message.

import { t } from '../../ui/i18n';
import { ApiError } from '../api';

export interface ShopOrderErrorLike {
  code?: string;
}

export function checkoutErrorMessage(err: ShopOrderErrorLike): string {
  if (err instanceof ApiError && err.code === 'shop.out_of_stock') {
    return t('store.checkout.outOfStockError');
  }
  return t('store.checkout.orderFailed');
}
