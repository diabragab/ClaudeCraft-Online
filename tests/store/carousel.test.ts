// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { featuredCarouselHtml, mountFeaturedCarousel } from '../../src/store/carousel';
import type { StoreProduct } from '../../src/store/types';

function product(overrides: Partial<StoreProduct> = {}): StoreProduct {
  return {
    id: 1,
    sku: 'sword-01',
    name: 'Iron Sword',
    slug: 'iron-sword',
    description: '',
    categoryId: null,
    priceGoldCopper: 500,
    priceClaudium: null,
    priceUsdCents: null,
    railSol: false,
    railUsdc: false,
    railWoc: false,
    status: 'active',
    featured: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    availability: 'in_stock',
    rarity: 'common',
    badges: [],
    isEvent: false,
    isLimited: false,
    discountPercent: null,
    bannerImage: null,
    previewImage: null,
    ...overrides,
  };
}

const PRODUCTS = [
  product({ id: 1, slug: 'sword', name: 'Sword' }),
  product({ id: 2, slug: 'shield', name: 'Shield' }),
  product({ id: 3, slug: 'bow', name: 'Bow' }),
];

let scrollIntoView: ReturnType<typeof vi.fn>;

beforeEach(() => {
  scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView as typeof Element.prototype.scrollIntoView;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function mountedRoot(products = PRODUCTS): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = featuredCarouselHtml(products);
  return root;
}

describe('featuredCarouselHtml', () => {
  it('renders one slide per product plus prev/next controls', () => {
    const root = mountedRoot();
    expect(root.querySelectorAll('.store-carousel-slide')).toHaveLength(3);
    expect(root.querySelector('.store-carousel-prev')).not.toBeNull();
    expect(root.querySelector('.store-carousel-next')).not.toBeNull();
  });

  it('renders nothing for an empty product list', () => {
    expect(featuredCarouselHtml([])).toBe('');
  });
});

describe('mountFeaturedCarousel', () => {
  it('returns undefined and wires nothing when there are no slides', () => {
    const root = mountedRoot([]);
    expect(mountFeaturedCarousel(root, 0)).toBeUndefined();
  });

  it('auto-advances on an interval', () => {
    const root = mountedRoot();
    mountFeaturedCarousel(root, PRODUCTS.length);
    expect(scrollIntoView).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('never auto-advances a single-slide carousel', () => {
    const root = mountedRoot([PRODUCTS[0]]);
    mountFeaturedCarousel(root, 1);
    vi.advanceTimersByTime(20_000);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('pauses on hover and resumes on mouseleave', () => {
    const root = mountedRoot();
    mountFeaturedCarousel(root, PRODUCTS.length);
    const carousel = root.querySelector('.store-carousel') as HTMLElement;

    carousel.dispatchEvent(new Event('mouseenter'));
    vi.advanceTimersByTime(20_000);
    expect(scrollIntoView).not.toHaveBeenCalled();

    carousel.dispatchEvent(new Event('mouseleave'));
    vi.advanceTimersByTime(5000);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('pauses on focus and resumes on blur (focusin/focusout)', () => {
    const root = mountedRoot();
    mountFeaturedCarousel(root, PRODUCTS.length);
    const carousel = root.querySelector('.store-carousel') as HTMLElement;

    carousel.dispatchEvent(new Event('focusin', { bubbles: true }));
    vi.advanceTimersByTime(20_000);
    expect(scrollIntoView).not.toHaveBeenCalled();

    carousel.dispatchEvent(new Event('focusout', { bubbles: true }));
    vi.advanceTimersByTime(5000);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('advances immediately on a next-button click, without waiting for the timer', () => {
    const root = mountedRoot();
    mountFeaturedCarousel(root, PRODUCTS.length);
    (root.querySelector('.store-carousel-next') as HTMLButtonElement).click();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('moves backward on a prev-button click', () => {
    const root = mountedRoot();
    mountFeaturedCarousel(root, PRODUCTS.length);
    (root.querySelector('.store-carousel-prev') as HTMLButtonElement).click();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('stops auto-advancing and detaches its listeners once disposed', () => {
    const root = mountedRoot();
    const dispose = mountFeaturedCarousel(root, PRODUCTS.length);
    dispose?.();
    vi.advanceTimersByTime(20_000);
    expect(scrollIntoView).not.toHaveBeenCalled();

    const carousel = root.querySelector('.store-carousel') as HTMLElement;
    carousel.dispatchEvent(new Event('mouseenter'));
    carousel.dispatchEvent(new Event('mouseleave'));
    vi.advanceTimersByTime(20_000);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
