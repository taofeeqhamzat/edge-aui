/**
 * Testbed Boot
 *
 * Single composition root for the target testbed. Replaces the previous boot of the
 * legacy `EdgeAUIFramework` (assessment §4.1 / §25 P0-1).
 *
 * The experimental condition is the one piece of state that must be fixed before the
 * pipeline starts, because it determines whether the actuator is permitted to mutate
 * the DOM. Switching condition therefore rebuilds the runtime between trials, which is
 * the correct experimental boundary.
 */

import { AdaptiveRuntime, AdaptiveRuntimeOptions } from './adaptiveRuntime';
import { ExperimentalCondition } from '../telemetry/events';
import { InterventionType } from '../intervention/types';
import { sessionManager } from '../telemetry/session';
import { experimentRecorder } from '../telemetry/recorder';
import { ResearchCollection } from '../telemetry/collection';
import { debugBus } from '../debug/debugBus';
import { getRuntimeDiagnostics, startRuntimeDiagnostics } from './diagnostics';

export interface BootOptions extends AdaptiveRuntimeOptions {
  conditionId?: ExperimentalCondition;
}

/**
 * Patterns the deterministic Fast Gate may act on.
 *
 * Each key is a macro-symbol sequence; each value is the declared intervention for it.
 * These are the testbed's candidate "known deterministic patterns" for the Fast Gate.
 *
 * The final key is also the task T1 completion path, so the task's own success sequence
 * is a pattern the Fast Gate can recognise deterministically.
 */
import { UiAdapter, DefaultUiAdapter, type UiTaskLifecycleEvent } from '../integration/index';

export const TESTBED_FAST_GATE_PATTERNS: Record<string, InterventionType> = {
  'OPEN_FILTERS > APPLY_FILTER': 'highlight_primary_action',
  'NAV_ANALYTICS > OPEN_FILTERS': 'simplify_options',
  'NAV_ANALYTICS > OPEN_FILTERS > APPLY_FILTER': 'highlight_primary_action',
  'SELECT_DATE > OPEN_FILTERS > SELECT_REGION > APPLY_FILTER': 'highlight_primary_action',
  'HOVER_KPI > HOVER_KPI': 'expand_tooltip'
};

let defaultUiAdapterProvider: (() => UiAdapter) | null = null;

export function registerDefaultUiAdapter(provider: (() => UiAdapter) | null): void {
  defaultUiAdapterProvider = provider;
}

let currentRuntime: AdaptiveRuntime | null = null;
let currentCondition: ExperimentalCondition = 'adaptive';
const experimentId = `exp_${Date.now().toString(36)}`;

export function getExperimentId(): string {
  return experimentId;
}

/**
 * Starts (or restarts) the adaptive runtime for a condition. Idempotent for the same
 * condition; rebuilds when the condition changes.
 */
export async function bootTestbed(
  optionsOrCondition: ExperimentalCondition | BootOptions = currentCondition
): Promise<AdaptiveRuntime> {
  const options: BootOptions =
    typeof optionsOrCondition === 'string'
      ? { conditionId: optionsOrCondition }
      : optionsOrCondition;
  const conditionId = options.conditionId ?? currentCondition;

  if (
    currentRuntime &&
    conditionId === currentCondition &&
    currentRuntime.isRunning() &&
    options.enableInstrumentation === undefined
  ) {
    return currentRuntime;
  }

  if (currentRuntime) {
    currentRuntime.stop();
    currentRuntime = null;
  }

  currentCondition = conditionId;

  // A condition change begins a new trial: clear per-trial buffers but retain the
  // session, so the trace stays attributable to one participant session.
  sessionManager.getActiveSession()
    ? sessionManager.setCondition(conditionId)
    : sessionManager.startSession({ experimentId, conditionId });
  experimentRecorder.clear();

  let enableInstrumentation = options.enableInstrumentation;
  if (enableInstrumentation === undefined && typeof window !== 'undefined') {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('instrumentation') === 'off' || params.get('disable_instrumentation') === 'true') {
        enableInstrumentation = false;
      }
    } catch {
      // Ignore if URLSearchParams is unavailable
    }
  }

  // The resolved adapter is captured because trial completion is wired through the adapter
  // contract, not through the testbed: `src/runtime` must not depend on `src/testbed`
  // (ADR-011, asserted by tests/ui_adapter_contract.test.ts).
  const adapter =
    options.adapter ?? (defaultUiAdapterProvider ? defaultUiAdapterProvider() : new DefaultUiAdapter());

  const runtime = new AdaptiveRuntime({
    experimentId,
    conditionId,
    // support=1: the deterministic Fast Gate observes each frequent sequence from its
    // first occurrence, so the fast path is exercised inside a single trial. A
    // multi-trial study can raise this without any other change.
    minPatternSupport: 1,
    fastGatePatterns: TESTBED_FAST_GATE_PATTERNS,
    policyConfig: { confidenceThreshold: 0.75, requiredConsecutiveWindows: 2 },
    enableSlowGate: true,
    enableInstrumentation,
    ...options,
    // Last, so a spread `adapter: undefined` cannot replace the resolved adapter.
    adapter
  });

  await runtime.start();
  currentRuntime = runtime;

  // Re-point the diagnostics handle at the new runtime. The previous handle closed over the
  // terminated runtime, so after the first condition switch `window.__EDGE_AUI__` reported
  // `running: false` and stale recorder counts while a fresh runtime was in fact running
  // (assessment F-21).
  const previousHandle = getRuntimeDiagnostics();
  if (previousHandle) {
    previousHandle.stop();
    startRuntimeDiagnostics(runtime);
  }

  // Start (or re-point) research collection for this session. Collection is owned by the
  // composition root because it must outlive an individual runtime while the condition
  // switch rebuilds one.
  await startCollectionForSession();
  wireTrialCompletion(adapter);

  return runtime;
}

