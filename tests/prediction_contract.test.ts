/**
 * Normalized Prediction Contract (Task 20.1)
 *
 * Both gates must speak one application-vocabulary-agnostic prediction contract, and the
 * policy must be able to act on that prediction without a gate having produced an
 * `InterventionCommand`. The intervention command stays the actuation contract; it becomes
 * a policy output, produced by resolving a predicted outcome through an application port.
 */

import { describe, it, expect } from 'vitest';
import {
  PREDICTION_CONTRACT_VERSION,
  INTERVENTION_OUTCOME_VOCABULARY_VERSION
} from '../src/gates/contracts';
import {
  AdaptiveInferenceEngine,
  createAdaptiveInferenceEngine,
  InferenceContext
} from '../src/gates/arbitration';
import { MockFastGate } from '../src/gates/fast/mockFastGate';
import { MockSlowGate } from '../src/gates/slow/mockSlowGate';
import { FOUNDATION_OUTCOME_VOCABULARY_VERSION } from '../src/gates/slow/types';
import { MacroInteraction, OutcomeType } from '../src/telemetry/events';
import { UIContext } from '../src/types/uiContext';
import { InterventionPolicy, CandidateResolver } from '../src/intervention/policy';

function makeUiContext(overrides: Partial<UIContext> = {}): UIContext {
  return {
    route: 'Analytics',
    activeComponentId: 'filter-drawer',
    componentRole: 'accordion',
    availableActions: ['click'],
    primaryActionAvailable: true,
    helpAvailable: true,
    expandable: true,
    ...overrides
  };
}

function makeInferenceContext(symbols: string[]): InferenceContext {
  const macroSequence: MacroInteraction[] = symbols.map((symbol, index) => ({
    timestamp: 1000 + index * 100,
    symbol,
    componentId: `comp-${symbol.toLowerCase()}`
  }));
  return {
    macroSequence,
    microTensorSequence: new Float32Array(144),
    tensorShape: [1, 8, 18],
    uiContext: makeUiContext()
  };
}

const PATTERN_MAP = {
  'NAV_ANALYTICS > OPEN_FILTERS': 'highlight_primary_action'
} as const;

describe('normalized prediction contract — gate output', () => {
  it('Fast Gate emits a normalized prediction with the required identity fields', async () => {
    const gate = new MockFastGate({ patterns: PATTERN_MAP });
    const decision = await gate.evaluate(makeInferenceContext(['NAV_ANALYTICS', 'OPEN_FILTERS']).macroSequence);

    expect(decision.prediction).toBeDefined();
    expect(decision.prediction!.matched).toBe(true);
    expect(decision.prediction!.source).toBe('fast');
    expect(decision.prediction!.outcomeId).toBe('highlight_primary_action');
    expect(decision.prediction!.vocabularyVersion).toBe(INTERVENTION_OUTCOME_VOCABULARY_VERSION);
    expect(decision.prediction!.confidence).toBeGreaterThan(0);
  });

  it('Fast Gate emits no prediction when no pattern matches', async () => {
    const gate = new MockFastGate({ patterns: PATTERN_MAP });
    const decision = await gate.evaluate(makeInferenceContext(['HOVER_KPI']).macroSequence);
    expect(decision.matched).toBe(false);
    expect(decision.prediction).toBeUndefined();
  });

  it('Slow Gate emits a normalized prediction for an inferred outcome', async () => {
    const gate = new MockSlowGate({ outcome: 'HOVER_DWELL', confidence: 0.9 });
    const result = await gate.infer({
      sequence: new Float32Array(144),
      shape: [1, 8, 18],
      context: makeUiContext()
    });

    expect(result.prediction).toBeDefined();
    expect(result.prediction!.matched).toBe(true);
    expect(result.prediction!.source).toBe('slow');
    expect(result.prediction!.outcomeId).toBe('HOVER_DWELL');
    expect(result.prediction!.vocabularyVersion).toBe(FOUNDATION_OUTCOME_VOCABULARY_VERSION);
    expect(result.prediction!.confidence).toBeCloseTo(0.9);
  });

  it('Slow Gate reports an unmatched prediction when it infers NO_OUTCOME', async () => {
    const gate = new MockSlowGate({ outcome: 'NO_OUTCOME' as OutcomeType, confidence: 0 });
    const result = await gate.infer({
      sequence: new Float32Array(144),
      shape: [1, 8, 18],
      context: makeUiContext()
    });
    expect(result.prediction).toBeDefined();
    expect(result.prediction!.matched).toBe(false);
    expect(result.prediction!.outcomeId).toBe('NO_OUTCOME');
  });
});

