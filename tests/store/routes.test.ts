import { describe, expect, it } from 'vitest';
import { hrefFor, matchRoute, STORE_BASE, toSub } from '../../src/store/routes';

describe('toSub', () => {
  it('strips the store base and leading/trailing slashes', () => {
    expect(toSub('/store')).toBe('');
    expect(toSub('/store/')).toBe('');
    expect(toSub('/store/products')).toBe('products');
    expect(toSub('/store/products/iron-sword')).toBe('products/iron-sword');
  });

  it('drops a query string or hash', () => {
    expect(toSub('/store/products?q=sword')).toBe('products');
    expect(toSub('/store/products#top')).toBe('products');
  });
});

describe('matchRoute', () => {
  it('matches the home route for the bare base', () => {
    expect(matchRoute(STORE_BASE)).toEqual({ id: 'home' });
    expect(matchRoute(`${STORE_BASE}/`)).toEqual({ id: 'home' });
  });

  it('matches categories list and category detail', () => {
    expect(matchRoute(`${STORE_BASE}/categories`)).toEqual({ id: 'categories' });
    expect(matchRoute(`${STORE_BASE}/categories/weapons`)).toEqual({
      id: 'category',
      param: 'weapons',
    });
  });

  it('matches products list and product detail', () => {
    expect(matchRoute(`${STORE_BASE}/products`)).toEqual({ id: 'products' });
    expect(matchRoute(`${STORE_BASE}/products/iron-sword`)).toEqual({
      id: 'product',
      param: 'iron-sword',
    });
  });

  it('matches cart and checkout with no param', () => {
    expect(matchRoute(`${STORE_BASE}/cart`)).toEqual({ id: 'cart' });
    expect(matchRoute(`${STORE_BASE}/checkout`)).toEqual({ id: 'checkout' });
  });

  it('rejects a param on cart/checkout (they take none)', () => {
    expect(matchRoute(`${STORE_BASE}/cart/5`)).toEqual({ id: 'notFound' });
    expect(matchRoute(`${STORE_BASE}/checkout/5`)).toEqual({ id: 'notFound' });
  });

  it('matches confirmation only with an id, never bare', () => {
    expect(matchRoute(`${STORE_BASE}/confirmation/5`)).toEqual({ id: 'confirmation', param: '5' });
    expect(matchRoute(`${STORE_BASE}/confirmation`)).toEqual({ id: 'notFound' });
  });

  it('matches order history and order detail', () => {
    expect(matchRoute(`${STORE_BASE}/orders`)).toEqual({ id: 'orders' });
    expect(matchRoute(`${STORE_BASE}/orders/5`)).toEqual({ id: 'order', param: '5' });
  });

  it('falls back to notFound for an unknown top segment or extra depth', () => {
    expect(matchRoute(`${STORE_BASE}/nope`)).toEqual({ id: 'notFound' });
    expect(matchRoute(`${STORE_BASE}/products/iron-sword/extra`)).toEqual({ id: 'notFound' });
  });
});

describe('hrefFor', () => {
  it('builds an absolute store href', () => {
    expect(hrefFor('')).toBe(STORE_BASE);
    expect(hrefFor('products/iron-sword')).toBe(`${STORE_BASE}/products/iron-sword`);
  });
});
