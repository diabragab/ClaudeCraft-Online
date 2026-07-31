// Pure, DOM-free index/pause math for the storefront's featured-products
// carousel (Phase 2F). The DOM wiring (src/store/carousel.ts) owns the
// scroll-snap track, the interval timer, and the media-query read; this
// module only decides WHICH slide is next and WHETHER auto-advance should
// run right now, so both are unit-testable without jsdom.

export function nextCarouselIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return (((index + 1) % count) + count) % count;
}

export function prevCarouselIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return (((index - 1) % count) + count) % count;
}

export interface CarouselAutoAdvanceState {
  /** Hovered, focused, or otherwise interacted with since the last resume. */
  paused: boolean;
  /** matchMedia('(prefers-reduced-motion: reduce)').matches, read once by the caller. */
  reducedMotion: boolean;
  count: number;
}

/** A single slide (or none) never auto-advances: there is nowhere to go, and
 *  a lone slide auto-"advancing" to itself would just be an unexplained
 *  flicker. Reduced motion disables auto-advance entirely, not just slows
 *  it, matching the repo's motion-sensitivity rule (never merely slower). */
export function shouldAutoAdvance(state: CarouselAutoAdvanceState): boolean {
  return !state.paused && !state.reducedMotion && state.count > 1;
}
