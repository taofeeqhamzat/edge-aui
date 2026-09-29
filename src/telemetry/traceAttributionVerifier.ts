/**
 * Trace Attribution and Completeness Verifier
 *
 * Implements Stage 6.3 & Task 10.1 specifications from docs/plan/tasks/6.3.md and
 * model-preparation Phase B Task 10.1:
 *
 * Verifies:
 * 1. Strict schema compliance (schemaVersion 1.1.0).
 * 2. Unbroken correlation IDs across events, windows, predictions, and interventions.
 * 3. Task lifecycle completeness against the task definition.
 * 4. Window-to-outcome mapping completeness.
 * 5. Terminal state existence for intervention episodes.
 * 6. Baseline condition invariance (zero actuator mutations / applied interventions).
 */

import {
  EXPERIMENT_TRACE_SCHEMA_VERSION,
  SUPPORTED_EXPERIMENT_TRACE_SCHEMA_VERSIONS,
  validateExperimentTrace,
  type SerializableExperimentTrace
} from './traceSchema.js';
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
      : `Expected schemaVersion '${EXPERIMENT_TRACE_SCHEMA_VERSION}' (or supported legacy '1.1.0'), received '${trace.schemaVersion}'`
  );

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
  const windowIds = new Set((trace.microTensors ?? []).map((w) => w.windowId));
  const outcomeWindowIds = new Set(
    (trace.outcomes ?? [])
      .map((o) => o.windowId)
      .filter((id): id is number => typeof id === 'number')
  );

  const unmappedWindows: number[] = [];
  for (const wid of windowIds) {
    if (!outcomeWindowIds.has(wid)) {
      unmappedWindows.push(wid);
    }
  }

  addCheck(
    'window_outcome_completeness',
    unmappedWindows.length === 0,
    unmappedWindows.length === 0
      ? undefined
      : `${unmappedWindows.length} microTensor windows lack corresponding outcome record for windowId: [${unmappedWindows.slice(0, 5).join(', ')}${unmappedWindows.length > 5 ? '...' : ''}]`
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

  const valid = checks.every((c) => c.passed);
  return { valid, checks };
}
