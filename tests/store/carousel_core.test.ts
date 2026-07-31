import { describe, expect, it } from 'vitest';
import {
  nextCarouselIndex,
  prevCarouselIndex,
  shouldAutoAdvance,
} from '../../src/store/carousel_core';

describe('nextCarouselIndex', () => {
  it('advances by one', () => {
    expect(nextCarouselIndex(0, 3)).toBe(1);
    expect(nextCarouselIndex(1, 3)).toBe(2);
  });

  it('wraps from the last slide back to the first', () => {
    expect(nextCarouselIndex(2, 3)).toBe(0);
  });

  it('returns 0 for a zero or negative count', () => {
    expect(nextCarouselIndex(0, 0)).toBe(0);
    expect(nextCarouselIndex(5, -1)).toBe(0);
  });
});

describe('prevCarouselIndex', () => {
  it('retreats by one', () => {
    expect(prevCarouselIndex(2, 3)).toBe(1);
  });

  it('wraps from the first slide back to the last', () => {
    expect(prevCarouselIndex(0, 3)).toBe(2);
  });

  it('returns 0 for a zero or negative count', () => {
    expect(prevCarouselIndex(0, 0)).toBe(0);
  });
});

describe('shouldAutoAdvance', () => {
  it('auto-advances when not paused, motion is fine, and there is more than one slide', () => {
    expect(shouldAutoAdvance({ paused: false, reducedMotion: false, count: 3 })).toBe(true);
  });

  it('never auto-advances while paused', () => {
    expect(shouldAutoAdvance({ paused: true, reducedMotion: false, count: 3 })).toBe(false);
  });

  it('never auto-advances under reduced motion, even unpaused', () => {
    expect(shouldAutoAdvance({ paused: false, reducedMotion: true, count: 3 })).toBe(false);
  });

  it('never auto-advances a single slide or an empty carousel', () => {
    expect(shouldAutoAdvance({ paused: false, reducedMotion: false, count: 1 })).toBe(false);
    expect(shouldAutoAdvance({ paused: false, reducedMotion: false, count: 0 })).toBe(false);
  });
});
