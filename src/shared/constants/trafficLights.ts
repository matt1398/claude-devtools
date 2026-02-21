/**
 * Shared macOS traffic-light geometry.
 *
 * Keep this as the single source of truth for both:
 * - main process native button positioning
 * - renderer process left padding reservation
 */

/** IPC event channel emitted by main when zoom changes */
export const WINDOW_ZOOM_FACTOR_CHANGED_CHANNEL = 'window:zoom-factor-changed';

/** Base traffic-light origin at 100% zoom (native coordinates) */
const MACOS_TRAFFIC_LIGHT_BASE_POSITION = { x: 12, y: 12 } as const;

/** Header row height used by SidebarHeader and TabBar */
export const HEADER_ROW1_HEIGHT = 40;

/** Native button-group frame height (used to vertically center in header row) */
const MACOS_TRAFFIC_LIGHT_GROUP_HEIGHT = 16;

/** Approximate total width of the 3 traffic lights group in native px */
const MACOS_TRAFFIC_LIGHT_GROUP_WIDTH = 52;

/** Visual gap between traffic lights and first left-aligned content */
const MACOS_TRAFFIC_LIGHT_CONTENT_GAP = 16;

const MIN_ZOOM_FACTOR = 0.25;

function sanitizeZoomFactor(zoomFactor: number): number {
  if (!Number.isFinite(zoomFactor) || zoomFactor <= 0) {
    return 1;
  }
  return Math.max(zoomFactor, MIN_ZOOM_FACTOR);
}

/**
 * Native traffic-light position for the given zoom.
 * Uses linear scaling to keep vertical alignment with zoomed title rows.
 */
export function getTrafficLightPositionForZoom(
  zoomFactor: number
): Readonly<{ x: number; y: number }> {
  const zoom = sanitizeZoomFactor(zoomFactor);
  return {
    x: Math.round(MACOS_TRAFFIC_LIGHT_BASE_POSITION.x * zoom),
    y: Math.round((HEADER_ROW1_HEIGHT * zoom - MACOS_TRAFFIC_LIGHT_GROUP_HEIGHT) / 2),
  };
}

/**
 * CSS left padding (in CSS px) needed to avoid overlap with native buttons.
 * Produces a stable physical gap between traffic lights and content at any zoom.
 */
export function getTrafficLightPaddingForZoom(zoomFactor: number): number {
  const zoom = sanitizeZoomFactor(zoomFactor);
  return Math.ceil(
    MACOS_TRAFFIC_LIGHT_BASE_POSITION.x +
      (MACOS_TRAFFIC_LIGHT_GROUP_WIDTH + MACOS_TRAFFIC_LIGHT_CONTENT_GAP) / zoom
  );
}
