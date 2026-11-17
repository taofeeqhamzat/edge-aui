#!/usr/bin/env node
/**
 * Controlled Baseline vs Adaptive Trace Comparison CLI
 *
 * Compares a baseline capture with the adaptive capture of the *same* task. It is an
 * engineering comparison of instrumentation and condition integrity, not an evaluation of
 * usability or intervention benefit.
 *
 * What it decides:
 * - both traces pass the framework verifier;
 * - schema, task, provenance and task-definition version agree;
 * - the baseline trace contains no applied intervention (no adaptive DOM mutation);
 * - every applied adaptive intervention belongs to the framework's configured intervention
 *   vocabulary and is attributable to an accepted policy decision.
 *
 * What it reports but does not fail on: whether the adaptive policy actually actuated. A
 * policy that declines is a legitimate research outcome, and a scripted canonical run may
 * never cross the confidence/persistence thresholds. Treating "no actuation" as a broken
 * comparison would invite faking one.
 *
 * Usage:
 *   node scripts/compare-condition-traces.mjs --baseline <baseline.json> --adaptive <adaptive.json> [--json]
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadVerificationModule } from './lib/load-verifier.mjs';

/**
 * Compares two exported traces.
 *
 * `contracts` carries the framework's own verification functions, so this comparison cannot
 * drift from the verifier the runtime and the test suite use.
 */
