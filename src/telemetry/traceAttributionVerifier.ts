/**
 * Trace Attribution and Completeness Verifier
 *
 * Implements Stage 6.3 & Task 10.1 specifications from docs/plan/tasks/6.3.md and
 * model-preparation Phase B Task 10.1, extended by the supervisor-ready deployment brief:
 *
 * Verifies:
 * 1. Strict schema compliance (current version or an explicitly supported legacy version).
 * 2. A single canonical clock, so the record's internal order is reconstructable (F-01).
 * 3. Unbroken correlation IDs across events, windows, predictions, policy and interventions.
 * 4. Task lifecycle completeness against the task definition.
 * 5. Window-to-outcome mapping completeness.
 * 6. Terminal state existence for intervention episodes.
 * 7. Policy-decision presence and attribution for every prediction (F-07).
 * 8. Episode attribution: every applied episode traces back to a prediction (F-05).
 * 9. Baseline condition invariance (zero actuator mutations).
 * 10. Provenance presence, so scripted and participant data can never be conflated (ADR-018).
 */

import {
  EXPERIMENT_TRACE_SCHEMA_VERSION,
  SUPPORTED_EXPERIMENT_TRACE_SCHEMA_VERSIONS,
  TRACE_CLOCK_MODE,
  findOrphanedWindows,
  validateExperimentTrace,
  type SerializableExperimentTrace
} from './traceSchema.js';
import { PIPELINE_CONFIG } from '../config/pipelineConfig';
import { DEFAULT_RUNTIME_CONFIG } from '../config/runtimeConfig';
export type TaskId = 'T1' | 'T2' | 'T3' | string;

export interface ExpectedTaskDefinition {
  id?: string;
  steps: Array<{ stepId: string } | string>;
}

export const KNOWN_TASK_DEFINITIONS: Record<string, ExpectedTaskDefinition> = {
  T1: {
    steps: [
      { stepId: 'T1-1' },
      { stepId: 'T1-2' },
      { stepId: 'T1-3' },
      { stepId: 'T1-4' }
    ]
  },
  T2: {
    steps: [
      { stepId: 'T2-1' },
      { stepId: 'T2-2' }
    ]
  },
  T3: {
    steps: [
      { stepId: 'T3-1' },
      { stepId: 'T3-2' },
      { stepId: 'T3-3' },
      { stepId: 'T3-4' }
    ]
  }
};

export interface TraceCheckResult {
  check: string;
  passed: boolean;
  message?: string;
}

export interface TraceVerificationReport {
  valid: boolean;
  checks: TraceCheckResult[];
}

/**
 * Whether the schema is at or above the version that introduced the canonical contract.
 *
 * The 1.3.0 guarantees (one clock, policy-decision records, prediction attribution,
 * provenance) cannot be applied retroactively to a 1.2.0 or 1.1.0 capture. Demanding them
 * of a legacy record would reject exactly the historical captures this verifier exists to
 * audit — which is how the previous verifier came to pass only on purpose-built fixtures
 * while real traces failed (F-13). Legacy traces are therefore *reported*, not failed.
 */
export function canonicalContractApplies(trace: { schemaVersion?: string }): boolean {
  return (
    typeof trace.schemaVersion === 'string' &&
    trace.schemaVersion.localeCompare(EXPERIMENT_TRACE_SCHEMA_VERSION, undefined, { numeric: true }) >= 0
  );
}

