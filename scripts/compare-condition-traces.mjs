#!/usr/bin/env node
/**
 * Controlled Baseline vs Adaptive Trace Comparison CLI
 *
 * Implements Task 6.2 (Brief §14) specifications.
 * Evaluates structural parity, baseline zero-mutation invariance, and adaptive
 * intervention execution between Condition A (baseline) and Condition B (adaptive).
 *
 * Usage:
 *   node scripts/compare-condition-traces.mjs --baseline <path> --adaptive <path>
 */

import fs from 'node:fs';
import path from 'node:path';
import { verifyTraceCompleteness } from './verify-trace.mjs';

/**
 * Compares baseline and adaptive traces for engineering validity and distinctiveness.
 *
 * NOTE: As required by Brief §14 and Task 6.2, this is strictly an engineering comparison
 * verifying instrumentation and condition distinctiveness, NOT an evaluation of usability effect.
 */
export function compareConditionTraces(baselineTrace, adaptiveTrace) {
  const issues = [];

  // 1. Verify individual trace completeness
  const baselineVerification = verifyTraceCompleteness(baselineTrace);
  const adaptiveVerification = verifyTraceCompleteness(adaptiveTrace);

  if (!baselineVerification.valid) {
    issues.push(`Baseline trace failed completeness verification: ${
      baselineVerification.checks.filter(c => !c.passed).map(c => `${c.check}: ${c.message}`).join('; ')
    }`);
  }

  if (!adaptiveVerification.valid) {
    issues.push(`Adaptive trace failed completeness verification: ${
      adaptiveVerification.checks.filter(c => !c.passed).map(c => `${c.check}: ${c.message}`).join('; ')
    }`);
  }

  // 2. Comparative invariants (Brief §14)
  const schemaParity = baselineTrace.schemaVersion === adaptiveTrace.schemaVersion;
  if (!schemaParity) {
    issues.push(`Schema mismatch: baseline='${baselineTrace.schemaVersion}', adaptive='${adaptiveTrace.schemaVersion}'`);
  }

  const baselineTaskId = baselineTrace.task?.currentTaskId ?? baselineTrace.session?.taskId;
  const adaptiveTaskId = adaptiveTrace.task?.currentTaskId ?? adaptiveTrace.session?.taskId;
  const taskParity = baselineTaskId === adaptiveTaskId;
  if (!taskParity) {
    issues.push(`Task ID mismatch: baseline='${baselineTaskId}', adaptive='${adaptiveTaskId}'`);
  }

  // 3. Baseline zero-mutation check
  const baselineApplied = (baselineTrace.interventions ?? []).filter(i => i.type === 'applied');
  if (baselineApplied.length > 0) {
    issues.push(`Baseline violation: expected 0 applied interventions, found ${baselineApplied.length}`);
  }

  // 4. Adaptive intervention check
  const adaptiveApplied = (adaptiveTrace.interventions ?? []).filter(i => i.type === 'applied');
  if (adaptiveApplied.length === 0) {
    issues.push(`Adaptive condition showed 0 applied interventions; expected distinguishable intervention behavior`);
  }

  // 5. Compute summary statistics
  const summary = {
    schemaVersion: baselineTrace.schemaVersion,
    taskId: baselineTaskId,
    baseline: {
      sessionId: baselineTrace.session?.sessionId,
      conditionId: baselineTrace.session?.conditionId,
      durationMs: baselineTrace.metadata?.durationMs,
      totalEvents: baselineTrace.metadata?.totalEvents,
      behaviourEvents: (baselineTrace.behaviourEvents ?? []).length,
      microTensors: (baselineTrace.microTensors ?? []).length,
      macroInteractions: (baselineTrace.macroInteractions ?? []).length,
      outcomes: (baselineTrace.outcomes ?? []).length,
      predictions: (baselineTrace.predictions ?? []).length,
      interventionsApplied: baselineApplied.length,
      taskStatus: baselineTrace.task?.status
    },
    adaptive: {
      sessionId: adaptiveTrace.session?.sessionId,
      conditionId: adaptiveTrace.session?.conditionId,
      durationMs: adaptiveTrace.metadata?.durationMs,
      totalEvents: adaptiveTrace.metadata?.totalEvents,
      behaviourEvents: (adaptiveTrace.behaviourEvents ?? []).length,
      microTensors: (adaptiveTrace.microTensors ?? []).length,
      macroInteractions: (adaptiveTrace.macroInteractions ?? []).length,
      outcomes: (adaptiveTrace.outcomes ?? []).length,
      predictions: (adaptiveTrace.predictions ?? []).length,
      interventionsApplied: adaptiveApplied.length,
      taskStatus: adaptiveTrace.task?.status,
      interventionsByType: adaptiveApplied.reduce((acc, curr) => {
        acc[curr.intervention] = (acc[curr.intervention] || 0) + 1;
        return acc;
      }, {}),
      interventionsBySource: adaptiveApplied.reduce((acc, curr) => {
        const src = curr.mappingSource ?? curr.source ?? 'unknown';
        acc[src] = (acc[src] || 0) + 1;
        return acc;
      }, {})
    },
    engineeringChecks: {
      schemaParity,
      taskParity,
      baselineZeroMutation: baselineApplied.length === 0,
      adaptiveInterventionActive: adaptiveApplied.length > 0
    },
    passed: issues.length === 0,
    issues
  };

  return summary;
}

