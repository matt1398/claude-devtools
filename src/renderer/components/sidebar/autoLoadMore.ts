/**
 * Auto-paging gate for the sidebar session list.
 *
 * Lives in its own module rather than alongside the component so it can be unit
 * tested without exporting a non-component from a component file.
 */

/** How close to the bottom the user must actually be before auto-paging. */
export const LOAD_MORE_THRESHOLD_PX = 200;

/**
 * Whether the scroll container is close enough to the bottom to auto-load the
 * next page.
 *
 * Gating on scroll position rather than "is the loader row rendered" is the fix
 * for the sidebar paging itself in and out on a loop: the virtualizer's overscan
 * renders rows past the viewport, so an index check fired whenever the loader row
 * landed in that margin — including immediately after a background refresh.
 *
 * A list that doesn't overflow is entirely visible, so paging IS correct there;
 * otherwise the user must be within the threshold of the true bottom.
 */
export function shouldAutoLoadMore(
  metrics: Pick<HTMLElement, 'scrollHeight' | 'clientHeight' | 'scrollTop'>,
  thresholdPx: number = LOAD_MORE_THRESHOLD_PX
): boolean {
  if (metrics.scrollHeight <= metrics.clientHeight) return true;
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight < thresholdPx;
}