export function compareConditionTraces(baselineTrace, adaptiveTrace, contracts) {
  if (!contracts || typeof contracts.verifyTraceCompleteness !== 'function') {
    throw new Error(
      'compareConditionTraces requires { verifyTraceCompleteness, canonicalContractApplies, isInterventionType }'
    );
  }
  const { verifyTraceCompleteness, canonicalContractApplies, isInterventionType } = contracts;
  const issues = [];
  const notes = [];

  // 1. Each trace on its own.
  const baselineVerification = verifyTraceCompleteness(baselineTrace);
  const adaptiveVerification = verifyTraceCompleteness(adaptiveTrace);

  for (const [label, verification] of [
    ['Baseline', baselineVerification],
    ['Adaptive', adaptiveVerification]
  ]) {
    if (!verification.valid) {
      issues.push(
        `${label} trace failed completeness verification: ` +
          verification.checks
            .filter((check) => !check.passed)
            .map((check) => `${check.check}: ${check.message}`)
            .join('; ')
      );
    }
  }

  // 2. Comparability: the two captures must describe the same experiment.
  const schemaParity = baselineTrace.schemaVersion === adaptiveTrace.schemaVersion;
  if (!schemaParity) {
    issues.push(
      `Schema mismatch: baseline='${baselineTrace.schemaVersion}', adaptive='${adaptiveTrace.schemaVersion}'`
    );
  }

  const baselineTaskId =
    baselineTrace.task?.currentTaskId ?? baselineTrace.session?.taskId;
  const adaptiveTaskId = adaptiveTrace.task?.currentTaskId ?? adaptiveTrace.session?.taskId;
  const taskParity = baselineTaskId === adaptiveTaskId;
  if (!taskParity) {
    issues.push(
      `Task ID mismatch: baseline='${baselineTaskId}', adaptive='${adaptiveTaskId}'`
    );
  }

  const baselineCondition = baselineTrace.session?.conditionId ?? baselineTrace.metadata?.conditionId;
  const adaptiveCondition = adaptiveTrace.session?.conditionId ?? adaptiveTrace.metadata?.conditionId;
  const conditionParity = baselineCondition === 'baseline' && adaptiveCondition === 'adaptive';
  if (!conditionParity) {
    issues.push(
      `Condition mismatch: baseline trace declares '${baselineCondition}', adaptive declares '${adaptiveCondition}'`
    );
  }

  const baselineProvenance =
    baselineTrace.metadata?.provenance ?? baselineTrace.session?.provenance;
  const adaptiveProvenance =
    adaptiveTrace.metadata?.provenance ?? adaptiveTrace.session?.provenance;
  const provenanceParity = baselineProvenance === adaptiveProvenance;
  if (provenanceParity) {
    notes.push(`Both captures declare provenance '${String(baselineProvenance)}'.`);
  } else {
    issues.push(
      `Provenance mismatch: baseline='${String(baselineProvenance)}', adaptive='${String(adaptiveProvenance)}'`
    );
  }

  const canonical = canonicalContractApplies(baselineTrace);
  const baselineTaskVersion = baselineTrace.metadata?.taskDefinitionVersion;
  const adaptiveTaskVersion = adaptiveTrace.metadata?.taskDefinitionVersion;
  const taskVersionParity = baselineTaskVersion === adaptiveTaskVersion;
  if (canonical && !taskVersionParity) {
    issues.push(
      `Task-definition version mismatch: baseline='${String(baselineTaskVersion)}', ` +
        `adaptive='${String(adaptiveTaskVersion)}'`
    );
  } else if (canonical) {
    notes.push(`Both captures declare task-definition version '${String(baselineTaskVersion)}'.`);
  } else {
    notes.push(
      `Legacy schema ${String(baselineTrace.schemaVersion)}: clock, policy-decision, prediction ` +
        'attribution and provenance guarantees are not available for either capture.'
    );
  }

  // 3. Baseline condition invariance: the interface must not be mutated.
  const baselineApplied = (baselineTrace.interventions ?? []).filter(
    (intervention) => intervention.type === 'applied'
  );
  if (baselineApplied.length > 0) {
    issues.push(
      `Baseline violation: expected 0 applied interventions, found ${baselineApplied.length}`
    );
  }

  // 4. Adaptive condition: only configured interventions, each attributable to a decision.
  const adaptiveApplied = (adaptiveTrace.interventions ?? []).filter(
    (intervention) => intervention.type === 'applied'
  );
  const unconfigured = adaptiveApplied.filter(
    (intervention) => !isInterventionType(intervention.intervention)
  );
  if (unconfigured.length > 0) {
    issues.push(
      `Adaptive condition applied unconfigured intervention(s): ` +
        unconfigured.map((intervention) => String(intervention.intervention)).join(', ')
    );
  }

  // Policy decisions only exist from schema 1.3.0. An applied episode in an older capture
  // cannot be attributed to a verdict the format never recorded, so asking for one would fail
  // exactly the historical captures this comparison is meant to read.
  const acceptedDecisions = (adaptiveTrace.policyDecisions ?? []).filter(
    (decision) => decision.accepted === true
  );
  const unattributed = canonical
    ? adaptiveApplied.filter(
        (intervention) =>
          !acceptedDecisions.some(
            (decision) =>
              (intervention.predictionId && decision.predictionId === intervention.predictionId) ||
              (!intervention.predictionId &&
                decision.candidate === intervention.intervention &&
                decision.accepted)
          )
      )
    : [];
  if (unattributed.length > 0) {
    issues.push(
      `${unattributed.length} applied adaptive intervention(s) have no accepted policy decision`
    );
  }
  if (!canonical && adaptiveApplied.length > 0) {
    notes.push(
      `Legacy schema ${String(adaptiveTrace.schemaVersion)} predates policy decisions; ` +
        `${adaptiveApplied.length} applied intervention(s) cannot be attributed to a verdict.`
    );
  }

  // 5. Semantic outcome evidence (schema 1.4.0 and later).
  const semanticOutcomes = (trace) =>
    Array.from(
      new Set(
        (trace.outcomes ?? [])
          .map((outcome) => outcome.taskOutcome)
          .filter((outcome) => typeof outcome === 'string' && outcome.length > 0)
      )
    );
  if (canonical) {
    const baselineSemantic = semanticOutcomes(baselineTrace);
    const adaptiveSemantic = semanticOutcomes(adaptiveTrace);
    if (baselineSemantic.length === 0 && adaptiveSemantic.length === 0) {
      notes.push('Neither capture carries a semantic outcome; the vocabulary was not exercised.');
    }
  }

  const summarizeApplied = (interventions) =>
    interventions.reduce((accumulator, intervention) => {
      const key = String(intervention.intervention);
      accumulator[key] = (accumulator[key] ?? 0) + 1;
      return accumulator;
    }, {});

  const summary = {
    schemaVersion: baselineTrace.schemaVersion,
    taskId: baselineTaskId,
    taskDefinitionVersion: baselineTaskVersion,
    provenance: baselineProvenance,
    baseline: {
      sessionId: baselineTrace.session?.sessionId,
      conditionId: baselineCondition,
      durationMs: baselineTrace.metadata?.durationMs,
      behaviourEvents: (baselineTrace.behaviourEvents ?? []).length,
      microTensors: (baselineTrace.microTensors ?? []).length,
      outcomes: (baselineTrace.outcomes ?? []).length,
      predictions: (baselineTrace.predictions ?? []).length,
      policyDecisions: (baselineTrace.policyDecisions ?? []).length,
      interventionsApplied: baselineApplied.length,
      taskStatus: baselineTrace.task?.status,
      semanticOutcomes: semanticOutcomes(baselineTrace)
    },
    adaptive: {
      sessionId: adaptiveTrace.session?.sessionId,
      conditionId: adaptiveCondition,
      durationMs: adaptiveTrace.metadata?.durationMs,
      behaviourEvents: (adaptiveTrace.behaviourEvents ?? []).length,
      microTensors: (adaptiveTrace.microTensors ?? []).length,
      outcomes: (adaptiveTrace.outcomes ?? []).length,
      predictions: (adaptiveTrace.predictions ?? []).length,
      policyDecisions: (adaptiveTrace.policyDecisions ?? []).length,
      interventionsApplied: adaptiveApplied.length,
      interventionsByType: summarizeApplied(adaptiveApplied),
      taskStatus: adaptiveTrace.task?.status,
      semanticOutcomes: semanticOutcomes(adaptiveTrace)
    },
    engineeringChecks: {
      schemaParity,
      taskParity,
      conditionParity,
      provenanceParity,
      taskVersionParity,
      baselineZeroMutation: baselineApplied.length === 0,
      adaptiveInterventionsConfigured: unconfigured.length === 0,
      adaptiveInterventionsAttributed: unattributed.length === 0,
      adaptiveInterventionActive: adaptiveApplied.length > 0
    },
    passed: issues.length === 0,
    issues,
    notes
  };

  return summary;
}

