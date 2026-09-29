#!/usr/bin/env node
/**
 * Trace Verification CLI
 *
 * Implements Stage 6.3 & Task 10.1 specification from docs/plan/tasks/6.3.md.
 * Verifies structural integrity, attribution, lifecycle events, and baseline invariance.
 *
 * Usage:
 *   node scripts/verify-trace.mjs <path-to-trace.json>
 */

import fs from 'node:fs';
import path from 'node:path';

const EXPERIMENT_TRACE_SCHEMA_VERSION = '1.2.0';
const SUPPORTED_SCHEMA_VERSIONS = ['1.2.0', '1.1.0'];

const EXPERIMENTAL_TASKS = {
  T1: {
    id: 'T1',
    steps: ['T1-1', 'T1-2', 'T1-3', 'T1-4']
  },
  T2: {
    id: 'T2',
    steps: ['T2-1', 'T2-2']
  },
  T3: {
    id: 'T3',
    steps: ['T3-1', 'T3-2', 'T3-3', 'T3-4']
  }
};

export function verifyTraceCompleteness(data) {
  const checks = [];
  const addCheck = (check, passed, message) => {
    checks.push({ check, passed, message });
  };

  if (!data || typeof data !== 'object') {
    addCheck('structural_validity', false, 'Trace must be a non-null object');
    return { valid: false, checks };
  }

  const errors = [];
  const requiredArrays = [
    'behaviourEvents',
    'microTensors',
    'macroInteractions',
    'outcomes',
    'predictions',
    'interventions',
    'taskEvents'
  ];
  for (const arr of requiredArrays) {
    if (!Array.isArray(data[arr])) {
      errors.push(`${arr} must be an array`);
    }
  }

  if (!data.session || typeof data.session !== 'object') {
    errors.push('Missing or invalid session object');
  } else if (!data.session.sessionId) {
    errors.push('session.sessionId must be non-empty string');
  }

  if (!data.metadata || typeof data.metadata !== 'object') {
    errors.push('Missing or invalid metadata object');
  }

  addCheck(
    'structural_validity',
    errors.length === 0,
    errors.length === 0 ? undefined : `Base trace validation failed: ${errors.join('; ')}`
  );

  const isSupportedSchema =
    data.schemaVersion === EXPERIMENT_TRACE_SCHEMA_VERSION ||
    SUPPORTED_SCHEMA_VERSIONS.includes(data.schemaVersion);

  addCheck(
    'schema_version',
    isSupportedSchema,
    isSupportedSchema
      ? undefined
      : `Expected schemaVersion '${EXPERIMENT_TRACE_SCHEMA_VERSION}' (or supported legacy '1.1.0'), received '${data.schemaVersion}'`
  );

  // Correlation IDs
  const missingSessionCorr = [];
  if (!data.session?.sessionId) missingSessionCorr.push('session.sessionId');
  if (!data.session?.experimentId) missingSessionCorr.push('session.experimentId');
  if (!data.session?.conditionId) missingSessionCorr.push('session.conditionId');

  const missingWindowCorr = [];
  for (const w of data.microTensors ?? []) {
    if (typeof w.windowId !== 'number' || w.windowId < 0) {
      missingWindowCorr.push(w.windowId);
    }
  }

  const missingPredCorr = [];
  for (let i = 0; i < (data.predictions ?? []).length; i++) {
    const p = data.predictions[i];
    if (!p.sessionId || !p.experimentId || !p.conditionId || typeof p.windowId !== 'number') {
      missingPredCorr.push(i);
    }
  }

  const missingInterventionCorr = [];
  for (let i = 0; i < (data.interventions ?? []).length; i++) {
    const iv = data.interventions[i];
    if (!iv.interventionEpisodeId || !iv.sessionId || !iv.conditionId) {
      missingInterventionCorr.push(i);
    }
  }

  const corrErrors = [];
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

  // Task lifecycle
  const taskEvents = data.taskEvents ?? [];
  const taskId = data.task?.currentTaskId ?? data.session?.taskId;
  const isCompleted = data.task?.status === 'Completed' || data.metadata?.finalTaskStatus === 'Completed';
  const isAbandoned = data.task?.status === 'Abandoned' || data.metadata?.finalTaskStatus === 'Abandoned';

  if (taskId && EXPERIMENTAL_TASKS[taskId]) {
    const expectedTask = EXPERIMENTAL_TASKS[taskId];
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

    const missingLifecycle = [];
    if (!hasStart) {
      missingLifecycle.push(`Missing 'task_start' event for task ${taskId}`);
    }
    if (isCompleted) {
      if (!hasComplete) {
        missingLifecycle.push(`Task marked Completed but missing 'task_complete' event`);
      }
      for (const stepId of expectedTask.steps) {
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

  // Window-to-outcome mapping
  const windowIds = new Set((data.microTensors ?? []).map((w) => w.windowId));
  const outcomeWindowIds = new Set(
    (data.outcomes ?? [])
      .map((o) => o.windowId)
      .filter((id) => typeof id === 'number')
  );

  const unmappedWindows = [];
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

  // Intervention terminal states
  const appliedEpisodes = new Set();
  const terminalEpisodes = new Set();

  for (const iv of data.interventions ?? []) {
    if (!iv.interventionEpisodeId) continue;
    if (iv.type === 'applied') {
      appliedEpisodes.add(iv.interventionEpisodeId);
    }
    if (iv.type === 'dismissed' || iv.type === 'reverted') {
      terminalEpisodes.add(iv.interventionEpisodeId);
    }
  }

  const unterminatedEpisodes = [];
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

  // Baseline condition invariance
  const isBaseline =
    data.session?.conditionId === 'baseline' || data.metadata?.conditionId === 'baseline';

  if (isBaseline) {
    const appliedInBaseline = (data.interventions ?? []).filter((iv) => iv.type === 'applied');
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

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node scripts/verify-trace.mjs <trace-file.json>');
    process.exit(1);
  }

  const tracePath = path.resolve(process.cwd(), args[0]);
  if (!fs.existsSync(tracePath)) {
    console.error(`Trace file not found: ${tracePath}`);
    process.exit(1);
  }

  let traceData;
  try {
    const content = fs.readFileSync(tracePath, 'utf8');
    traceData = JSON.parse(content);
  } catch (err) {
    console.error(`Failed to parse trace JSON from ${tracePath}:`, err.message);
    process.exit(1);
  }

  const report = verifyTraceCompleteness(traceData);

  console.log(`\nVerifying trace: ${path.basename(tracePath)}`);
  console.log('='.repeat(60));

  for (const check of report.checks) {
    const symbol = check.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`[${symbol}] ${check.check}`);
    if (!check.passed && check.message) {
      console.error(`       Error: ${check.message}`);
    }
  }

  console.log('='.repeat(60));
  if (report.valid) {
    console.log('Trace is structurally complete, attributable, and verified.\n');
    process.exit(0);
  } else {
    console.error('Trace verification FAILED.\n');
    process.exit(1);
  }
}
