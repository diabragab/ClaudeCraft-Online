// Featured-products carousel (Phase 2F): a CSS scroll-snap track with
// prev/next controls and hover/focus-paused auto-advance. The pure index and
// pause math lives in carousel_core.ts; this module only builds the markup
// (reusing the shared productCardHtml, so a carousel slide looks identical to
// a grid card) and wires the live DOM behavior, mirroring the render()-plus-
// mount() split every storefront page already uses (see page.ts).

import { esc } from '../ui/esc';
import { t } from '../ui/i18n';
import { nextCarouselIndex, prevCarouselIndex, shouldAutoAdvance } from './carousel_core';
import { productCardHtml } from './dom';
import type { StoreProduct } from './types';

const AUTO_ADVANCE_MS = 5000;

export function featuredCarouselHtml(products: StoreProduct[]): string {
  if (products.length === 0) return '';
  const slides = products
    .map((product) => `<div class="store-carousel-slide">${productCardHtml(product)}</div>`)
    .join('');
  return (
    `<div class="store-carousel" role="region" aria-roledescription="carousel" aria-label="${esc(t('store.home.carouselLabel'))}">` +
    `<button type="button" class="store-carousel-prev" aria-label="${esc(t('store.home.carouselPrev'))}">&lsaquo;</button>` +
    `<div class="store-carousel-track">${slides}</div>` +
    `<button type="button" class="store-carousel-next" aria-label="${esc(t('store.home.carouselNext'))}">&rsaquo;</button>` +
    `</div>`
  );
}

/**
 * Wires the carousel markup featuredCarouselHtml rendered into root: prev/
 * next buttons, hover/focus pause, and an auto-advance timer disarmed
 * entirely (not merely slowed) under prefers-reduced-motion. Returns a
 * dispose callback the page's mount() forwards as its own cleanup, or
 * undefined when there is nothing to wire (no carousel in the DOM, or a
 * single/zero-slide count that never auto-advances or scrolls anywhere).
 */
export function mountFeaturedCarousel(root: HTMLElement, count: number): (() => void) | undefined {
  const carousel = root.querySelector<HTMLElement>('.store-carousel');
  const track = carousel?.querySelector<HTMLElement>('.store-carousel-track');
  const prevBtn = carousel?.querySelector<HTMLButtonElement>('.store-carousel-prev');
  const nextBtn = carousel?.querySelector<HTMLButtonElement>('.store-carousel-next');
  if (!carousel || !track || !prevBtn || !nextBtn || count === 0) return undefined;

  let index = 0;
  let paused = false;
  // jsdom (the test environment) does not implement matchMedia at all; treat
  // that as "no preference expressed" rather than throwing, so this module
  // degrades the same way a browser lacking the API would.
  const reducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let timer: number | null = null;

  function scrollToIndex(i: number): void {
    const slide = track?.children[i];
    if (slide instanceof HTMLElement && typeof slide.scrollIntoView === 'function') {
      slide.scrollIntoView({
        block: 'nearest',
        inline: 'start',
        behavior: reducedMotion ? 'auto' : 'smooth',
      });
    }
  }

  function advance(): void {
    index = nextCarouselIndex(index, count);
    scrollToIndex(index);
  }

  function armTimer(): void {
    if (timer !== null || !shouldAutoAdvance({ paused, reducedMotion, count })) return;
    timer = window.setInterval(advance, AUTO_ADVANCE_MS);
  }

  function disarmTimer(): void {
    if (timer === null) return;
    window.clearInterval(timer);
    timer = null;
  }

  function pause(): void {
    paused = true;
    disarmTimer();
  }

  function resume(): void {
    paused = false;
    armTimer();
  }

  function onPrev(): void {
    index = prevCarouselIndex(index, count);
    scrollToIndex(index);
  }

  prevBtn.addEventListener('click', onPrev);
  nextBtn.addEventListener('click', advance);
  carousel.addEventListener('mouseenter', pause);
  carousel.addEventListener('mouseleave', resume);
  carousel.addEventListener('focusin', pause);
  carousel.addEventListener('focusout', resume);

  armTimer();

  return () => {
    disarmTimer();
    prevBtn.removeEventListener('click', onPrev);
    nextBtn.removeEventListener('click', advance);
    carousel.removeEventListener('mouseenter', pause);
    carousel.removeEventListener('mouseleave', resume);
    carousel.removeEventListener('focusin', pause);
    carousel.removeEventListener('focusout', resume);
  };
}