// CLI Execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  let baselinePath = null;
  let adaptivePath = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--baseline' && i + 1 < args.length) {
      baselinePath = args[++i];
    } else if (args[i].startsWith('--baseline=')) {
      baselinePath = args[i].slice('--baseline='.length);
    } else if (args[i] === '--adaptive' && i + 1 < args.length) {
      adaptivePath = args[++i];
    } else if (args[i].startsWith('--adaptive=')) {
      adaptivePath = args[i].slice('--adaptive='.length);
    }
  }

  if (!baselinePath || !adaptivePath) {
    console.error('Usage: node scripts/compare-condition-traces.mjs --baseline <path> --adaptive <path>');
    process.exit(1);
  }

  const bAbs = path.resolve(process.cwd(), baselinePath);
  const aAbs = path.resolve(process.cwd(), adaptivePath);

  if (!fs.existsSync(bAbs)) {
    console.error(`Baseline trace file not found: ${bAbs}`);
    process.exit(1);
  }
  if (!fs.existsSync(aAbs)) {
    console.error(`Adaptive trace file not found: ${aAbs}`);
    process.exit(1);
  }

  let bData, aData;
  try {
    bData = JSON.parse(fs.readFileSync(bAbs, 'utf8'));
    aData = JSON.parse(fs.readFileSync(aAbs, 'utf8'));
  } catch (err) {
    console.error(`Failed to parse trace JSON: ${err.message}`);
    process.exit(1);
  }

  const result = compareConditionTraces(bData, aData);

  console.log('\n============================================================');
  console.log('Controlled Condition Trace Comparison (Brief §14)');
  console.log('============================================================');
  console.log(`Task:               ${result.taskId}`);
  console.log(`Schema Version:     ${result.schemaVersion}`);
  console.log('------------------------------------------------------------');
  console.log('Metric                   Baseline (A)        Adaptive (B)');
  console.log('------------------------------------------------------------');
  console.log(`Duration (ms):          ${String(result.baseline.durationMs).padEnd(20)}${result.adaptive.durationMs}`);
  console.log(`Total Events:           ${String(result.baseline.totalEvents).padEnd(20)}${result.adaptive.totalEvents}`);
  console.log(`Behaviour Events:       ${String(result.baseline.behaviourEvents).padEnd(20)}${result.adaptive.behaviourEvents}`);
  console.log(`MicroTensors:           ${String(result.baseline.microTensors).padEnd(20)}${result.adaptive.microTensors}`);
  console.log(`Predictions:            ${String(result.baseline.predictions).padEnd(20)}${result.adaptive.predictions}`);
  console.log(`Interventions Applied:  ${String(result.baseline.interventionsApplied).padEnd(20)}${result.adaptive.interventionsApplied}`);
  console.log(`Task Status:            ${String(result.baseline.taskStatus).padEnd(20)}${result.adaptive.taskStatus}`);
  console.log('------------------------------------------------------------');
  console.log(`Adaptive Interventions by Type:   ${JSON.stringify(result.adaptive.interventionsByType)}`);
  console.log(`Adaptive Interventions by Source: ${JSON.stringify(result.adaptive.interventionsBySource)}`);
  console.log('------------------------------------------------------------');
  console.log('Engineering Integrity Checks:');
  console.log(`- Schema Parity:              ${result.engineeringChecks.schemaParity ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`- Task Parity:                ${result.engineeringChecks.taskParity ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`- Baseline Zero Mutations:    ${result.engineeringChecks.baselineZeroMutation ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`- Adaptive Interventions:     ${result.engineeringChecks.adaptiveInterventionActive ? '✓ PASS' : '✗ FAIL'}`);
  console.log('============================================================');

  if (result.passed) {
    console.log('\n✓ Condition comparison passed engineering verification.');
    console.log('NOTE: This comparison confirms instrumentation and adaptation distinctiveness;');
    console.log('      it explicitly does NOT infer usability effect or user satisfaction.\n');
    process.exit(0);
  } else {
    console.error('\n✗ Condition comparison FAILED with issues:');
    for (const issue of result.issues) {
      console.error(`  - ${issue}`);
    }
    console.log();
    process.exit(1);
  }
}
