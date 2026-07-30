// Presentation helpers shared across storefront pages. Reuses the game
// client's own formatters (formatMoney/formatNumber, src/ui/i18n.ts) rather
// than hand-rolling a second money-formatting scheme; the admin dashboard's
// separate fmtCopper (src/admin/format.ts) is a different bundle's own copy
// and is not reused here on purpose (see src/admin/CLAUDE.md: the admin
// bundle stays independent of the game client).

import { formatMoney, formatNumber, t, type TranslationKey } from '../ui/i18n';
import type { StorefrontAvailability } from './types';

export type StoreCurrency = 'gold' | 'claudium' | 'usd';

/** Format an amount (in `currency`'s smallest unit) for display. */
export function formatPrice(amount: number, currency: StoreCurrency): string {
  if (currency === 'gold') return formatMoney(amount, 'compact');
  if (currency === 'claudium') return t('store.priceClaudium', { amount: formatNumber(amount) });
  return `$${(amount / 100).toFixed(2)}`;
}

const AVAILABILITY_LABEL_KEYS: Record<StorefrontAvailability, TranslationKey> = {
  unlimited: 'store.availability.unlimited',
  in_stock: 'store.availability.inStock',
  low_stock: 'store.availability.lowStock',
  out_of_stock: 'store.availability.outOfStock',
  unavailable: 'store.availability.unavailable',
};

export function availabilityLabel(availability: StorefrontAvailability): string {
  return t(AVAILABILITY_LABEL_KEYS[availability]);
}

/** Whether a product in this availability state can be added to the cart at all. */
export function isPurchasable(availability: StorefrontAvailability): boolean {
  return availability !== 'out_of_stock' && availability !== 'unavailable';
}
