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
  const carouselMaybe = root.querySelector<HTMLElement>('.store-carousel');
  const track = carouselMaybe?.querySelector<HTMLElement>('.store-carousel-track');
  const prevBtn = carouselMaybe?.querySelector<HTMLButtonElement>('.store-carousel-prev');
  const nextBtn = carouselMaybe?.querySelector<HTMLButtonElement>('.store-carousel-next');
  if (!carouselMaybe || !track || !prevBtn || !nextBtn || count === 0) return undefined;
  const carousel: HTMLElement = carouselMaybe;

  let index = 0;
  // Hover and focus are tracked SEPARATELY (never one shared boolean two
  // listeners fight over): a mouseleave while a carousel control still has
  // keyboard focus must not resume auto-advance out from under that focused
  // control (the WCAG 2.2.2 pause mechanism failing in exactly the keyboard
  // case it exists for), and the reverse (hovering while focus is elsewhere)
  // must not un-pause on a stray focusout either.
  let hovered = false;
  let focused = false;
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

  function syncPaused(): void {
    const next = hovered || focused;
    if (next === paused) return;
    paused = next;
    if (paused) disarmTimer();
    else armTimer();
  }

  function onMouseEnter(): void {
    hovered = true;
    syncPaused();
  }

  function onMouseLeave(): void {
    hovered = false;
    syncPaused();
  }

  function onFocusIn(): void {
    focused = true;
    syncPaused();
  }

  function onFocusOut(event: FocusEvent): void {
    // Moving focus between the carousel's OWN controls (prev -> next) fires
    // focusout then focusin on the container; relatedTarget is the element
    // GAINING focus, so treat that as "focus never left" rather than a
    // pause/resume flicker.
    const next = event.relatedTarget;
    if (next instanceof Node && carousel.contains(next)) return;
    focused = false;
    syncPaused();
  }

  function onPrev(): void {
    index = prevCarouselIndex(index, count);
    scrollToIndex(index);
  }

  prevBtn.addEventListener('click', onPrev);
  nextBtn.addEventListener('click', advance);
  carousel.addEventListener('mouseenter', onMouseEnter);
  carousel.addEventListener('mouseleave', onMouseLeave);
  carousel.addEventListener('focusin', onFocusIn);
  carousel.addEventListener('focusout', onFocusOut);

  armTimer();

  return () => {
    disarmTimer();
    prevBtn.removeEventListener('click', onPrev);
    nextBtn.removeEventListener('click', advance);
    carousel.removeEventListener('mouseenter', onMouseEnter);
    carousel.removeEventListener('mouseleave', onMouseLeave);
    carousel.removeEventListener('focusin', onFocusIn);
    carousel.removeEventListener('focusout', onFocusOut);
  };
}
