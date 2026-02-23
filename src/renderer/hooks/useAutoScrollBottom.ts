import { useCallback, useEffect, useRef } from 'react';

/**
 * Options for the auto-scroll hook.
 */
interface UseAutoScrollBottomOptions {
  /**
   * Threshold in pixels from bottom to consider "at bottom".
   * Default: 100px (generous threshold for better UX)
   */
  threshold?: number;

  /**
   * Smooth scroll duration in milliseconds.
   * Default: 300ms
   */
  smoothDuration?: number;

  /**
   * Whether auto-scroll is enabled.
   * Default: true
   */
  enabled?: boolean;

  /**
   * Scroll behavior used for automatic follow when content updates.
   * Default: 'smooth'
   */
  autoBehavior?: ScrollBehavior;

  /**
   * Whether auto-scroll is temporarily disabled (e.g., during navigation).
   * Unlike enabled, this is for transient disabling during specific operations.
   * Default: false
   */
  disabled?: boolean;

  /**
   * Optional external scroll container ref. If provided, the hook will use this
   * ref instead of creating its own. Useful when the ref needs to be shared
   * with other hooks (e.g., navigation coordinator).
   */
  externalRef?: React.RefObject<HTMLDivElement>;

  /**
   * When this value changes, reset isAtBottom state to true.
   * Use for tab/session changes to ensure new content scrolls to bottom.
   */
  resetKey?: string | null;
}

/**
 * Return type for the auto-scroll hook.
 */
interface UseAutoScrollBottomReturn {
  /**
   * Ref to attach to the scroll container element.
   */
  scrollContainerRef: React.RefObject<HTMLDivElement>;

  /**
   * Get whether the user is currently at the bottom of the scroll container.
   * Returns a function to avoid accessing ref.current during render.
   */
  getIsAtBottom: () => boolean;

  /**
   * Manually scroll to bottom with smooth animation.
   */
  scrollToBottom: (behavior?: ScrollBehavior) => void;

  /**
   * Check and update the isAtBottom state.
   * Call this after content changes if needed.
   */
  checkIsAtBottom: () => boolean;
}

export function isNearBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  threshold: number
): boolean {
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
  return distanceFromBottom <= threshold;
}

/**
 * Custom hook for managing auto-scroll-to-bottom behavior in chat-like interfaces.
 *
 * Features:
 * - Tracks whether user is at the bottom of the scroll container
 * - Automatically scrolls to bottom when content changes (if user was at bottom)
 * - Smooth scrolling animation
 * - Respects user's scroll position (doesn't force scroll if user scrolled up)
 *
 * @param dependencies - Array of dependencies that trigger scroll check (e.g., conversation items)
 * @param options - Configuration options
 * @returns Scroll management utilities
 *
 * @example
 * ```tsx
 * const { scrollContainerRef, isAtBottom, scrollToBottom } = useAutoScrollBottom(
 *   [conversation?.items.length],
 *   { threshold: 100 }
 * );
 *
 * return (
 *   <div ref={scrollContainerRef} className="overflow-y-auto">
 *     {items.map(renderItem)}
 *   </div>
 * );
 * ```
 */
