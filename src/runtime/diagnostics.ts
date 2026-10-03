/**
 * Runtime Diagnostics
 *
 * The assessment (§18.3, §19.3) found that the composed pipeline was never assembled
 * and that the DebugPanel could not show live values because `debugBus` had no
 * publisher. This module both publishes to `debugBus` periodically and exposes a
 * console-accessible handle so the running pipeline can be verified from the browser.
 *
 * It is enabled in development builds and on demand (`?auiDiagnostics=1`), and it is
 * inert in a production build.
 */

import { AdaptiveRuntime } from './adaptiveRuntime';
import { debugBus } from '../debug/debugBus';
import { experimentRecorder } from '../telemetry/recorder';
import { sessionManager } from '../telemetry/session';

export interface RuntimeDiagnosticsHandle {
  status: () => ReturnType<AdaptiveRuntime['getStatus']>;
  counts: () => ReturnType<typeof experimentRecorder.getEventCounts>;
  trace: () => string;
  /** Window-tagged macro sequences available to the PrefixSpan Fast Gate. */
  macroSequences: () => string[][];
  /** The most recent gate evaluation produced per pre-approval policy decision IDs. */
  lastDecision: () => unknown;
  /** Bounded Fast Gate execution counters (F-02). */
  miningCounters: () => ReturnType<AdaptiveRuntime['getMiningCounters']>;
  /** Records discarded by buffer eviction, proving truncation is not silent (F-16). */
  evictionCounters: () => ReturnType<typeof experimentRecorder.getEvictionCounters>;
  /** Granular timing records per stage and side. */
  timingRecords: () => ReturnType<AdaptiveRuntime['getTimingRecords']>;
  /** Summary timing stats aggregated per stage and side. */
  timings: () => ReturnType<AdaptiveRuntime['getTimingSummary']>;
  /** Clear collected timing records and statistics. */
  clearTimings: () => void;
  /** Toggles runtime instrumentation on or off. */
  setInstrumentationEnabled: (enabled: boolean) => void;
  /** Queries whether instrumentation is enabled. */
  isInstrumentationEnabled: () => boolean;
  /** Flushes and settles all pending outcome windows and episodes. */
  flush: () => void;
  /** Starts a clean new trial with fresh session ID and empty recording buffer. */
  startNewTrial: (conditionId?: 'baseline' | 'adaptive') => Promise<void>;
  stop: () => void;
}

let activeHandle: RuntimeDiagnosticsHandle | null = null;

function diagnosticsEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const env = (import.meta as ImportMeta & { env?: { DEV?: boolean; VITE_AUI_DIAGNOSTICS?: string } }).env;
    const params = new URLSearchParams(window.location.search);
    const forced = params.get('auiDiagnostics') === '1' || params.get('auiDiagnostics') === 'true';
    const envForced = env?.VITE_AUI_DIAGNOSTICS === '1' || env?.VITE_AUI_DIAGNOSTICS === 'true';
    return Boolean(env?.DEV) || forced || envForced;
  } catch {
    return false;
  }
}

/**
 * Starts periodic publishing of live pipeline state. Returns a handle that also
 * exposes the current trace as JSON.
 */
export function startRuntimeDiagnostics(
  runtime: AdaptiveRuntime,
  intervalMs = 500
): RuntimeDiagnosticsHandle | null {
  if (!diagnosticsEnabled()) {
    return null;
  }

  const handle: RuntimeDiagnosticsHandle = {
    status: () => runtime.getStatus(),
    counts: () => experimentRecorder.getEventCounts(),
    trace: () => experimentRecorder.exportJSON(),
    macroSequences: () => runtime.getMacroSequences(),
    lastDecision: () => runtime.getLastGateDecision(),
    miningCounters: () => runtime.getMiningCounters(),
    evictionCounters: () => experimentRecorder.getEvictionCounters(),
    timingRecords: () => runtime.getTimingRecords(),
    timings: () => runtime.getTimingSummary(),
    clearTimings: () => runtime.clearTimings(),
    setInstrumentationEnabled: (enabled: boolean) => runtime.setInstrumentationEnabled(enabled),
    isInstrumentationEnabled: () => runtime.isInstrumentationEnabled(),
    flush: () => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('pagehide'));
      }
    },
    startNewTrial: async (conditionId?: 'baseline' | 'adaptive') => {
      const status = runtime.getStatus();
      const cond = conditionId ?? status.conditionId ?? 'adaptive';
      const newSession = sessionManager.startSession({
        experimentId: status.experimentId,
        conditionId: cond
      });
      experimentRecorder.bindSession(newSession);
      experimentRecorder.clear();
      await runtime.resetTrial();
    },
    stop: () => {
      window.clearInterval(timer);
      if (activeHandle === handle) {
        activeHandle = null;
      }
    }
  };

  const timer = window.setInterval(() => {
    const status = runtime.getStatus();
    // `latestMacroSequence` is deliberately NOT written here. It used to be set to
    // `undefined` on every tick, which erased the value the macro stream published and
    // made the panel report "No macro events recorded" while dozens were buffered (F-08).
    debugBus.update({
      workerStatus: status.running ? 'ready' : 'uninitialized',
      stageTimings: runtime.getTimingSummary(),
      runtimeCounters: { ...experimentRecorder.getEventCounts() },
      recorderCounts: { ...experimentRecorder.getEventCounts() },
      evictedRecords: experimentRecorder.getEvictionCounters().total,
      miningCounters: { ...runtime.getMiningCounters() }
    });
  }, intervalMs);

  // Expose a console handle for manual verification and browser-driven assertions.
  (window as Window & { __EDGE_AUI__?: RuntimeDiagnosticsHandle }).__EDGE_AUI__ = handle;
  activeHandle = handle;
  return handle;
}

export function getRuntimeDiagnostics(): RuntimeDiagnosticsHandle | null {
  return activeHandle;
}
