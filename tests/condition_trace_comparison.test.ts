/**
 * Controlled Baseline vs Adaptive Trace Comparison Tests (Task 6.2 / Brief §14)
 *
 * Verifies that:
 * 1. Both condition traces pass structural completeness and attribution verification.
 * 2. Baseline condition enforces zero actuator mutations (zero applied interventions).
 * 3. Adaptive condition exhibits distinguishable intervention behavior with complete terminal states.
 * 4. Schema parity (1.2.0) and task parity (T2) are preserved across conditions.
 * 5. Negative fixtures (e.g. baseline mutation, missing adaptive intervention, schema mismatch) are caught.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { compareConditionTraces } from '../scripts/compare-condition-traces.mjs';
import { verifyTraceCompleteness } from '../src/telemetry/traceAttributionVerifier';
import type { SerializableExperimentTrace } from '../src/telemetry/traceSchema';

describe('Task 6.2: Controlled Baseline vs Adaptive Trace Comparison (Brief §14)', () => {
  const baselinePath = path.resolve(__dirname, '../docs/experiments/baseline-trace.json');
  const adaptivePath = path.resolve(__dirname, '../docs/experiments/adaptive-trace.json');

  it('loads canonical exported traces from docs/experiments/', () => {
    expect(fs.existsSync(baselinePath)).toBe(true);
    expect(fs.existsSync(adaptivePath)).toBe(true);

    const bData = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    const aData = JSON.parse(fs.readFileSync(adaptivePath, 'utf8'));

    expect(bData.schemaVersion).toBe('1.2.0');
    expect(aData.schemaVersion).toBe('1.2.0');
  });

  it('verifies both traces pass completeness and attribution verifier independently', () => {
    const bData: SerializableExperimentTrace = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    const aData: SerializableExperimentTrace = JSON.parse(fs.readFileSync(adaptivePath, 'utf8'));

    const bResult = verifyTraceCompleteness(bData);
    expect(bResult.valid).toBe(true);
    expect(bResult.checks.every((c) => c.passed)).toBe(true);

    const aResult = verifyTraceCompleteness(aData);
    expect(aResult.valid).toBe(true);
    expect(aResult.checks.every((c) => c.passed)).toBe(true);
  });

  it('confirms comparative engineering invariants across conditions', () => {
    const bData = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    const aData = JSON.parse(fs.readFileSync(adaptivePath, 'utf8'));

    const comparison = compareConditionTraces(bData, aData);
    expect(comparison.passed).toBe(true);
    expect(comparison.issues).toHaveLength(0);

    // Schema and task parity
    expect(comparison.engineeringChecks.schemaParity).toBe(true);
    expect(comparison.engineeringChecks.taskParity).toBe(true);
    expect(comparison.taskId).toBe('T2');

    // Baseline invariance: zero mutations
    expect(comparison.engineeringChecks.baselineZeroMutation).toBe(true);
    expect(comparison.baseline.interventionsApplied).toBe(0);

    // Adaptive distinctiveness: active adaptations
    expect(comparison.engineeringChecks.adaptiveInterventionActive).toBe(true);
    expect(comparison.adaptive.interventionsApplied).toBeGreaterThan(0);
    expect(comparison.adaptive.interventionsBySource['learned_head']).toBe(1);
  });

  it('rejects comparison if baseline contains actuator mutations', () => {
    const bData = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    const aData = JSON.parse(fs.readFileSync(adaptivePath, 'utf8'));

    bData.interventions = [
      {
        timestamp: 1500,
        type: 'applied',
        intervention: 'highlight_primary_action',
        source: 'slow',
        mappingSource: 'learned_head',
        interventionEpisodeId: 'ep-bad-01',
        sessionId: bData.session.sessionId,
        conditionId: 'baseline'
      }
    ];

    const comparison = compareConditionTraces(bData, aData);
    expect(comparison.passed).toBe(false);
    expect(comparison.engineeringChecks.baselineZeroMutation).toBe(false);
    expect(comparison.issues.some((i: string) => i.includes('Baseline violation'))).toBe(true);
  });

  it('rejects comparison if adaptive condition fails to apply any intervention', () => {
    const bData = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    const aData = JSON.parse(fs.readFileSync(adaptivePath, 'utf8'));

    aData.interventions = [];

    const comparison = compareConditionTraces(bData, aData);
    expect(comparison.passed).toBe(false);
    expect(comparison.engineeringChecks.adaptiveInterventionActive).toBe(false);
    expect(comparison.issues.some((i: string) => i.includes('0 applied interventions'))).toBe(true);
  });

  it('rejects comparison on schema version mismatch', () => {
    const bData = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    const aData = JSON.parse(fs.readFileSync(adaptivePath, 'utf8'));

    aData.schemaVersion = '1.1.0';

    const comparison = compareConditionTraces(bData, aData);
    expect(comparison.passed).toBe(false);
    expect(comparison.engineeringChecks.schemaParity).toBe(false);
    expect(comparison.issues.some((i: string) => i.includes('Schema mismatch'))).toBe(true);
  });
});
