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
export const TESTBED_FAST_GATE_PATTERNS: Record<string, InterventionType> = {
  'OPEN_FILTERS > APPLY_FILTER': 'highlight_primary_action',
  'NAV_ANALYTICS > OPEN_FILTERS': 'simplify_options',
  'NAV_ANALYTICS > OPEN_FILTERS > APPLY_FILTER': 'highlight_primary_action',
  'SELECT_DATE > OPEN_FILTERS > SELECT_REGION > APPLY_FILTER': 'highlight_primary_action',
  'HOVER_KPI > HOVER_KPI': 'expand_tooltip'
};

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
  conditionId: ExperimentalCondition = currentCondition
): Promise<AdaptiveRuntime> {
  if (currentRuntime && conditionId === currentCondition && currentRuntime.isRunning()) {
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

  const runtime = new AdaptiveRuntime({
    experimentId,
    conditionId,
    // support=1: the deterministic Fast Gate observes each frequent sequence from its
    // first occurrence, so the fast path is exercised inside a single trial. A
    // multi-trial study can raise this without any other change.
    minPatternSupport: 1,
    fastGatePatterns: TESTBED_FAST_GATE_PATTERNS,
    policyConfig: { confidenceThreshold: 0.75, requiredConsecutiveWindows: 2 },
    enableSlowGate: true
  });

  await runtime.start();
  currentRuntime = runtime;
  return runtime;
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
