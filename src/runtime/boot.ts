/**
 * Runtime Boot
 *
 * Single composition point. Replaces the previous boot of the legacy `EdgeAUIFramework`
 * (assessment §4.1 / §25 P0-1).
 *
 * The experimental condition is the one piece of state that must be fixed before the
 * pipeline starts, because it determines whether the actuator is permitted to mutate
 * the DOM. Switching condition therefore rebuilds the runtime between trials, which is
 * the correct experimental boundary.
 *
 * `src/runtime` must not depend on `src/testbed` (ADR-011). Everything that is application
 * vocabulary or application policy — the UI adapter, the macro mapper, the context
 * encoding, the declared Fast Gate patterns and the outcome→adaptation resolver — is
 * registered by the composition root and consumed here. Framework defaults apply when
 * nothing is registered, so a non-testbed deployment is a configuration change rather than
 * a source edit (Task 20.2).
 */

import { AdaptiveRuntime, AdaptiveRuntimeOptions } from './adaptiveRuntime';
import type { CandidateResolver } from '../intervention/policy';
import { ExperimentalCondition } from '../telemetry/events';
import { InterventionType } from '../intervention/types';
import { sessionManager } from '../telemetry/session';
import { experimentRecorder } from '../telemetry/recorder';
import { ResearchCollection } from '../telemetry/collection';
import { debugBus } from '../debug/debugBus';
import { getRuntimeDiagnostics, startRuntimeDiagnostics } from './diagnostics';
import { UiAdapter, DefaultUiAdapter, type UiTaskLifecycleEvent } from '../integration/index';
import type { MacroMapper } from '../macro/mapper';
import type { SemanticOutcomeDeriver } from '../outcome/semantic';
import type { ContextEncodingConfig } from '../types/contextVector';

export interface BootOptions extends AdaptiveRuntimeOptions {
  conditionId?: ExperimentalCondition;
}

/**
 * Application-supplied defaults for the runtime.
 *
 * One registration replaces what used to be a testbed-shaped boot: every field is
 * application vocabulary or application policy, and none has a framework meaning.
 */
export interface RegisteredRuntimeDefaults {
  /** UI adapter supplying task model, context and action mapping. */
  adapter?: UiAdapter;
  /** Macro symbol vocabulary and event→symbol rules. */
  macroMapper?: MacroMapper;
  /** Route/action/task vocabulary for the R^6 context encoding. */
  contextEncoding?: ContextEncodingConfig;
  /** Declared Fast Gate patterns: macro-symbol sequence → adaptation. */
  fastGatePatterns?: Record<string, InterventionType | Partial<import('../intervention/types').InterventionCommand>>;
  /** Version of the declared pattern set, recorded with predictions. */
  fastGatePatternVersion?: string;
  /** Predicted outcome → candidate adaptation. */
  candidateResolver?: CandidateResolver;
  /** Application semantic outcome derivation (Task 20.4). */
  semanticOutcomes?: SemanticOutcomeDeriver;
  /** Study schedule: trial order and per-task timeouts. */
  experiment?: {
    trialOrder?: string[];
    taskTimeoutsMs?: Record<string, number>;
  };
}

let registeredDefaults: RegisteredRuntimeDefaults = {};

/**
 * Registers application defaults. Merges over any previous registration, so the
 * composition root can register in as many calls as it likes.
 */
export function registerRuntimeDefaults(defaults: RegisteredRuntimeDefaults | null): void {
  registeredDefaults = defaults ? { ...registeredDefaults, ...defaults } : {};
}