export function useAutoScrollBottom(
  dependencies: unknown[],
  options: UseAutoScrollBottomOptions = {}
): UseAutoScrollBottomReturn {
  const {
    threshold = 100,
    smoothDuration = 300,
    enabled = true,
    autoBehavior = 'smooth',
    disabled = false,
    externalRef,
    resetKey,
  } = options;

  // Use external ref if provided, otherwise create our own
  const internalRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = externalRef ?? internalRef;

  const isAtBottomRef = useRef(true); // Start assuming at bottom
  const wasAtBottomBeforeUpdateRef = useRef(true);
  const isScrollingRef = useRef(false);
  // Track disabled state in ref for checking inside RAF callbacks
  const disabledRef = useRef(disabled);
  // Track resetKey to detect changes
  const prevResetKeyRef = useRef(resetKey);
  // Set true when resetKey changes; consumed by the content effect to force scroll on first load
  const needsInitialScrollRef = useRef(false);

  /**
   * Check if the scroll container is at the bottom.
   */
  const checkIsAtBottom = useCallback((): boolean => {
    const container = scrollContainerRef.current;
    if (!container) return true;

    const { scrollTop, scrollHeight, clientHeight } = container;
    return isNearBottom(scrollTop, scrollHeight, clientHeight, threshold);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scrollContainerRef is a ref, stable across renders
  }, [threshold]);

  /**
   * Scroll to bottom with smooth animation.
   */
  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      const container = scrollContainerRef.current;
      if (!container) return;

      // Prevent scroll event handler from updating isAtBottom during programmatic scroll
      isScrollingRef.current = true;

      const targetScrollTop = container.scrollHeight - container.clientHeight;

      if (behavior === 'smooth') {
        // Use native smooth scrolling
        container.scrollTo({
          top: targetScrollTop,
          behavior: 'smooth',
        });

        // Reset flag after animation completes
        setTimeout(() => {
          isScrollingRef.current = false;
          isAtBottomRef.current = true;
        }, smoothDuration);
      } else {
        container.scrollTop = targetScrollTop;
        isScrollingRef.current = false;
        isAtBottomRef.current = true;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scrollContainerRef is a ref, stable across renders
    [smoothDuration]
  );

  /**
   * Handle scroll events to track isAtBottom state.
   */
  const handleScroll = useCallback(() => {
    // Ignore scroll events during programmatic scrolling
    if (isScrollingRef.current) return;

    isAtBottomRef.current = checkIsAtBottom();
  }, [checkIsAtBottom]);

  /**
   * Set up scroll event listener.
   */
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    container.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scrollContainerRef is a ref, stable across renders
  }, [handleScroll]);

  /**
   * Before content updates, remember if we were at bottom.
   */
  useEffect(() => {
    wasAtBottomBeforeUpdateRef.current = isAtBottomRef.current;
  });

  // Keep disabledRef in sync with disabled prop
  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  // Reset isAtBottom state when resetKey changes (e.g., tab/session switch).
  // Sets needsInitialScrollRef so the content effect scrolls to bottom on first load.
  useEffect(() => {
    if (resetKey !== prevResetKeyRef.current) {
      isAtBottomRef.current = true;
      wasAtBottomBeforeUpdateRef.current = true;
      prevResetKeyRef.current = resetKey;
      needsInitialScrollRef.current = true;
    }
  }, [resetKey]);

  /**
   * After content updates (dependencies change), scroll to bottom if:
   * - User was already near the bottom before the update, OR
   * - This is the first load after a tab/session switch (needsInitialScrollRef)
   * Uses double-RAF + cleanup so React StrictMode's double-invoke doesn't fire twice.
   */
  useEffect(() => {
    // Skip if disabled (e.g., during navigation) or not enabled
    if (!enabled || disabled) return;

    let id1 = 0;
    let id2 = 0;

    id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => {
        // Re-check disabled state — navigation may have started between effect and RAF
        if (disabledRef.current) return;

        const shouldScroll = needsInitialScrollRef.current || wasAtBottomBeforeUpdateRef.current;
        if (shouldScroll) {
          needsInitialScrollRef.current = false;
          scrollToBottom(autoBehavior);
        }
      });
    });

    return () => {
      cancelAnimationFrame(id1);
      cancelAnimationFrame(id2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Dynamic dependencies array is intentional design
  }, [...dependencies, enabled, disabled, autoBehavior, scrollToBottom]);

  /**
   * Getter function for isAtBottom to avoid accessing ref.current during render.
   */
  const getIsAtBottom = useCallback((): boolean => {
    return isAtBottomRef.current;
  }, []);

  return {
    scrollContainerRef,
    getIsAtBottom,
    scrollToBottom,
    checkIsAtBottom,
  };
}
