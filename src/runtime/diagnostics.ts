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

export interface RuntimeDiagnosticsHandle {
  status: () => ReturnType<AdaptiveRuntime['getStatus']>;
  counts: () => ReturnType<typeof experimentRecorder.getEventCounts>;
  trace: () => string;
  /** Window-tagged macro sequences available to the PrefixSpan Fast Gate. */
  macroSequences: () => string[][];
  /** The most recent gate decision, for live inspection. */
  lastDecision: () => unknown;
  stop: () => void;
}

let activeHandle: RuntimeDiagnosticsHandle | null = null;

function diagnosticsEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const env = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env;
    const forced = new URLSearchParams(window.location.search).get('auiDiagnostics') === '1';
    return Boolean(env?.DEV) || forced;
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
    stop: () => {
      window.clearInterval(timer);
      if (activeHandle === handle) {
        activeHandle = null;
      }
    }
  };

  const timer = window.setInterval(() => {
    const status = runtime.getStatus();
    debugBus.update({
      workerStatus: status.running ? 'ready' : 'uninitialized',
      latestMacroSequence: undefined
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
