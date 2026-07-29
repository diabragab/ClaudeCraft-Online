// Single source of truth for the storefront's routes. Pure data + a pure
// matcher (no DOM), mirroring src/guide/routes.ts's shape but much flatter:
// every route takes at most one trailing :param (a slug or an order id), so a
// plain lookup table is enough (no generic prefix-matching engine needed).

export const STORE_BASE = '/store';

export type StoreRouteId =
  | 'home'
  | 'categories'
  | 'category'
  | 'products'
  | 'product'
  | 'cart'
  | 'checkout'
  | 'confirmation'
  | 'orders'
  | 'order'
  | 'notFound';

export interface StoreRouteMatch {
  id: StoreRouteId;
  /** The :slug or :id segment, for routes that take one. */
  param?: string;
}

/** Normalize a browser pathname to the store sub-path ('' for the landing). */
export function toSub(pathname: string): string {
  let p = pathname.split('#')[0].split('?')[0];
  if (p.startsWith(STORE_BASE)) p = p.slice(STORE_BASE.length);
  return p.replace(/^\/+/, '').replace(/\/+$/, '');
}

export function matchRoute(pathname: string): StoreRouteMatch {
  const sub = toSub(pathname);
  if (sub === '') return { id: 'home' };
  const segs = sub.split('/');
  const [head, param, extra] = segs;
  if (extra !== undefined) return { id: 'notFound' };
  switch (head) {
    case 'categories':
      return param === undefined ? { id: 'categories' } : { id: 'category', param };
    case 'products':
      return param === undefined ? { id: 'products' } : { id: 'product', param };
    case 'cart':
      return param === undefined ? { id: 'cart' } : { id: 'notFound' };
    case 'checkout':
      return param === undefined ? { id: 'checkout' } : { id: 'notFound' };
    case 'confirmation':
      return param === undefined ? { id: 'notFound' } : { id: 'confirmation', param };
    case 'orders':
      return param === undefined ? { id: 'orders' } : { id: 'order', param };
    default:
      return { id: 'notFound' };
  }
}

/** Absolute href for a store sub-path (e.g. 'products/iron-sword'). */
export function hrefFor(sub: string): string {
  return sub ? `${STORE_BASE}/${sub}` : STORE_BASE;
}
