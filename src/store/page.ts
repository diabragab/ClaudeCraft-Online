// The storefront page contract. Every page module exports one `StorePage`:
// render() returns a synchronous loading skeleton (or fully static markup),
// and the optional mount() does the async data fetch and patches the DOM,
// returning a cleanup callback the app orchestrator calls before the next
// navigation. Mirrors the pure-render-plus-thin-mount split src/guide/pages/
// already uses, simplified for this surface's flatter page set.

import type { CartController } from './cart_controller';

export interface StorePageContext {
  /** The :slug or :id segment from the matched route, when the route takes one. */
  param?: string;
  cart: CartController;
  /** Programmatic client-side navigation (e.g. redirect after checkout). */
  navigate: (path: string) => void;
}

export interface StorePage {
  // ctx is optional: most pages only need it inside mount() (the async data
  // fetch + wiring); render() is just a synchronous loading skeleton for
  // them. cart_page.ts/checkout.ts DO read ctx synchronously (the live cart
  // state), so they declare it required in their own render signature - a
  // parameter-list SUBSET is a valid implementation of this interface.
  render(ctx?: StorePageContext): string;
  mount?(root: HTMLElement, ctx: StorePageContext): (() => void) | void;
}
