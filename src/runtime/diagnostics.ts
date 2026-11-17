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
  /** The resolved condition the runtime actually runs, fixed for the session. */
  condition: () => ReturnType<AdaptiveRuntime['getCondition']>;
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
  /**
   * The exported trace of the most recently completed or abandoned trial, or `null`.
   *
   * Completing a trial rotates the session and clears the recorder, so the live `trace()`
   * becomes the next trial's empty record. Without this snapshot the just-finished trial
   * could only be read back by racing the rotation, which is not an export path.
   */
  lastCompletedTrial: () => string | null;
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
 * Options for the diagnostics handle.
 *
 * `getCompletedTrace` is supplied by the composition point (boot) because the retained
 * completed-trial snapshot belongs to the trial lifecycle, not to the runtime instance.
 */
export interface RuntimeDiagnosticsOptions {
  /** Publishing interval for the debug bus, in milliseconds. */
  intervalMs?: number;
  /** Returns the exported trace of the last completed/abandoned trial. */
  getCompletedTrace?: () => string | null;
}

/**
 * Starts periodic publishing of live pipeline state. Returns a handle that also
 * exposes the current trace as JSON.
 */
export function startRuntimeDiagnostics(
  runtime: AdaptiveRuntime,
  options: RuntimeDiagnosticsOptions = {}
): RuntimeDiagnosticsHandle | null {
  if (!diagnosticsEnabled()) {
    return null;
  }
  const intervalMs = options.intervalMs ?? 500;
  const getCompletedTrace = options.getCompletedTrace ?? (() => null);

  const handle: RuntimeDiagnosticsHandle = {
    status: () => runtime.getStatus(),
    condition: () => runtime.getCondition(),
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
    lastCompletedTrial: () => getCompletedTrace(),
    startNewTrial: async (_requestedCondition?: 'baseline' | 'adaptive') => {
      // The condition is fixed for the participant session. A new trial rotates the session
      // id but keeps the condition the runtime actually runs; accepting the optional argument
      // here would let a console call rewrite the independent variable mid-session.
      const status = runtime.getStatus();
      const newSession = sessionManager.startSession({
        experimentId: status.experimentId,
        conditionId: runtime.getCondition()
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