describe('normalized prediction contract — arbitration', () => {
  it('stamps the selected prediction with identity, contract version and UI target', async () => {
    const engine = createAdaptiveInferenceEngine({
      fastGate: new MockFastGate({ patterns: PATTERN_MAP }),
      slowGate: new MockSlowGate({ outcome: 'HOVER_DWELL', confidence: 0.9 })
    });

    const result = await engine.evaluate(
      makeInferenceContext(['NAV_ANALYTICS', 'OPEN_FILTERS'])
    );

    expect(result.prediction).toBeDefined();
    expect(result.prediction!.predictionId).toMatch(/^pred_/);
    expect(result.prediction!.timestamp).toBe(result.timestamp);
    expect(result.prediction!.contractVersion).toBe(PREDICTION_CONTRACT_VERSION);
    expect(result.prediction!.target).toMatchObject({
      route: 'Analytics',
      componentId: 'filter-drawer'
    });
  });

  it('preserves gate, mapping source and latency provenance for a Fast Gate selection', async () => {
    const engine = new AdaptiveInferenceEngine({
      fastGate: new MockFastGate({ patterns: PATTERN_MAP }),
      slowGate: new MockSlowGate({ outcome: 'HOVER_DWELL', confidence: 0.9 })
    });

    const result = await engine.evaluate(
      makeInferenceContext(['NAV_ANALYTICS', 'OPEN_FILTERS'])
    );

    expect(result.prediction!.source).toBe('fast');
    expect(result.provenance.gate).toBe('fast');
    expect(result.provenance.mappingSource).toBe('fast_gate_pattern');
    expect(result.provenance.gateLatencyMs).toBeGreaterThanOrEqual(0);
    expect(result.provenance.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('selects the Slow Gate prediction when the Fast Gate misses', async () => {
    const engine = new AdaptiveInferenceEngine({
      fastGate: new MockFastGate({ patterns: PATTERN_MAP }),
      slowGate: new MockSlowGate({ outcome: 'HOVER_DWELL', confidence: 0.9 })
    });

    const result = await engine.evaluate(makeInferenceContext(['HOVER_KPI']));

    expect(result.prediction!.source).toBe('slow');
    expect(result.prediction!.outcomeId).toBe('HOVER_DWELL');
    expect(result.provenance.gate).toBe('slow');
    expect(result.provenance.mappingSource).toBe('deterministic_mapping');
  });

  it('leaves the prediction unstamped-but-absent when neither gate produces one', async () => {
    const engine = new AdaptiveInferenceEngine({
      fastGate: new MockFastGate({ patterns: PATTERN_MAP })
    });

    const result = await engine.evaluate(makeInferenceContext(['HOVER_KPI']));
    expect(result.prediction).toBeUndefined();
    expect(result.provenance.gate).toBe('none');
    expect(result.provenance.contractVersion).toBe(PREDICTION_CONTRACT_VERSION);
  });
});

describe('normalized prediction contract — policy output', () => {
  const resolver: CandidateResolver = {
    resolve(prediction) {
      if (prediction.outcomeId !== 'HOVER_DWELL') return null;
      return {
        type: 'expand_tooltip',
        source: prediction.source,
        confidence: prediction.confidence,
        issuedAt: prediction.timestamp,
        targetComponentId: prediction.target?.componentId,
        reason: `application mapping for ${prediction.outcomeId}`
      };
    }
  };

  function predictionFrom(overrides: Record<string, unknown> = {}) {
    return {
      predictionId: 'pred_test',
      outcomeId: 'HOVER_DWELL',
      vocabularyVersion: 'test-1.0.0',
      confidence: 0.9,
      matched: true,
      source: 'slow' as const,
      timestamp: 1700000000000,
      contractVersion: PREDICTION_CONTRACT_VERSION,
      target: { componentId: 'tooltip-region', route: 'Analytics' },
      ...overrides
    };
  }

  it('accepts a prediction plus UI context and returns the resolved candidate command', () => {
    const policy = new InterventionPolicy(
      { requiredConsecutiveWindows: 1 },
      { resolveCandidate: resolver }
    );

    const decision = policy.acceptPrediction(predictionFrom(), makeUiContext());

    expect(decision.accepted).toBe(true);
    expect(decision.command.type).toBe('expand_tooltip');
    expect(decision.command.targetComponentId).toBe('tooltip-region');
    expect(decision.prediction).toBeDefined();
    expect(decision.prediction!.predictionId).toBe('pred_test');
  });

  it('still enforces the confidence threshold on the resolved candidate', () => {
    const policy = new InterventionPolicy(
      { requiredConsecutiveWindows: 1, confidenceThreshold: 0.75 },
      { resolveCandidate: resolver }
    );

    const decision = policy.acceptPrediction(predictionFrom({ confidence: 0.4 }), makeUiContext());

    expect(decision.accepted).toBe(false);
    expect(decision.rejectionCategory).toBe('below_threshold');
  });

  it('still enforces consecutive-window persistence on the resolved candidate', () => {
    const policy = new InterventionPolicy(
      { requiredConsecutiveWindows: 2 },
      { resolveCandidate: resolver }
    );

    const first = policy.acceptPrediction(predictionFrom(), makeUiContext());
    const second = policy.acceptPrediction(predictionFrom(), makeUiContext());

    expect(first.accepted).toBe(false);
    expect(first.rejectionCategory).toBe('pending_persistence');
    expect(second.accepted).toBe(true);
  });

  it('maintains no_op when the application resolver has no mapping for the outcome', () => {
    const policy = new InterventionPolicy(
      { requiredConsecutiveWindows: 1 },
      { resolveCandidate: resolver }
    );

    const decision = policy.acceptPrediction(
      predictionFrom({ outcomeId: 'inspect_help' }),
      makeUiContext()
    );

    expect(decision.accepted).toBe(true);
    expect(decision.command.type).toBe('no_op');
    expect(decision.reason).toContain('inspect_help');
  });

  it('default resolver maps an outcome that is itself an intervention type (legacy vocabulary)', () => {
    const policy = new InterventionPolicy({ requiredConsecutiveWindows: 1 });
    const decision = policy.acceptPrediction(
      predictionFrom({
        outcomeId: 'highlight_primary_action',
        source: 'fast',
        target: { componentId: 'btn-apply-filters' }
      }),
      makeUiContext()
    );

    expect(decision.accepted).toBe(true);
    expect(decision.command.type).toBe('highlight_primary_action');
    expect(decision.command.source).toBe('fast');
  });

  it('default resolver refuses an outcome outside the intervention vocabulary', () => {
    const policy = new InterventionPolicy({ requiredConsecutiveWindows: 1 });
    const decision = policy.acceptPrediction(predictionFrom({ outcomeId: 'select_region' }), makeUiContext());

    expect(decision.accepted).toBe(true);
    expect(decision.command.type).toBe('no_op');
    expect(decision.reason).toContain('select_region');
  });
});