export function verifyTraceCompleteness(data: unknown): TraceVerificationReport {
  const checks: TraceCheckResult[] = [];

  const addCheck = (check: string, passed: boolean, message?: string) => {
    checks.push({ check, passed, message });
  };

  // 1. Structure and schema version
  const baseValidation = validateExperimentTrace(data);
  addCheck(
    'structural_validity',
    baseValidation.valid,
    baseValidation.valid ? undefined : `Base trace validation failed: ${baseValidation.errors.join('; ')}`
  );

  if (!data || typeof data !== 'object') {
    return { valid: false, checks };
  }

  const trace = data as SerializableExperimentTrace;

  const isSupportedSchema =
    trace.schemaVersion === EXPERIMENT_TRACE_SCHEMA_VERSION ||
    (SUPPORTED_EXPERIMENT_TRACE_SCHEMA_VERSIONS as readonly string[]).includes(trace.schemaVersion ?? '');

  addCheck(
    'schema_version',
    isSupportedSchema,
    isSupportedSchema
      ? undefined
      : `Expected schemaVersion '${EXPERIMENT_TRACE_SCHEMA_VERSION}' (or a supported legacy version: ` +
        `${SUPPORTED_EXPERIMENT_TRACE_SCHEMA_VERSIONS.filter((v) => v !== EXPERIMENT_TRACE_SCHEMA_VERSION).join(', ')}), ` +
        `received '${trace.schemaVersion}'`
  );

  // 1b. Canonical clock (F-01)
  //
  // For the current schema the declaration is mandatory: a trace whose records do not state
  // which clock they use cannot be ordered, and the 1.2.0 format's mixed clocks made
  // task duration underivable. Legacy traces are reported, not failed, because they cannot
  // be retro-fixed — the check is what makes the limitation visible.
  if (canonicalContractApplies(trace)) {
    const clockOk = trace.metadata?.clock === TRACE_CLOCK_MODE;
    addCheck(
      'canonical_clock',
      clockOk,
      clockOk
        ? undefined
        : `metadata.clock must be '${TRACE_CLOCK_MODE}'; received '${String(trace.metadata?.clock)}'. ` +
          'Mixed monotonic/epoch clocks are the defect schema 1.3.0 removes.'
    );
  } else {
    addCheck(
      'canonical_clock',
      true,
      `Legacy schema ${trace.schemaVersion} predates the canonical clock; record ordering is not trustworthy.`
    );
  }

  // 2. Correlation IDs
  const missingSessionCorr: string[] = [];
  if (!trace.session?.sessionId) missingSessionCorr.push('session.sessionId');
  if (!trace.session?.experimentId) missingSessionCorr.push('session.experimentId');
  if (!trace.session?.conditionId) missingSessionCorr.push('session.conditionId');

  const missingWindowCorr: number[] = [];
  for (const w of trace.microTensors ?? []) {
    if (typeof w.windowId !== 'number' || w.windowId < 0) {
      missingWindowCorr.push(w.windowId);
    }
  }

  const missingPredCorr: number[] = [];
  for (let i = 0; i < (trace.predictions ?? []).length; i++) {
    const p = trace.predictions[i];
    if (!p.sessionId || !p.experimentId || !p.conditionId || typeof p.windowId !== 'number') {
      missingPredCorr.push(i);
    }
  }

  const missingInterventionCorr: number[] = [];
  for (let i = 0; i < (trace.interventions ?? []).length; i++) {
    const iv = trace.interventions[i];
    if (!iv.interventionEpisodeId || !iv.sessionId || !iv.conditionId) {
      missingInterventionCorr.push(i);
    }
  }

  const corrErrors: string[] = [];
  if (missingSessionCorr.length > 0) {
    corrErrors.push(`Missing session correlation IDs: ${missingSessionCorr.join(', ')}`);
  }
  if (missingWindowCorr.length > 0) {
    corrErrors.push(`${missingWindowCorr.length} microTensors lack valid windowId`);
  }
  if (missingPredCorr.length > 0) {
    corrErrors.push(`${missingPredCorr.length} predictions lack required correlation IDs`);
  }
  if (missingInterventionCorr.length > 0) {
    corrErrors.push(`${missingInterventionCorr.length} interventions lack required correlation IDs`);
  }

  addCheck(
    'correlation_identifiers',
    corrErrors.length === 0,
    corrErrors.length === 0 ? undefined : corrErrors.join('; ')
  );

  // 3. Task lifecycle completeness
  const taskEvents = trace.taskEvents ?? [];
  const taskId = (trace.task?.currentTaskId ?? trace.session?.taskId) as TaskId | undefined;
  const isCompleted = trace.task?.status === 'Completed' || trace.metadata?.finalTaskStatus === 'Completed';
  const isAbandoned = trace.task?.status === 'Abandoned' || trace.metadata?.finalTaskStatus === 'Abandoned';

  if (taskId && KNOWN_TASK_DEFINITIONS[taskId]) {
    const expectedTask = KNOWN_TASK_DEFINITIONS[taskId];
    const hasStart = taskEvents.some(
      (e) => e.type === 'task_start' && e.taskId === taskId
    );
    const hasComplete = taskEvents.some(
      (e) => e.type === 'task_complete' && e.taskId === taskId
    );
    const hasAbandonOrReset = taskEvents.some(
      (e) => (e.type === 'task_abandon' || e.type === 'task_reset') && e.taskId === taskId
    );

    const stepEvents = taskEvents
      .filter((e) => e.type === 'task_step' && e.taskId === taskId)
      .map((e) => e.taskStepId);

    const missingLifecycle: string[] = [];
    if (!hasStart) {
      missingLifecycle.push(`Missing 'task_start' event for task ${taskId}`);
    }
    if (isCompleted) {
      if (!hasComplete) {
        missingLifecycle.push(`Task marked Completed but missing 'task_complete' event`);
      }
      for (const step of expectedTask.steps) {
        const stepId = typeof step === 'string' ? step : step.stepId;
        if (!stepEvents.includes(stepId)) {
          missingLifecycle.push(`Missing step event '${stepId}' for completed task ${taskId}`);
        }
      }
    } else if (isAbandoned && !hasAbandonOrReset) {
      missingLifecycle.push(`Task marked Abandoned but missing 'task_abandon' or 'task_reset' event`);
    }

    addCheck(
      'task_lifecycle_completeness',
      missingLifecycle.length === 0,
      missingLifecycle.length === 0 ? undefined : missingLifecycle.join('; ')
    );
  } else {
    addCheck('task_lifecycle_completeness', true, 'No specific task asserted or free-form trial');
  }

  // 4. Window-to-outcome mapping completeness
  //
  // Only windows that have outlived their entire settlement allowance count as orphaned. A
  // live session always has roughly a dozen windows in flight because outcomes settle after
  // their lookahead horizon, and counting those as failures is what made the previous verifier
  // reject every real capture while passing its own fixtures (F-13).
  const outcomeWindowIds = new Set(
    (trace.outcomes ?? [])
      .map((o) => o.windowId)
      .filter((id): id is number => typeof id === 'number')
  );

  const unmappedWindows = findOrphanedWindows(
    trace.microTensors ?? [],
    outcomeWindowIds,
    PIPELINE_CONFIG.target_generation.lookahead_horizon_ms[1],
    trace.effectiveConfig?.windowing?.pendingOutcomeGraceMs ??
      trace.metadata?.effectiveConfig?.windowing?.pendingOutcomeGraceMs ??
      DEFAULT_RUNTIME_CONFIG.windowing.pendingOutcomeGraceMs
  );

  addCheck(
    'window_outcome_completeness',
    unmappedWindows.length === 0,
    unmappedWindows.length === 0
      ? `Every window past its settlement allowance has an outcome (${(trace.microTensors ?? []).length - unmappedWindows.length} labelled).`
      : `${unmappedWindows.length} microTensor window(s) passed their settlement allowance with no outcome record for windowId: [${unmappedWindows.slice(0, 5).join(', ')}${unmappedWindows.length > 5 ? '...' : ''}]`
  );

  // 5. Terminal state existence for intervention episodes
  const appliedEpisodes = new Set<string>();
  const terminalEpisodes = new Set<string>();

  for (const iv of trace.interventions ?? []) {
    if (!iv.interventionEpisodeId) continue;
    if (iv.type === 'applied') {
      appliedEpisodes.add(iv.interventionEpisodeId);
    }
    if (iv.type === 'dismissed' || iv.type === 'reverted') {
      terminalEpisodes.add(iv.interventionEpisodeId);
    }
  }

  const unterminatedEpisodes: string[] = [];
  for (const ep of appliedEpisodes) {
    if (!terminalEpisodes.has(ep)) {
      unterminatedEpisodes.push(ep);
    }
  }

  addCheck(
    'intervention_terminal_states',
    unterminatedEpisodes.length === 0,
    unterminatedEpisodes.length === 0
      ? undefined
      : `Intervention episodes without terminal state (reverted/dismissed): ${unterminatedEpisodes.join(', ')}`
  );

  // 5b. Policy-decision recording (F-07)
  //
  // Every evaluation must leave a verdict. Without this a trace can show that no adaptation
  // happened but never why, which makes "the policy was unsure" indistinguishable from
  // "the UI made the candidate ineligible".
  const predictions = trace.predictions ?? [];
  const policyDecisions = trace.policyDecisions ?? [];

  if (canonicalContractApplies(trace)) {
    const decisionsByPrediction = new Map<string, number>();
    for (const pd of policyDecisions) {
      if (pd.predictionId) {
        decisionsByPrediction.set(pd.predictionId, (decisionsByPrediction.get(pd.predictionId) ?? 0) + 1);
      }
    }

    const predictionsWithoutVerdict = predictions
      .filter((p) => p.predictionId && !decisionsByPrediction.has(p.predictionId))
      .map((p) => p.predictionId as string);

    const predictionsWithoutId = predictions.filter((p) => !p.predictionId).length;

    const policyErrors: string[] = [];
    if (predictionsWithoutId > 0) {
      policyErrors.push(
        `${predictionsWithoutId} prediction(s) carry no predictionId, so their verdict cannot be attributed`
      );
    }
    if (predictionsWithoutVerdict.length > 0) {
      policyErrors.push(
        `${predictionsWithoutVerdict.length} prediction(s) have no policy decision: ` +
          `[${predictionsWithoutVerdict.slice(0, 5).join(', ')}${predictionsWithoutVerdict.length > 5 ? '...' : ''}]`
      );
    }
    if (predictions.length > 0 && policyDecisions.length === 0) {
      policyErrors.push('Predictions exist but policyDecisions is empty');
    }

    addCheck(
      'policy_decision_recording',
      policyErrors.length === 0,
      policyErrors.length === 0 ? undefined : policyErrors.join('; ')
    );
  } else {
    addCheck(
      'policy_decision_recording',
      true,
      `Legacy schema ${trace.schemaVersion} carries no policy-decision records; refusal reasons are unavailable.`
    );
  }

  // 5c. Episode attribution: every applied episode must trace back to a prediction (F-05)
  const episodePrediction = new Map<string, string>();
  const episodeIssued = new Set<string>();
  for (const iv of trace.interventions ?? []) {
    if (!iv.interventionEpisodeId) continue;
    if (iv.type === 'issued' || iv.type === 'accepted') {
      episodeIssued.add(iv.interventionEpisodeId);
    }
    if (iv.predictionId && !episodePrediction.has(iv.interventionEpisodeId)) {
      episodePrediction.set(iv.interventionEpisodeId, iv.predictionId);
    }
  }
  for (const pd of policyDecisions) {
    // The policy record also names the episode's prediction, so an episode stays
    // attributable even when only the decision and the applied event survived.
    if (!pd.predictionId || !pd.candidate) continue;
    const matching = (trace.interventions ?? []).find(
      (iv) => iv.intervention === pd.candidate && iv.predictionId === pd.predictionId
    );
    if (matching?.interventionEpisodeId) {
      episodePrediction.set(matching.interventionEpisodeId, pd.predictionId);
    }
  }

  const unattributedEpisodes = [...appliedEpisodes].filter(
    (ep) => !episodePrediction.has(ep) && !episodeIssued.has(ep)
  );

  if (canonicalContractApplies(trace)) {
    addCheck(
      'episode_prediction_attribution',
      unattributedEpisodes.length === 0,
      unattributedEpisodes.length === 0
        ? undefined
        : `Applied episodes with no originating prediction: ${unattributedEpisodes.join(', ')}`
    );
  } else {
    addCheck(
      'episode_prediction_attribution',
      true,
      `Legacy schema ${trace.schemaVersion} predates predictionId, so episodes cannot be tied to a prediction.`
    );
  }

  // 6. Baseline condition invariance (zero actuator mutations)
  const isBaseline =
    trace.session?.conditionId === 'baseline' || trace.metadata?.conditionId === 'baseline';

  if (isBaseline) {
    const appliedInBaseline = (trace.interventions ?? []).filter((iv) => iv.type === 'applied');
    addCheck(
      'baseline_zero_mutations',
      appliedInBaseline.length === 0,
      appliedInBaseline.length === 0
        ? undefined
        : `Baseline condition contains ${appliedInBaseline.length} 'applied' intervention events (actuator mutations forbidden in baseline)`
    );
  } else {
    addCheck('baseline_zero_mutations', true, 'Not baseline condition');
  }

  // 7. Provenance presence (ADR-018)
  //
  // Provenance is not decoration: it decides whether a trace may leave the client and
  // whether it may be pooled with other data. An unlabelled trace is therefore a defect,
  // not a default. Pre-1.3.0 captures predate the field and are reported rather than
  // failed, since they cannot be retro-labelled.
  if (canonicalContractApplies(trace)) {
    const provenance = trace.metadata?.provenance ?? trace.session?.provenance;
    const provenanceOk = provenance === 'scripted' || provenance === 'participant';
    addCheck(
      'provenance_declared',
      provenanceOk,
      provenanceOk
        ? undefined
        : `Trace declares no valid provenance (received '${String(provenance)}'); expected 'scripted' or 'participant'`
    );
  } else {
    addCheck(
      'provenance_declared',
      true,
      `Legacy schema ${trace.schemaVersion} predates provenance; the trace is not classifiable as scripted or participant.`
    );
  }

  // 8. Integrity warnings raised at export time (truncation, orphaned windows)
  const warnings = trace.metadata?.integrityWarnings ?? [];
  addCheck(
    'export_integrity_warnings',
    warnings.length === 0,
    warnings.length === 0 ? undefined : warnings.join('; ')
  );

  const valid = checks.every((c) => c.passed);
  return { valid, checks };
}
