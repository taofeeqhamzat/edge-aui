/**
 * Coordinate and Scroll Normalization Utilities
 * Implements canonical normalization contracts from docs/testbed/prd.md Section 11 & Stage 4.2.
 */

/**
 * Clamps a number to the given bounds [min, max].
 */
export function clamp(value: number, min = 0, max = 1): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Returns a monotonic millisecond timestamp (relative to navigation start).
 * Uses performance.now() where available, falling back to Date.now().
 *
 * This clock must NOT be written into a persisted trace record: it resets to zero on
 * every navigation, so two records from different page loads are not comparable.
 * Use `getWallClockTimestamp()` for anything that is exported or stored.
 */
export function getMonotonicTimestamp(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

/** Wall-clock (epoch) anchor for the active session, in milliseconds. */
let sessionEpochAnchorMs: number | null = null;

/** Monotonic reading captured at the moment the anchor was established. */
let sessionMonotonicAnchorMs: number | null = null;

/**
 * Anchors the canonical trace clock to a session.
 *
 * Called by `sessionManager.startSession`. The anchor pairs an epoch timestamp with the
 * monotonic reading taken at the same instant, so every later record can be expressed on
 * the epoch timeline while still advancing monotonically.
 */
export function setSessionEpochAnchor(epochMs: number, monotonicMs: number): void {
  sessionEpochAnchorMs = epochMs;
  sessionMonotonicAnchorMs = monotonicMs;
}

/** Clears the canonical-clock anchor when no session is active. */
export function clearSessionEpochAnchor(): void {
  sessionEpochAnchorMs = null;
  sessionMonotonicAnchorMs = null;
}

/**
 * Returns the canonical trace timestamp in epoch milliseconds.
 *
 * The trace has exactly one clock (schema 1.3.0): epoch milliseconds. `performance.now()`
 * is not durable — it restarts at zero on every navigation — so it is not a legal trace
 * timestamp. Anchoring to the session epoch gives the accuracy of a monotonic clock
 * (immune to wall-clock steps and NTP adjustments) with the durability of an epoch clock.
 *
 * Falls back to `Date.now()` when no session anchor exists, which keeps the returned value
 * on the same epoch timeline as an anchored session.
 */
export function getWallClockTimestamp(): number {
  const now = getMonotonicTimestamp();
  if (sessionEpochAnchorMs === null || sessionMonotonicAnchorMs === null) {
    return Date.now();
  }
  return sessionEpochAnchorMs + (now - sessionMonotonicAnchorMs);
}

/**
 * Returns current viewport dimensions safely in browser or headless environments.
 */
export function getViewportDimensions(): { width: number; height: number } {
  if (typeof window !== 'undefined') {
    const width = window.innerWidth || document?.documentElement?.clientWidth || 1920;
    const height = window.innerHeight || document?.documentElement?.clientHeight || 1080;
    return {
      width: Math.max(1, width),
      height: Math.max(1, height)
    };
  }
  return { width: 1920, height: 1080 };
}

/**
 * Normalizes viewport pointer coordinates to [0, 1] relative to viewport dimensions.
 * Formula: x_norm = clamp(clientX / viewportWidth, 0, 1), y_norm = clamp(clientY / viewportHeight, 0, 1).
 */
export function normalizeCoordinates(
  clientX: number,
  clientY: number,
  viewportWidth?: number,
  viewportHeight?: number
): { x: number; y: number } {
  const dims = (viewportWidth && viewportHeight && viewportWidth > 0 && viewportHeight > 0)
    ? { width: viewportWidth, height: viewportHeight }
    : getViewportDimensions();

  const x_norm = clientX / dims.width;
  const y_norm = clientY / dims.height;

  return {
    x: clamp(x_norm, 0, 1),
    y: clamp(y_norm, 0, 1)
  };
}

/**
 * Calculates current document scroll position and scrollable bounds.
 */
export function getDocumentScrollBounds(): {
  scrollX: number;
  scrollY: number;
  scrollableWidth: number;
  scrollableHeight: number;
} {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { scrollX: 0, scrollY: 0, scrollableWidth: 0, scrollableHeight: 0 };
  }

  const docEl = document.documentElement;
  const scrollX = window.scrollX ?? window.pageXOffset ?? docEl?.scrollLeft ?? 0;
  const scrollY = window.scrollY ?? window.pageYOffset ?? docEl?.scrollTop ?? 0;

  const viewport = getViewportDimensions();
  const fullWidth = Math.max(docEl?.scrollWidth ?? 0, document.body?.scrollWidth ?? 0, viewport.width);
  const fullHeight = Math.max(docEl?.scrollHeight ?? 0, document.body?.scrollHeight ?? 0, viewport.height);

  const scrollableWidth = Math.max(0, fullWidth - viewport.width);
  const scrollableHeight = Math.max(0, fullHeight - viewport.height);

  return {
    scrollX,
    scrollY,
    scrollableWidth,
    scrollableHeight
  };
}

/**
 * Returns the full observed geometry snapshot (viewport + document) as a single
 * object, so callers never have to fall back to a hard-coded document size.
 * This mirrors the model-preparation contract, where viewport and document
 * dimensions are mandatory inputs to MicroTensor extraction.
 */
export function getGeometrySnapshot(): {
  viewport: { width: number; height: number };
  document: { width: number; height: number; scrollableWidth: number; scrollableHeight: number };
  scrollTopPx: number;
} {
  const bounds = getDocumentScrollBounds();
  const viewport = getViewportDimensions();

  return {
    viewport,
    document: {
      width: bounds.scrollableWidth + viewport.width,
      height: bounds.scrollableHeight + viewport.height,
      scrollableWidth: bounds.scrollableWidth,
      scrollableHeight: bounds.scrollableHeight
    },
    scrollTopPx: bounds.scrollY
  };
}

/**
 * Normalizes document scroll depth to [0, 1].
 * Returns 0 if there is no scrollable distance.
 */
export function normalizeScroll(
  scrollX: number,
  scrollY: number,
  scrollableWidth?: number,
  scrollableHeight?: number
): { scrollX: number; scrollY: number } {
  let sWidth = scrollableWidth;
  let sHeight = scrollableHeight;

  if (sWidth === undefined || sHeight === undefined) {
    const bounds = getDocumentScrollBounds();
    sWidth = bounds.scrollableWidth;
    sHeight = bounds.scrollableHeight;
  }

  const normX = sWidth > 0 ? clamp(scrollX / sWidth, 0, 1) : 0;
  const normY = sHeight > 0 ? clamp(scrollY / sHeight, 0, 1) : 0;

  return {
    scrollX: normX,
    scrollY: normY
  };
}
