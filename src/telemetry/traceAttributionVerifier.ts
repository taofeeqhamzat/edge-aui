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

/** A non-empty string, used to decide whether an attribution field is present. */
function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}
export type TaskId = string;

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

  // 3. Task lifecycle consistency
  //
  // The expected step ids belong to the application's task model, not to the framework
  // (Workstream 20 boundary). What the verifier can decide without that model is whether the
  // recorded lifecycle is internally consistent: one start, one terminal event matching the
  // declared status, no step after the terminal event, and metadata that agrees with it.
  const taskEvents = trace.taskEvents ?? [];
  const declaredTaskId = (trace.task?.currentTaskId ?? trace.session?.taskId) as TaskId | undefined;
  const taskStatus = trace.task?.status ?? trace.metadata?.finalTaskStatus;
  const lifecycleErrors: string[] = [];

  if (declaredTaskId) {
    const eventsForTask = taskEvents.filter((event) => event.taskId === declaredTaskId);
    const otherTasks = new Set(
      taskEvents.map((event) => event.taskId).filter((id) => id && id !== declaredTaskId)
    );
    const starts = eventsForTask.filter((event) => event.type === 'task_start');
    const completes = eventsForTask.filter((event) => event.type === 'task_complete');
    const abandons = eventsForTask.filter((event) => event.type === 'task_abandon');
    const failures = eventsForTask.filter((event) => event.type === 'task_fail');

    if (otherTasks.size > 0) {
      lifecycleErrors.push(
        `taskEvents reference other tasks (${[...otherTasks].join(', ')}) besides ${declaredTaskId}`
      );
    }
    if (starts.length !== 1) {
      lifecycleErrors.push(
        `expected exactly one 'task_start' for ${declaredTaskId}, found ${starts.length}`
      );
    }

    if (taskStatus === 'Completed') {
      if (completes.length !== 1) {
        lifecycleErrors.push(
          `task ${declaredTaskId} is Completed but has ${completes.length} 'task_complete' event(s)`
        );
      }
      if (abandons.length > 0 || failures.length > 0) {
        lifecycleErrors.push(
          `task ${declaredTaskId} is Completed but also records abandonment/failure`
        );
      }
      const completedAt = completes[0]?.timestamp;
      if (typeof completedAt === 'number') {
        const stepsAfterCompletion = eventsForTask.filter(
          (event) => event.type === 'task_step' && event.timestamp > completedAt
        );
        if (stepsAfterCompletion.length > 0) {
          lifecycleErrors.push(
            `${stepsAfterCompletion.length} 'task_step' event(s) recorded after 'task_complete'`
          );
        }
      }
      const durationMs = completes[0]?.durationMs;
      if (typeof durationMs === 'number' && durationMs < 0) {
        lifecycleErrors.push(`'task_complete' carries a negative durationMs (${durationMs})`);
      }
    } else if (taskStatus === 'Abandoned') {
      if (abandons.length !== 1) {
        lifecycleErrors.push(
          `task ${declaredTaskId} is Abandoned but has ${abandons.length} 'task_abandon' event(s)`
        );
      }
      if (completes.length > 0 || failures.length > 0) {
        lifecycleErrors.push(
          `task ${declaredTaskId} is Abandoned but also records completion/failure`
        );
      }
    } else if (taskStatus === 'Failed') {
      if (failures.length !== 1) {
        lifecycleErrors.push(
          `task ${declaredTaskId} is Failed but has ${failures.length} 'task_fail' event(s)`
        );
      }
      if (completes.length > 0 || abandons.length > 0) {
        lifecycleErrors.push(`task ${declaredTaskId} is Failed but also records completion/abandonment`);
      }
      if (failures[0]?.reason !== 'timeout') {
        lifecycleErrors.push(
          `'task_fail' reason must be 'timeout' for a Failed trial, received '${String(
            failures[0]?.reason
          )}'`
        );
      }
    } else if (completes.length > 0 || abandons.length > 0 || failures.length > 0) {
      lifecycleErrors.push(
        `task status '${String(taskStatus)}' is not terminal but a terminal task event was recorded`
      );
    }

    if (
      trace.metadata?.finalTaskStatus &&
      trace.task?.status &&
      trace.metadata.finalTaskStatus !== trace.task.status
    ) {
      lifecycleErrors.push(
        `metadata.finalTaskStatus ('${trace.metadata.finalTaskStatus}') disagrees with ` +
          `task.status ('${trace.task.status}')`
      );
    }
  } else if (taskEvents.length > 0) {
    lifecycleErrors.push('taskEvents are present but no current task id is declared');
  }

  addCheck(
    'task_lifecycle_consistency',
    lifecycleErrors.length === 0,
    lifecycleErrors.length === 0 ? undefined : lifecycleErrors.join('; ')
  );

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

  // 5b-2. Prediction → window attribution (F-18)
  //
  // A prediction that names a window it did not evaluate, or an evaluated window the trace
  // does not contain, cannot be replayed: the sequence the model saw is not recoverable from
  // the record. The 1.2.0 format predates `evaluatedWindowIds`, so legacy traces are reported
  // rather than failed.
  if (canonicalContractApplies(trace)) {
    const windowIds = new Set((trace.microTensors ?? []).map((window) => window.windowId));
    const attributionErrors: string[] = [];
    for (let index = 0; index < predictions.length; index += 1) {
      const prediction = predictions[index];
      if (typeof prediction.windowId !== 'number' || !windowIds.has(prediction.windowId)) {
        attributionErrors.push(
          `predictions[${index}] names window '${String(prediction.windowId)}', which is not in microTensors`
        );
      }
      if (!Array.isArray(prediction.evaluatedWindowIds) || prediction.evaluatedWindowIds.length === 0) {
        attributionErrors.push(`predictions[${index}] has no evaluatedWindowIds`);
        continue;
      }
      const unknown = prediction.evaluatedWindowIds.filter((id) => !windowIds.has(id));
      if (unknown.length > 0) {
        attributionErrors.push(
          `predictions[${index}] evaluated window(s) ${unknown.slice(0, 5).join(', ')} that are not in microTensors`
        );
      }
      if (
        typeof prediction.windowId === 'number' &&
        !prediction.evaluatedWindowIds.includes(prediction.windowId)
      ) {
        attributionErrors.push(
          `predictions[${index}] evaluatedWindowIds does not contain its own windowId '${prediction.windowId}'`
        );
      }
    }
    addCheck(
      'prediction_window_attribution',
      attributionErrors.length === 0,
      attributionErrors.length === 0 ? undefined : attributionErrors.slice(0, 8).join('; ')
    );
  } else {
    addCheck(
      'prediction_window_attribution',
      true,
      `Legacy schema ${trace.schemaVersion} predates evaluatedWindowIds; the evaluated sequence cannot be recovered.`
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

  // 6b. Semantic-outcome and task-definition attribution
  //
  // The verifier does not know the application's vocabulary, but it can require that every
  // record agrees with the version declared in metadata. A trace whose outcomes name two
  // vocabularies, or whose events name a task version the metadata denies, cannot be joined
  // to a target generator or replayed against a task model.
  if (canonicalContractApplies(trace)) {
    const semanticErrors: string[] = [];
    const metadataVocabulary = trace.metadata?.semanticOutcomeVocabularyVersion;
    const outcomeVocabularyVersions = new Set(
      (trace.outcomes ?? [])
        .filter((outcome) => hasText(outcome.taskOutcome))
        .map((outcome) => outcome.taskOutcomeVocabularyVersion)
    );
    if (outcomeVocabularyVersions.size > 1) {
      semanticErrors.push(
        `outcomes name more than one semantic vocabulary version: ${[...outcomeVocabularyVersions]
          .map((version) => `'${String(version)}'`)
          .join(', ')}`
      );
    }
    if (
      metadataVocabulary &&
      outcomeVocabularyVersions.size === 1 &&
      !outcomeVocabularyVersions.has(metadataVocabulary)
    ) {
      semanticErrors.push(
        `metadata.semanticOutcomeVocabularyVersion ('${metadataVocabulary}') disagrees with the outcomes`
      );
    }

    const metadataTaskVersion = trace.metadata?.taskDefinitionVersion;
    const taskVersions = new Set(
      (trace.taskEvents ?? [])
        .map((event) => event.taskDefinitionVersion)
        .filter((version): version is string => hasText(version))
    );
    if (taskVersions.size > 1) {
      semanticErrors.push(
        `taskEvents name more than one task-definition version: ${[...taskVersions]
          .map((version) => `'${version}'`)
          .join(', ')}`
      );
    }
    if (metadataTaskVersion && taskVersions.size === 1 && !taskVersions.has(metadataTaskVersion)) {
      semanticErrors.push(
        `metadata.taskDefinitionVersion ('${metadataTaskVersion}') disagrees with the task events`
      );
    }

    addCheck(
      'semantic_outcome_contract',
      semanticErrors.length === 0,
      semanticErrors.length === 0 ? undefined : semanticErrors.join('; ')
    );
  } else {
    addCheck(
      'semantic_outcome_contract',
      true,
      `Legacy schema ${trace.schemaVersion} predates semantic outcomes and task-definition attribution.`
    );
  }

  // 6c. Condition and provenance consistency
  //
  // Baseline/adaptive separation and scripted/participant separation are only reliable if the
  // session and the metadata cannot disagree about them.
  const consistencyErrors: string[] = [];
  if (
    trace.session?.conditionId &&
    trace.metadata?.conditionId &&
    trace.session.conditionId !== trace.metadata.conditionId
  ) {
    consistencyErrors.push(
      `session.conditionId ('${trace.session.conditionId}') disagrees with metadata.conditionId ('${trace.metadata.conditionId}')`
    );
  }
  if (
    trace.session?.provenance &&
    trace.metadata?.provenance &&
    trace.session.provenance !== trace.metadata.provenance
  ) {
    consistencyErrors.push(
      `session.provenance ('${trace.session.provenance}') disagrees with metadata.provenance ('${trace.metadata.provenance}')`
    );
  }
  addCheck(
    'condition_provenance_consistency',
    consistencyErrors.length === 0,
    consistencyErrors.length === 0 ? undefined : consistencyErrors.join('; ')
  );

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
