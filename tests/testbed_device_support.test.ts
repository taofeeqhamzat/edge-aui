/**
 * Testbed supported-device gate.
 *
 * These tests pin the two behaviours the study depends on:
 * 1. The detection rule is a capability/modality rule, not a viewport rule.
 * 2. The gate runs before anything that creates a participant session or a trace.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  evaluateDeviceSupport,
  readDeviceEnvironment,
  type DeviceEnvironment
} from '../src/testbed/entry/deviceSupport';
import {
  installTestbedGate,
  UNSUPPORTED_DEVICE_MESSAGE
} from '../src/testbed/entry/entryGate';
import { sessionManager } from '../src/telemetry/session';
import { taskManager } from '../src/testbed/tasks/taskManager';

function environment(overrides: Partial<DeviceEnvironment> = {}): DeviceEnvironment {
  return {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    platform: 'Win32',
    maxTouchPoints: 0,
    mobileHint: false,
    finePointer: true,
    coarsePointer: false,
    noHover: false,
    touchCapable: false,
    ...overrides
  };
}

interface FakeWindowHarness {
  win: Window;
  setMedia: (query: string, matches: boolean) => void;
  dispatch: (event: string) => void;
}

function createFakeWindow(): FakeWindowHarness {
  const media = new Map<string, boolean>([
    ['(any-pointer: fine)', true],
    ['(pointer: coarse)', false],
    ['(hover: none)', false]
  ]);
  const mediaListeners = new Map<string, Set<() => void>>();
  const windowListeners = new Map<string, Set<() => void>>();

  const win = {
    navigator: {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      platform: 'MacIntel',
      maxTouchPoints: 0,
      userAgentData: { mobile: false }
    },
    matchMedia: (query: string) => ({
      matches: media.get(query) ?? false,
      addEventListener: (_type: string, listener: () => void) => {
        const listeners = mediaListeners.get(query) ?? new Set();
        listeners.add(listener);
        mediaListeners.set(query, listeners);
      },
      removeEventListener: (_type: string, listener: () => void) => {
        mediaListeners.get(query)?.delete(listener);
      }
    }),
    addEventListener: (type: string, listener: () => void) => {
      const listeners = windowListeners.get(type) ?? new Set();
      listeners.add(listener);
      windowListeners.set(type, listeners);
    },
    removeEventListener: (type: string, listener: () => void) => {
      windowListeners.get(type)?.delete(listener);
    }
  } as unknown as Window;

  return {
    win,
    setMedia: (query, matches) => {
      media.set(query, matches);
      for (const listener of mediaListeners.get(query) ?? []) listener();
    },
    dispatch: (event) => {
      for (const listener of windowListeners.get(event) ?? []) listener();
    }
  };
}

beforeEach(() => {
  sessionManager.resetSession();
  taskManager.resetTask();
});

describe('device support rule', () => {
  it('supports a desktop browser with a fine, hover-capable mouse pointer', () => {
    expect(evaluateDeviceSupport(environment())).toEqual({ supported: true });
  });

  it('does not treat a narrow layout as mobile: width is not an input', () => {
    // There is deliberately no viewport field. A 320 px desktop window is still a desktop.
    expect(evaluateDeviceSupport(environment())).toEqual({ supported: true });
  });

  it('blocks a mobile device context before considering pointer capabilities', () => {
    const verdict = evaluateDeviceSupport(
      environment({
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        platform: 'iPhone',
        maxTouchPoints: 5,
        finePointer: true,
        coarsePointer: false,
        noHover: false,
        touchCapable: true
      })
    );

    expect(verdict).toEqual({ supported: false, reason: 'mobile-device' });
  });

  it('blocks iPadOS desktop-mode user agents via the touch-point signal', () => {
    const verdict = evaluateDeviceSupport(
      environment({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        platform: 'MacIntel',
        maxTouchPoints: 5,
        finePointer: true,
        touchCapable: true
      })
    );

    expect(verdict).toEqual({ supported: false, reason: 'mobile-device' });
  });

  it('blocks a touch-only desktop-class device with no fine pointer', () => {
    const verdict = evaluateDeviceSupport(
      environment({
        maxTouchPoints: 10,
        finePointer: false,
        coarsePointer: true,
        noHover: true,
        touchCapable: true
      })
    );

    expect(verdict).toEqual({ supported: false, reason: 'touch-only' });
  });

  it('blocks when the primary pointer is coarse even if a fine pointer exists', () => {
    const verdict = evaluateDeviceSupport(
      environment({
        maxTouchPoints: 10,
        coarsePointer: true,
        touchCapable: true
      })
    );

    expect(verdict).toEqual({ supported: false, reason: 'coarse-pointer' });
  });

  it('blocks when the primary input cannot hover', () => {
    const verdict = evaluateDeviceSupport(
      environment({
        maxTouchPoints: 10,
        noHover: true,
        touchCapable: true
      })
    );

    expect(verdict).toEqual({ supported: false, reason: 'no-hover' });
  });

  it('keeps a touchscreen laptop usable with its mouse pointer', () => {
    // Requirement 5: a normal desktop/laptop with a fine, hover-capable pointer keeps access.
    // maxTouchPoints alone is capability, not the interaction modality.
    expect(
      evaluateDeviceSupport(
        environment({
          maxTouchPoints: 10,
          finePointer: true,
          coarsePointer: false,
          noHover: false,
          touchCapable: true
        })
      )
    ).toEqual({ supported: true });
  });
});

describe('device environment reading', () => {
  it('reads the browser signals used by the rule', () => {
    const { win } = createFakeWindow();
    const env = readDeviceEnvironment(win);

    expect(env.userAgent).toContain('Macintosh');
    expect(env.platform).toBe('MacIntel');
    expect(env.maxTouchPoints).toBe(0);
    expect(env.mobileHint).toBe(false);
    expect(env.finePointer).toBe(true);
    expect(env.coarsePointer).toBe(false);
    expect(env.noHover).toBe(false);
  });
});

describe('pre-session entry gate', () => {
  it('renders the one-line notice instead of the testbed for a blocked visit', () => {
    sessionManager.resetSession();
    taskManager.resetTask();

    const { win } = createFakeWindow();
    (win.navigator as unknown as { userAgent: string }).userAgent =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
    const root = document.createElement('div');
    const onAccessGranted = vi.fn();

    installTestbedGate({ root, win, doc: document, onAccessGranted });

    expect(onAccessGranted).not.toHaveBeenCalled();
    expect(root.textContent).toBe(UNSUPPORTED_DEVICE_MESSAGE);
    expect(root.querySelector('.app-container')).toBeNull();
    expect(sessionManager.isSessionActive()).toBe(false);
    expect(taskManager.getState().status).toBe('Idle');
  });

  it('never creates a participant session when the gate refuses access', () => {
    // The real composition root starts the session inside its granted callback. Refusing to
    // invoke that callback is therefore the pre-session boundary, not a UI-only hide.
    sessionManager.resetSession();

    const { win } = createFakeWindow();
    (win.navigator as unknown as { maxTouchPoints: number }).maxTouchPoints = 5;
    win.matchMedia = ((query: string) => ({
      matches: query === '(pointer: coarse)' || query === '(hover: none)' || query !== '(any-pointer: fine)',
      addEventListener: () => {},
      removeEventListener: () => {}
    })) as unknown as Window['matchMedia'];

    const root = document.createElement('div');
    installTestbedGate({
      root,
      win,
      doc: document,
      onAccessGranted: () => {
        sessionManager.startSession({ experimentId: 'exp-test', conditionId: 'adaptive' });
      }
    });

    expect(sessionManager.getActiveSession()).toBeNull();
    expect(root.textContent).toBe(UNSUPPORTED_DEVICE_MESSAGE);
  });

  it('mounts the testbed for a supported desktop visitor', () => {
    const { win } = createFakeWindow();
    const root = document.createElement('div');
    const onAccessGranted = vi.fn();

    installTestbedGate({ root, win, doc: document, onAccessGranted });

    expect(onAccessGranted).toHaveBeenCalledTimes(1);
    expect(root.textContent).toBe('');
  });

  it('re-checks on orientation and resize changes without allowing a bypass', () => {
    const { win, setMedia, dispatch } = createFakeWindow();
    const root = document.createElement('div');
    const onAccessGranted = vi.fn();
    const onAccessRevoked = vi.fn();

    installTestbedGate({ root, win, doc: document, onAccessGranted, onAccessRevoked });
    expect(onAccessGranted).toHaveBeenCalledTimes(1);

    setMedia('(pointer: coarse)', true);
    setMedia('(hover: none)', true);
    dispatch('orientationchange');
    dispatch('resize');

    expect(onAccessRevoked).toHaveBeenCalledTimes(1);
    expect(onAccessGranted).toHaveBeenCalledTimes(1);
    expect(root.textContent).toBe(UNSUPPORTED_DEVICE_MESSAGE);
  });

  it('re-checks direct navigation events while blocked', () => {
    const { win, setMedia, dispatch } = createFakeWindow();
    setMedia('(pointer: coarse)', true);
    setMedia('(hover: none)', true);
    const root = document.createElement('div');
    const onAccessGranted = vi.fn();

    installTestbedGate({ root, win, doc: document, onAccessGranted });
    expect(onAccessGranted).not.toHaveBeenCalled();

    setMedia('(pointer: coarse)', false);
    setMedia('(hover: none)', false);
    dispatch('popstate');

    expect(onAccessGranted).toHaveBeenCalledTimes(1);
    expect(root.textContent).toBe('');
  });
});