function parseArgs(argv) {
  let baselinePath = null;
  let adaptivePath = null;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--baseline' && index + 1 < argv.length) {
      baselinePath = argv[++index];
    } else if (argument.startsWith('--baseline=')) {
      baselinePath = argument.slice('--baseline='.length);
    } else if (argument === '--adaptive' && index + 1 < argv.length) {
      adaptivePath = argv[++index];
    } else if (argument.startsWith('--adaptive=')) {
      adaptivePath = argument.slice('--adaptive='.length);
    } else if (argument === '--json') {
      json = true;
    }
  }
  return { baselinePath, adaptivePath, json };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { baselinePath, adaptivePath, json } = parseArgs(process.argv.slice(2));
  if (!baselinePath || !adaptivePath) {
    console.error(
      'Usage: node scripts/compare-condition-traces.mjs --baseline <path> --adaptive <path> [--json]'
    );
    process.exit(1);
  }

  const baselineFile = path.resolve(process.cwd(), baselinePath);
  const adaptiveFile = path.resolve(process.cwd(), adaptivePath);
  for (const [label, file] of [
    ['Baseline', baselineFile],
    ['Adaptive', adaptiveFile]
  ]) {
    if (!fs.existsSync(file)) {
      console.error(`${label} trace file not found: ${file}`);
      process.exit(1);
    }
  }

  let baselineData;
  let adaptiveData;
  try {
    baselineData = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
    adaptiveData = JSON.parse(fs.readFileSync(adaptiveFile, 'utf8'));
  } catch (error) {
    console.error(`Failed to parse trace JSON: ${error.message}`);
    process.exit(1);
  }

  let contracts;
  try {
    contracts = await loadVerificationModule();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  const result = compareConditionTraces(baselineData, adaptiveData, contracts);

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('\n============================================================');
    console.log('Baseline vs Adaptive Trace Comparison');
    console.log('============================================================');
    console.log(`Task:                 ${result.taskId}`);
    console.log(`Task definition:      ${String(result.taskDefinitionVersion)}`);
    console.log(`Schema version:       ${result.schemaVersion}`);
    console.log(`Provenance:           ${String(result.provenance)}`);
    console.log('------------------------------------------------------------');
    console.log('Metric                   Baseline            Adaptive');
    console.log('------------------------------------------------------------');
    console.log(`Condition:              ${String(result.baseline.conditionId).padEnd(20)}${result.adaptive.conditionId}`);
    console.log(`Task status:            ${String(result.baseline.taskStatus).padEnd(20)}${result.adaptive.taskStatus}`);
    console.log(`Duration (ms):          ${String(result.baseline.durationMs).padEnd(20)}${result.adaptive.durationMs}`);
    console.log(`Behaviour events:       ${String(result.baseline.behaviourEvents).padEnd(20)}${result.adaptive.behaviourEvents}`);
    console.log(`MicroTensor windows:    ${String(result.baseline.microTensors).padEnd(20)}${result.adaptive.microTensors}`);
    console.log(`Outcomes:               ${String(result.baseline.outcomes).padEnd(20)}${result.adaptive.outcomes}`);
    console.log(`Predictions:            ${String(result.baseline.predictions).padEnd(20)}${result.adaptive.predictions}`);
    console.log(`Policy decisions:       ${String(result.baseline.policyDecisions).padEnd(20)}${result.adaptive.policyDecisions}`);
    console.log(`Interventions applied:  ${String(result.baseline.interventionsApplied).padEnd(20)}${result.adaptive.interventionsApplied}`);
    console.log(`Semantic outcomes:      ${String(result.baseline.semanticOutcomes.length).padEnd(20)}${result.adaptive.semanticOutcomes.length}`);
    console.log('------------------------------------------------------------');
    console.log(`Adaptive interventions: ${JSON.stringify(result.adaptive.interventionsByType)}`);
    console.log('------------------------------------------------------------');
    console.log('Integrity checks:');
    console.log(`- Schema parity:                       ${result.engineeringChecks.schemaParity ? '✓ PASS' : '✗ FAIL'}`);
    console.log(`- Task parity:                         ${result.engineeringChecks.taskParity ? '✓ PASS' : '✗ FAIL'}`);
    console.log(`- Condition parity:                    ${result.engineeringChecks.conditionParity ? '✓ PASS' : '✗ FAIL'}`);
    console.log(`- Provenance parity:                   ${result.engineeringChecks.provenanceParity ? '✓ PASS' : '✗ FAIL'}`);
    console.log(`- Task-definition version parity:      ${result.engineeringChecks.taskVersionParity ? '✓ PASS' : '✗ FAIL'}`);
    console.log(`- Baseline zero mutations:             ${result.engineeringChecks.baselineZeroMutation ? '✓ PASS' : '✗ FAIL'}`);
    console.log(`- Adaptive interventions configured:   ${result.engineeringChecks.adaptiveInterventionsConfigured ? '✓ PASS' : '✗ FAIL'}`);
    console.log(`- Adaptive interventions attributed:   ${result.engineeringChecks.adaptiveInterventionsAttributed ? '✓ PASS' : '✗ FAIL'}`);
    console.log(`- Adaptive actuation observed:         ${result.engineeringChecks.adaptiveInterventionActive ? 'YES' : 'NO (policy declined)'}`);
    for (const note of result.notes) {
      console.log(`  note: ${note}`);
    }
    console.log('============================================================');

    if (result.passed) {
      console.log('\n✓ Condition comparison passed integrity verification.');
      console.log('NOTE: This confirms condition integrity and actuation accounting; it does not');
      console.log('      infer usability effect or user satisfaction.\n');
    } else {
      console.error('\n✗ Condition comparison FAILED:');
      for (const issue of result.issues) {
        console.error(`  - ${issue}`);
      }
      console.log();
    }
  }

  process.exit(result.passed ? 0 : 1);
}
