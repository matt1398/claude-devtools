/**
 * Tests for the sidebar's auto-paging gate.
 *
 * This predicate is the fix for the sidebar paging itself in and out on a loop:
 * the previous check fired whenever the loader row was RENDERED, which the
 * virtualizer's overscan made true well before the user reached the bottom.
 */

import { describe, expect, it } from 'vitest';

import { shouldAutoLoadMore } from '../../../src/renderer/components/sidebar/autoLoadMore';

const metrics = (scrollHeight: number, clientHeight: number, scrollTop: number) => ({
  scrollHeight,
  clientHeight,
  scrollTop,
});

describe('shouldAutoLoadMore', () => {
  it('loads when the list does not overflow (everything is already visible)', () => {
    expect(shouldAutoLoadMore(metrics(400, 600, 0))).toBe(true);
    expect(shouldAutoLoadMore(metrics(600, 600, 0))).toBe(true);
  });

  // The regression case: a long list sitting at the top must NOT page, even though
  // the virtualizer may have rendered rows past the fold.
  it('does not load when scrolled to the top of a long list', () => {
    expect(shouldAutoLoadMore(metrics(5000, 600, 0))).toBe(false);
  });

  it('does not load from the middle of a long list', () => {
    expect(shouldAutoLoadMore(metrics(5000, 600, 2000))).toBe(false);
  });

  it('loads once within the threshold of the bottom', () => {
    // 5000 - 4300 - 600 = 100px remaining, inside the 200px default.
    expect(shouldAutoLoadMore(metrics(5000, 600, 4300))).toBe(true);
  });

  it('does not load just outside the threshold', () => {
    // 5000 - 4150 - 600 = 250px remaining.
    expect(shouldAutoLoadMore(metrics(5000, 600, 4150))).toBe(false);
  });

  it('loads at the exact bottom', () => {
    expect(shouldAutoLoadMore(metrics(5000, 600, 4400))).toBe(true);
  });

  it('honours a custom threshold', () => {
    expect(shouldAutoLoadMore(metrics(5000, 600, 4000), 500)).toBe(true);
    expect(shouldAutoLoadMore(metrics(5000, 600, 4000), 100)).toBe(false);
  });
});
