/**
 * Testbed Supported-Device Rule
 *
 * The study records mouse/pointer dynamics. Touch and mobile interaction are outside the
 * supported modality, so the testbed must decide whether a visit is allowed *before* the
 * composition root starts a session or the runtime starts observing.
 *
 * This module is deliberately pure and outside `src/telemetry`: the gate is not a
 * behavioural-collection feature, and a blocked visit must never load the collection path.
 *
 * The rule is a capability/modality rule, never a viewport rule. Width and orientation are
 * not inputs, so resizing a desktop window or rotating a device cannot change the verdict
 * by itself.
 */

export interface DeviceEnvironment {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  /** `navigator.userAgentData.mobile`, when the browser exposes it. */
  mobileHint: boolean;
  /** `(any-pointer: fine)` — some pointer can hover and point precisely. */
  finePointer: boolean;
  /** `(pointer: coarse)` — the primary pointer is coarse (typically touch). */
  coarsePointer: boolean;
  /** `(hover: none)` — the primary input cannot hover. */
  noHover: boolean;
  /** Any touch capability was reported, even if a mouse is also present. */
  touchCapable: boolean;
}

export type DeviceBlockReason =
  | 'mobile-device'
  | 'touch-only'
  | 'coarse-pointer'
  | 'no-hover'
  | 'no-fine-pointer';

export type DeviceSupportVerdict =
  | { supported: true }
  | { supported: false; reason: DeviceBlockReason };

/**
 * Mobile/tablet UA tokens. `Mobile` is present in phone UAs; tablets are included by name
 * because some Android tablets do not carry `Mobile`.
 */
const MOBILE_USER_AGENT =
  /(Android|iPhone|iPad|iPod|Mobile|Tablet|Kindle|Silk|PlayBook|Windows Phone|IEMobile|Opera Mini|webOS|BlackBerry)/i;

/**
 * A visit is supported only when none of these hold:
 *
 * 1. It is a mobile device context (UA, `userAgentData.mobile`, or iPadOS desktop UA).
 * 2. No fine pointer exists at all.
 * 3. The primary pointer is coarse.
 * 4. The primary input cannot hover.
 *
 * A touchscreen laptop remains supported when it has a fine, hover-capable pointer: the
 * interaction modality is mouse, not touch. A touch-only device fails 2–4.
 */
export function evaluateDeviceSupport(env: DeviceEnvironment): DeviceSupportVerdict {
  if (isMobileContext(env)) {
    return { supported: false, reason: 'mobile-device' };
  }
  if (!env.finePointer) {
    return { supported: false, reason: env.touchCapable ? 'touch-only' : 'no-fine-pointer' };
  }
  if (env.coarsePointer) {
    return { supported: false, reason: 'coarse-pointer' };
  }
  if (env.noHover) {
    return { supported: false, reason: 'no-hover' };
  }
  return { supported: true };
}

function isMobileContext(env: DeviceEnvironment): boolean {
  if (env.mobileHint) return true;
  // iPadOS reports a desktop Macintosh UA; the touch-point count is the distinguishing signal.
  if (env.platform === 'MacIntel' && env.maxTouchPoints > 1) return true;
  return MOBILE_USER_AGENT.test(env.userAgent);
}

/** Reads the browser capability signals once, at entry and on a device-change event. */
export function readDeviceEnvironment(win: Window): DeviceEnvironment {
  const nav = win.navigator as Navigator & {
    userAgentData?: { mobile?: boolean };
    platform?: string;
  };
  const maxTouchPoints =
    typeof nav.maxTouchPoints === 'number' ? nav.maxTouchPoints : 0;

  return {
    userAgent: nav.userAgent ?? '',
    platform: nav.platform ?? '',
    maxTouchPoints,
    mobileHint: nav.userAgentData?.mobile === true,
    finePointer: matches(win, '(any-pointer: fine)'),
    coarsePointer: matches(win, '(pointer: coarse)'),
    noHover: matches(win, '(hover: none)'),
    touchCapable: maxTouchPoints > 0 || 'ontouchstart' in win
  };
}

function matches(win: Window, query: string): boolean {
  if (typeof win.matchMedia !== 'function') return false;
  try {
    return win.matchMedia(query).matches;
  } catch {
    return false;
  }
}