let currentCollection: ResearchCollection | null = null;
let trialCompletionAdapter: UiAdapter | null = null;
let trialCompletionUnsubscribe: (() => void) | null = null;

/**
 * Points collection at the active session and schedules periodic local persistence.
 *
 * Idempotent per session: a condition switch retains the same session, so the existing
 * collection instance is reused rather than opening a second one.
 */
async function startCollectionForSession(): Promise<void> {
  const sessionId = experimentRecorder.getSessionId();
  if (currentCollection && currentCollection.getStatus().currentSessionId === sessionId) {
    return;
  }

  if (!currentCollection) {
    currentCollection = new ResearchCollection();
  }

  await currentCollection.beginSession();
  currentCollection.startPeriodicFlush();
  publishCollectionStatus();
}

/** Mirrors collection state into the debug bus so the panel can show it. */
export function publishCollectionStatus(): void {
  if (!currentCollection) return;
  const status = currentCollection.getStatus();
  debugBus.update({
    collectionState: status.state,
    collectionDetail: {
      configured: status.configured,
      durable: status.durable,
      mode: status.mode,
      uploadAttempts: status.uploadAttempts,
      lastError: status.lastError,
      recoverableSessionId: status.recoverableSessionId,
      recoverableReason: status.recoverableReason
    }
  });
}

export function getCollection(): ResearchCollection | null {
  return currentCollection;
}

/**
 * Uploads a finished trial and rotates to a fresh session for the next one.
 *
 * Two facts force this shape:
 *
 * 1. `research_sessions.session_id` is the primary key and the client inserts with
 *    `resolution=ignore-duplicates` — the anon role holds no `SELECT`, so an upsert is not
 *    available. Two trials sharing a session id therefore cannot both be stored: the second
 *    insert is discarded as a duplicate while the panel still reports `uploaded`. Rotation is
 *    what makes "one stored row per trial" true rather than merely reported.
 * 2. `experimentRecorder.clear()` runs at every condition switch, so a trace already covers
 *    exactly one trial. Rotation matches the store to the trace instead of aggregating across
 *    trials that the trace no longer contains.
 *
 * The finished trial is written to IndexedDB inside `completeSession()` *before* the upload is
 * attempted, so a failed upload still leaves a retrievable local record under its own id.
 */
async function closeTrial(): Promise<void> {
  if (!currentCollection) return;

  await currentCollection.completeSession();
  publishCollectionStatus();

  const rotated = sessionManager.startSession({
    experimentId,
    conditionId: currentCondition
  });
  if (currentRuntime) {
    currentRuntime.rebindSession(rotated);
  } else {
    experimentRecorder.bindSession(rotated);
  }
  experimentRecorder.clear();

  // Register the rotated session in the local store so its own write-ahead has a record.
  await currentCollection.beginSession();
  publishCollectionStatus();
}

/**
 * Closes the trial when its task reaches a terminal state.
 *
 * `task_complete` and `task_abandon` are both terminal. An abandoned trial is a real research
 * outcome — `ABANDON` is in the outcome vocabulary — and leaving it open would fold its events
 * into the next trial's trace.
 *
 * Reached through `adapter.onTaskLifecycle` rather than the testbed's task manager: `src/runtime`
 * is forbidden from importing `src/testbed` (ADR-011), and the adapter is the contract that keeps
 * the pipeline host-agnostic. An adapter that does not expose task lifecycle (such as
 * `DefaultUiAdapter`) is left unwired, which is correct for a host with no task model.
 *
 * Ordering is significant. `AdaptiveRuntime.start()` subscribes to the same lifecycle before this
 * runs, so the terminal task event is already inside the trace when the snapshot is taken.
 * Subscribing earlier would upload a trace missing its own ending. The same reasoning is why the
 * adapter is tracked: re-subscribing on a condition switch would close every trial twice.
 */
function wireTrialCompletion(adapter: UiAdapter): void {
  if (trialCompletionAdapter === adapter) return;

  trialCompletionUnsubscribe?.();
  trialCompletionAdapter = adapter;
  trialCompletionUnsubscribe =
    adapter.onTaskLifecycle?.((event: UiTaskLifecycleEvent) => {
      if (event.type !== 'task_complete' && event.type !== 'task_abandon') return;
      void closeTrial();
    }) ?? null;
}

export function getRuntime(): AdaptiveRuntime | null {
  return currentRuntime;
}

export function getCondition(): ExperimentalCondition {
  return currentCondition;
}

/**
 * Switches the experimental condition and restarts the pipeline. Returns the new
 * runtime. Used by the trial controls; equivalent to starting the next trial.
 */
export async function switchCondition(
  conditionId: ExperimentalCondition
): Promise<AdaptiveRuntime> {
  return bootTestbed(conditionId);
}

export function stopTestbed(): void {
  currentRuntime?.stop();
  currentRuntime = null;
}
