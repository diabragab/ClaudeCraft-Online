// Direct coverage for the discount arithmetic PgShopOrdersDb.createOrder
// applies when pricing an order line (server/shop_orders_db.ts). This is the
// one server-side formula that decides what a buyer is actually CHARGED, and
// it must stay byte-identical to the storefront's own display-side
// discountedAmount() (src/store/dom.ts), or an advertised discount and the
// charged price drift apart. The full createOrder transaction itself has no
// fake-pg-client harness (a pre-existing gap this file does not attempt to
// close); orchestration-level coverage that the Db-returned price flows
// through to the ledger debit lives in tests/shop_ledger_checkout.test.ts
// and tests/shop_orders.test.ts.
import { describe, expect, it } from 'vitest';
import { discountedAmount } from '../../server/shop_orders_db';

describe('discountedAmount', () => {
  it('returns the amount unchanged when there is no discount', () => {
    expect(discountedAmount(1000, null)).toBe(1000);
  });

  it('applies a percent discount, rounded', () => {
    expect(discountedAmount(1000, 30)).toBe(700);
    expect(discountedAmount(999, 10)).toBe(899); // 899.1 rounds down
    expect(discountedAmount(1, 50)).toBe(1); // 0.5 rounds up (banker's-free)
  });

  it('matches the storefront display formula exactly for a range of inputs', () => {
    // The same Math.round((amount * (100 - discountPercent)) / 100) formula
    // src/store/dom.ts's own discountedAmount() uses, re-derived here rather
    // than imported (the client/server boundary is never crossed in this repo).
    const clientFormula = (amount: number, percent: number) =>
      Math.round((amount * (100 - percent)) / 100);
    for (const amount of [1, 50, 200, 999, 12345]) {
      for (const percent of [1, 25, 50, 75, 99]) {
        expect(discountedAmount(amount, percent)).toBe(clientFormula(amount, percent));
      }
    }
  });

  it('treats a 99% discount as still charging at least the rounded remainder', () => {
    expect(discountedAmount(100, 99)).toBe(1);
  });
});