export function getRegisteredRuntimeDefaults(): Readonly<RegisteredRuntimeDefaults> {
  return { ...registeredDefaults };
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
export async function bootRuntime(
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
  const adapter = options.adapter ?? registeredDefaults.adapter ?? new DefaultUiAdapter();

  const runtime = new AdaptiveRuntime({
    experimentId,
    conditionId,
    config: registeredDefaults.experiment
      ? { experiment: registeredDefaults.experiment, ...options.config }
      : options.config,
    candidateResolver: registeredDefaults.candidateResolver,
    semanticOutcomes: registeredDefaults.semanticOutcomes,
    macroMapper: registeredDefaults.macroMapper,
    contextEncoding: registeredDefaults.contextEncoding,
    // support=1: the deterministic Fast Gate observes each frequent sequence from its
    // first occurrence, so the fast path is exercised inside a single trial. A
    // multi-trial study can raise this without any other change.
    minPatternSupport: 1,
    fastGatePatterns: registeredDefaults.fastGatePatterns,
    fastGatePatternVersion: registeredDefaults.fastGatePatternVersion,
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
    startRuntimeDiagnostics(runtime, { getCompletedTrace: getLastCompletedTrialTrace });
  }

  // Start (or re-point) research collection for this session. Collection is owned by the
  // composition root because it must outlive an individual runtime while the condition
  // switch rebuilds one.
  await startCollectionForSession();
  wireTrialCompletion(adapter);

  return runtime;
}

let currentCollection: ResearchCollection | null = null;
let trialCompletionUnsubscribe: (() => void) | null = null;

/**
 * The exported trace of the most recently finished trial.
 *
 * `closeTrial()` rotates the session and clears the recorder as soon as a trial reaches a
 * terminal state, so the live recorder stops describing the trial that just ended. Keeping
 * the export here makes the finished trial retrievable through the diagnostics handle
 * instead of forcing a caller to race the rotation. It is cleared when the next trial
 * starts, so "last completed" can never name a different task.
 */
let lastCompletedTrialTrace: string | null = null;

/** Exported trace of the last completed or abandoned trial, or `null`. */
export function getLastCompletedTrialTrace(): string | null {
  return lastCompletedTrialTrace;
}

/** Clears the retained completed-trial snapshot. Used when a new trial begins. */
export function clearLastCompletedTrialTrace(): void {
  lastCompletedTrialTrace = null;
}

/**
 * How long a finished trial keeps observing before it is closed.
 *
 * A trial's last action lands in a window that is still open when the task reaches its
 * terminal state: the buffer emits a window 250 ms settlement delay after the window closes,
 * and the tick loop runs at 125 ms. Ending the stream immediately would therefore settle
 * every window except the one that contains the completing action, and that action's
 * semantic outcome — the export, in TD1 and TD4 — would never be recorded. One window
 * duration plus the settlement delay plus a tick covers it.
 */
const TRIAL_SETTLE_MS = 750;

let trialFinalizePromise: Promise<void> | null = null;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Settles, snapshots and closes the finished trial.
 *
 * Idempotent: concurrent callers share one finalisation.
 */
function finishTrial(): Promise<void> {
  if (!trialFinalizePromise) {
    trialFinalizePromise = (async () => {
      await delay(TRIAL_SETTLE_MS);
      // Declare the stream ended so the last emitted window is labelled now instead of
      // waiting out the idle grace period, then export before `closeTrial()` clears the
      // recorder. The recorder has frozen the terminal task state, so the export still
      // describes this trial even if a reset already moved the adapter back to `Idle`.
      currentRuntime?.endTrialStream();
      lastCompletedTrialTrace = experimentRecorder.exportJSON();
      await closeTrial();
    })()
      .catch((err) => {
        console.error('[Edge-AUI] Failed to finalise the finished trial:', err);
      })
      .finally(() => {
        trialFinalizePromise = null;
      });
  }
  return trialFinalizePromise;
}

/**
 * The in-flight finalisation of a finished trial, or `null` when there is none.
 *
 * Returning `null` rather than a resolved promise matters: a caller that has nothing to wait
 * for must not be suspended, or every trial start would move a microtask later than the
 * interaction that triggered it.
 *
 * Starting, resetting or switching a trial while its predecessor is still settling would
 * fold the old events into the new record (or clear the recorder mid-snapshot). The trial
 * controls await this before crossing the boundary.
 */
export function pendingTrialFinalization(): Promise<void> | null {
  return trialFinalizePromise;
}

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
 * 1. `research_sessions.session_id` is the primary key, so two trials sharing a session id cannot
 *    both be stored: the second insert fails and is treated as an already-stored duplicate. The
 *    panel would go on reporting `uploaded` while the newer trial was never sent. Rotation is
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
 * Ordering is significant, and it is why this re-subscribes on every boot rather than once per
 * adapter. The terminal event must already be inside the trace when the snapshot is taken, so the
 * runtime's own subscription has to run first. A condition switch rebuilds the runtime, and its
 * fresh subscription is appended *after* this one; keeping the old subscription would invert the
 * order and every later trial would be captured without its own ending.
 */
function wireTrialCompletion(adapter: UiAdapter): void {
  trialCompletionUnsubscribe?.();
  trialCompletionUnsubscribe =
    adapter.onTaskLifecycle?.((event: UiTaskLifecycleEvent) => {
      if (event.type === 'task_start') {
        // A new trial must not resolve to the previous trial's export.
        lastCompletedTrialTrace = null;
        return;
      }
      if (event.type !== 'task_complete' && event.type !== 'task_abandon') return;
      // The runtime has already recorded the terminal event. Settlement, snapshot and
      // rotation continue asynchronously; `finalizePendingTrial()` is what the trial
      // controls await before starting the next trial.
      void finishTrial();
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

/**
 * Previous name of `bootRuntime`.
 *
 * Kept so an existing call site keeps working; the composition root uses `bootRuntime`.
 */
export const bootTestbed = bootRuntime;
