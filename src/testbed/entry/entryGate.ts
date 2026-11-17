/**
 * Testbed Entry Gate
 *
 * Installed by the composition root *before* React mounts and before `bootRuntime()` starts
 * the session, observer and collection pipeline. This is the pre-session boundary: a blocked
 * visit never reaches `sessionManager.startSession`, `defaultTelemetryObserver.start()` or
 * `ResearchCollection.beginSession()`.
 *
 * The blocked notice is plain DOM and imports nothing from the telemetry or runtime modules.
 *
 * The verdict is re-evaluated on media-query changes, resize, orientation and navigation
 * events because the restriction must not be bypassable by a responsive layout change, an
 * orientation change, or direct navigation to a testbed route.
 */

import {
  evaluateDeviceSupport,
  readDeviceEnvironment
} from './deviceSupport';

export const UNSUPPORTED_DEVICE_MESSAGE =
  'Explore this study on a desktop or laptop using a mouse/pointer device; touch-based participation is not supported.';

const NOTICE_ATTRIBUTE = 'data-testbed-entry-gate';
const CAPABILITY_QUERIES = [
  '(any-pointer: fine)',
  '(pointer: coarse)',
  '(hover: none)'
] as const;
const NAVIGATION_EVENTS = [
  'resize',
  'orientationchange',
  'popstate',
  'hashchange',
  'pageshow'
] as const;

export interface TestbedGateOptions {
  root: HTMLElement;
  /** Injected in tests; defaults to the real browser window. */
  win?: Window;
  doc?: Document;
  /** Mounts the testbed. Called once per supported transition. */
  onAccessGranted: () => void;
  /** Tears down the mounted testbed after a supported device becomes unsupported. */
  onAccessRevoked?: () => void;
}

/**
 * Installs the gate. Returns a disposer that removes the change listeners.
 *
 * Idempotent per transition: repeated change events while supported do not remount, and
 * repeated events while blocked do not create duplicate notices.
 */
export function installTestbedGate(options: TestbedGateOptions): () => void {
  const win = options.win ?? window;
  const doc = options.doc ?? win.document;
  let granted = false;
  let disposed = false;

  const apply = (): void => {
    if (disposed) return;
    const verdict = evaluateDeviceSupport(readDeviceEnvironment(win));

    if (verdict.supported) {
      if (granted) return;
      granted = true;
      options.root.replaceChildren();
      options.onAccessGranted();
      return;
    }

    if (granted) {
      granted = false;
      options.onAccessRevoked?.();
    }
    renderNotice(options.root, doc);
  };

  apply();
  const stopObserving = observeDeviceChanges(win, apply);

  return () => {
    disposed = true;
    stopObserving();
  };
}

/** Subscribes to every signal that can change the verdict. */
function observeDeviceChanges(win: Window, onChange: () => void): () => void {
  const cleanups: Array<() => void> = [];

  if (typeof win.matchMedia === 'function') {
    for (const query of CAPABILITY_QUERIES) {
      const list = win.matchMedia(query);
      if (typeof list.addEventListener === 'function') {
        list.addEventListener('change', onChange);
        cleanups.push(() => list.removeEventListener('change', onChange));
      } else if (typeof list.addListener === 'function') {
        // Safari < 14 and other older implementations.
        list.addListener(onChange);
        cleanups.push(() => list.removeListener(onChange));
      }
    }
  }

  for (const event of NAVIGATION_EVENTS) {
    win.addEventListener(event, onChange);
    cleanups.push(() => win.removeEventListener(event, onChange));
  }

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

/** One short paragraph, no testbed chrome, no interactive controls. */
function renderNotice(root: HTMLElement, doc: Document): void {
  if (root.querySelector(`[${NOTICE_ATTRIBUTE}]`)) return;

  const notice = doc.createElement('section');
  notice.className = 'testbed-entry-gate';
  notice.setAttribute(NOTICE_ATTRIBUTE, 'unsupported-device');
  notice.setAttribute('role', 'note');

  const message = doc.createElement('p');
  message.className = 'testbed-entry-gate-message';
  message.textContent = UNSUPPORTED_DEVICE_MESSAGE;
  notice.appendChild(message);

  root.replaceChildren(notice);
}
