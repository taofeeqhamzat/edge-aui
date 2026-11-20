import { describe, it, expect, vi } from 'vitest';
import {
  AdaptiveInferenceEngine,
  createAdaptiveInferenceEngine,
  InferenceContext
} from '../src/gates/arbitration';
import { MockFastGate } from '../src/gates/fast/mockFastGate';
import { MockSlowGate } from '../src/gates/slow/mockSlowGate';
import { MacroInteraction } from '../src/telemetry/events';
import { UIContext } from '../src/types/uiContext';
import { PREDICTION_CONTRACT_VERSION } from '../src/gates/contracts';
import { createTestbedCandidateResolver } from '../src/testbed/config/policyAdapter';

function createMockContext(macroSymbols: string[] = []): InferenceContext {
  const macroSequence: MacroInteraction[] = macroSymbols.map((sym, idx) => ({
    timestamp: 1000 + idx * 100,
    symbol: sym,
    componentId: `comp-${sym.toLowerCase()}`
  }));

  const microTensorSequence = new Float32Array(144);
  for (let i = 0; i < 144; i++) {
    microTensorSequence[i] = (i % 18) / 18.0;
  }

  const uiContext: UIContext = {
    route: 'Analytics',
    activeComponentId: 'filter-drawer',
    componentRole: 'accordion',
    availableActions: ['click'],
    primaryActionAvailable: true,
    helpAvailable: true,
    expandable: true
  };

  return {
    macroSequence,
    microTensorSequence,
    tensorShape: [1, 8, 18],
    uiContext
  };
}

describe('AdaptiveInferenceEngine Dual-Gate Arbitration', () => {
  it('ADR-002: Fast Gate match short-circuits Slow Gate (Slow Gate is NOT called)', async () => {
    const fastGate = new MockFastGate({
      patterns: {
        'NAV_ANALYTICS > OPEN_FILTERS': 'highlight_primary_action'
      }
    });

    const slowGate = new MockSlowGate({
      intervention: 'offer_assistance',
      confidence: 0.99
    });

    const slowGateSpy = vi.spyOn(slowGate, 'infer');

    const engine = createAdaptiveInferenceEngine({
      fastGate,
      slowGate
    });

    const context = createMockContext(['NAV_ANALYTICS', 'OPEN_FILTERS']);
    const result = await engine.evaluate(context);

    // Assert Fast Gate matched
    expect(result.matchedGate).toBe('fast');
    expect(result.intervention?.type).toBe('highlight_primary_action');
    expect(result.intervention?.source).toBe('fast');

    // Assert Slow Gate was NEVER called
    expect(slowGateSpy).not.toHaveBeenCalled();
    expect(result.slowResult).toBeUndefined();
  });

  it('Fast Gate miss invokes Slow Gate with MicroTensor sequence and UIContext', async () => {
    const fastGate = new MockFastGate({
      patterns: {
        'NAV_ANALYTICS > OPEN_FILTERS': 'highlight_primary_action'
      }
    });

    const slowGate = new MockSlowGate({
      outcome: 'HOVER_DWELL',
      intervention: 'expand_tooltip',
      confidence: 0.88
    });

    const slowGateSpy = vi.spyOn(slowGate, 'infer');

    const engine = new AdaptiveInferenceEngine({
      fastGate,
      slowGate
    });

    // Sequence that does not match Fast Gate pattern
    const context = createMockContext(['NAV_OVERVIEW', 'HOVER_KPI']);
    const result = await engine.evaluate(context);

    // Fast Gate should miss
    expect(result.fastDecision.matched).toBe(false);

    // Slow Gate should have been invoked
    expect(slowGateSpy).toHaveBeenCalledTimes(1);
    expect(slowGateSpy).toHaveBeenCalledWith({
      sequence: context.microTensorSequence,
      shape: [1, 8, 18],
      context: context.uiContext
    });

    expect(result.matchedGate).toBe('slow');
    expect(result.intervention?.type).toBe('expand_tooltip');
    expect(result.intervention?.source).toBe('slow');
    expect(result.intervention?.confidence).toBe(0.88);
  });

  it('returns matchedGate: "none" when both Fast Gate and Slow Gate miss', async () => {
    const fastGate = new MockFastGate({
      patterns: {
        'NAV_ANALYTICS > OPEN_FILTERS': 'highlight_primary_action'
      }
    });

    const slowGate = new MockSlowGate({
      outcome: 'NO_OUTCOME',
      intervention: undefined // No intervention
    });

    const engine = new AdaptiveInferenceEngine({
      fastGate,
      slowGate
    });

    const context = createMockContext(['NAV_SETTINGS']);
    const result = await engine.evaluate(context);

    expect(result.matchedGate).toBe('none');
    expect(result.intervention).toBeUndefined();
    expect(result.fastDecision.matched).toBe(false);
    expect(result.slowResult).toBeDefined();
  });

  it('respects enableFastGate: false by skipping Fast Gate entirely', async () => {
    const fastGate = new MockFastGate({
      patterns: {
        'NAV_ANALYTICS > OPEN_FILTERS': 'highlight_primary_action'
      }
    });

    const slowGate = new MockSlowGate({
      intervention: 'offer_assistance'
    });

    const fastGateSpy = vi.spyOn(fastGate, 'evaluate');
    const slowGateSpy = vi.spyOn(slowGate, 'infer');

    const engine = new AdaptiveInferenceEngine({
      fastGate,
      slowGate,
      enableFastGate: false
    });

    const context = createMockContext(['NAV_ANALYTICS', 'OPEN_FILTERS']);
    const result = await engine.evaluate(context);

    expect(fastGateSpy).not.toHaveBeenCalled();
    expect(slowGateSpy).toHaveBeenCalledTimes(1);
    expect(result.matchedGate).toBe('slow');
    expect(result.intervention?.type).toBe('offer_assistance');
  });

  it('respects enableSlowGate: false by skipping Slow Gate on Fast Gate miss', async () => {
    const fastGate = new MockFastGate();
    const slowGate = new MockSlowGate({ intervention: 'expand_tooltip' });

    const slowGateSpy = vi.spyOn(slowGate, 'infer');

    const engine = new AdaptiveInferenceEngine({
      fastGate,
      slowGate,
      enableSlowGate: false
    });

    const context = createMockContext(['NAV_SETTINGS']);
    const result = await engine.evaluate(context);

    expect(slowGateSpy).not.toHaveBeenCalled();
    expect(result.matchedGate).toBe('none');
    expect(result.intervention).toBeUndefined();
  });

  it('tracks latency and execution timestamps accurately', async () => {
    const slowGate = new MockSlowGate({
      intervention: 'offer_assistance',
      delayMs: 15
    });

    const engine = new AdaptiveInferenceEngine({ slowGate });
    const context = createMockContext();

    const before = Date.now();
    const result = await engine.evaluate(context);
    const after = Date.now();

    expect(result.latencyMs).toBeGreaterThanOrEqual(10);
    expect(result.timestamp).toBeGreaterThanOrEqual(before);
    expect(result.timestamp).toBeLessThanOrEqual(after);
  });

  it('supports runtime reconfiguration of gates and feature flags', async () => {
    const engine = new AdaptiveInferenceEngine();

    const fastGate = new MockFastGate({
      patterns: { 'NAV_ANALYTICS': 'highlight_primary_action' }
    });

    engine.setFastGate(fastGate);
    expect(engine.isFastGateEnabled()).toBe(true);

    const context = createMockContext(['NAV_ANALYTICS']);
    let result = await engine.evaluate(context);
    expect(result.matchedGate).toBe('fast');

    engine.setEnableFastGate(false);
    expect(engine.isFastGateEnabled()).toBe(false);

    result = await engine.evaluate(context);
    expect(result.matchedGate).toBe('none');
  });

  it('handles gate runtime exceptions gracefully without crashing', async () => {
    const faultyFastGate = {
      evaluate: vi.fn().mockRejectedValue(new Error('WASM crash simulation'))
    };

    const slowGate = new MockSlowGate({ intervention: 'expand_tooltip' });

    const engine = new AdaptiveInferenceEngine({
      fastGate: faultyFastGate as any,
      slowGate
    });

    const context = createMockContext(['NAV_ANALYTICS']);
    const result = await engine.evaluate(context);

    // Should catch Fast Gate error, treat as miss, and fall back to Slow Gate
    expect(result.matchedGate).toBe('slow');
    expect(result.intervention?.type).toBe('expand_tooltip');
  });
});

/**
 * Shared normalized contract (Task 50.3)
 *
 * Arbitration is the single place that promotes a gate prediction to `PredictionResult`.
 * These tests pin what both gates must agree on, that provenance survives the decision, and
 * that "no gate predicted" is a result with a reason rather than an unexplained absence.
 */
describe('Shared arbitration contract (Task 50.3)', () => {
  const uiContext: UIContext = {
    route: 'Analytics',
    activeComponentId: 'filter-drawer',
    componentRole: 'accordion',
    availableActions: ['click'],
    primaryActionAvailable: true,
    helpAvailable: true,
    expandable: true
  };

  function contextFor(symbols: string[]): InferenceContext {
    return {
      macroSequence: symbols.map((symbol, index) => ({ timestamp: index * 100, symbol })),
      microTensorSequence: new Float32Array(8 * 18),
      tensorShape: [1, 8, 18],
      uiContext
    };
  }

  it('both gates produce the same normalized PredictionResult fields', async () => {
    const fast = createAdaptiveInferenceEngine({
      fastGate: new MockFastGate({ patterns: { 'NAV_ANALYTICS': 'highlight_primary_action' } }),
      slowGate: new MockSlowGate({ intervention: 'offer_assistance' })
    });
    const fastResult = await fast.evaluate(contextFor(['NAV_ANALYTICS']));
    expect(fastResult.matchedGate).toBe('fast');

    const slow = createAdaptiveInferenceEngine({
      fastGate: new MockFastGate(),
      slowGate: new MockSlowGate({ outcome: 'HOVER_DWELL', intervention: 'expand_tooltip' })
    });
    const slowResult = await slow.evaluate(contextFor(['NAV_SETTINGS']));
    expect(slowResult.matchedGate).toBe('slow');

    const requiredFields = [
      'outcomeId',
      'vocabularyVersion',
      'confidence',
      'matched',
      'source',
      'predictionId',
      'timestamp',
      'contractVersion'
    ];

    for (const field of requiredFields) {
      expect(fastResult.prediction).toHaveProperty(field);
      expect(slowResult.prediction).toHaveProperty(field);
    }
    expect(fastResult.prediction?.contractVersion).toBe(PREDICTION_CONTRACT_VERSION);
    expect(slowResult.prediction?.contractVersion).toBe(PREDICTION_CONTRACT_VERSION);
    expect(fastResult.prediction?.predictionId).toMatch(/^pred_/);
    expect(slowResult.prediction?.predictionId).toMatch(/^pred_/);
    // Identity is issued once, so two predictions cannot share an id.
    expect(fastResult.prediction?.predictionId).not.toBe(slowResult.prediction?.predictionId);
  });

  it('preserves gate, pattern, version, mapping source and latency for a Fast decision', async () => {
    const fastGate = new MockFastGate({
      patterns: {
        'CLOSE_FILTERS > OPEN_FILTERS': { outcomeId: 'open_filter_section' }
      },
      outcomeVocabulary: {
        id: 'testbed-semantic',
        version: 'testbed-semantic/1.0.0',
        outcomes: ['open_filter_section']
      },
      gateVersion: 'testbed-patterns/2.0.0'
    });

    const engine = createAdaptiveInferenceEngine({
      fastGate,
      slowGate: new MockSlowGate({ intervention: 'offer_assistance' })
    });
    const result = await engine.evaluate(contextFor(['CLOSE_FILTERS', 'OPEN_FILTERS']));

    expect(result.matchedGate).toBe('fast');
    expect(result.prediction?.outcomeId).toBe('open_filter_section');
    expect(result.fastDecision.matchedPattern).toEqual(['CLOSE_FILTERS', 'OPEN_FILTERS']);
    expect(result.provenance).toMatchObject({
      gate: 'fast',
      gateVersion: 'testbed-patterns/2.0.0',
      mappingSource: 'fast_gate_pattern',
      contractVersion: PREDICTION_CONTRACT_VERSION
    });
    expect(result.provenance.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.provenance.gateLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('selects the Slow Gate when it asserts a prediction even without an actionable command', async () => {
    const slowGate = {
      async infer() {
        return {
          source: 'slow' as const,
          gateVersion: 'slow-head/2.0.0',
          outcome: 'HOVER_DWELL' as const,
          confidence: 0.9,
          prediction: {
            outcomeId: 'HOVER_DWELL',
            vocabularyVersion: 'foundation/1.0.0',
            confidence: 0.9,
            matched: true,
            source: 'slow' as const,
            mappingSource: 'learned_head' as const
          },
          intervention: {
            type: 'no_op' as const,
            source: 'slow' as const,
            confidence: 0.9,
            issuedAt: 0,
            reason: 'compatibility command'
          }
        };
      }
    };

    const engine = createAdaptiveInferenceEngine({
      fastGate: new MockFastGate(),
      slowGate
    });
    const result = await engine.evaluate(contextFor(['NAV_SETTINGS']));

    // A matched prediction is the decision. Selecting only on the command left
    // `matchedGate: 'none'` beside a matched Slow prediction.
    expect(result.matchedGate).toBe('slow');
    expect(result.prediction?.matched).toBe(true);
    expect(result.prediction?.outcomeId).toBe('HOVER_DWELL');
    expect(result.provenance.gate).toBe('slow');
    expect(result.provenance.gateVersion).toBe('slow-head/2.0.0');
    expect(result.provenance.mappingSource).toBe('learned_head');
  });

  it('reports the Fast Gate as deciding when it matched but declared no adaptation', async () => {
    // A match that resolves to `no_op` does not short-circuit (the Slow Gate gets a chance),
    // but if the Slow Gate has nothing, the Fast prediction is still the decision. The
    // decision and the prediction must not disagree about which gate produced it.
    const engine = createAdaptiveInferenceEngine({
      fastGate: new MockFastGate({ patterns: { 'NAV_ANALYTICS': 'no_op' } }),
      slowGate: new MockSlowGate({ outcome: 'NO_OUTCOME', intervention: undefined })
    });
    const result = await engine.evaluate(contextFor(['NAV_ANALYTICS']));

    expect(result.matchedGate).toBe('fast');
    expect(result.prediction?.matched).toBe(true);
    expect(result.provenance.gate).toBe('fast');
    expect(result.noMatchReason).toBeUndefined();
  });

  it('returns a no-match reason and no asserted prediction when both gates miss', async () => {
    const engine = createAdaptiveInferenceEngine({
      fastGate: new MockFastGate({ patterns: { 'NAV_ANALYTICS': 'highlight_primary_action' } }),
      slowGate: new MockSlowGate({ outcome: 'NO_OUTCOME', intervention: undefined })
    });
    const result = await engine.evaluate(contextFor(['NAV_SETTINGS']));

    expect(result.matchedGate).toBe('none');
    expect(result.prediction?.matched).toBe(false);
    expect(result.noMatchReason).toBe('fast:no_matching_pattern');
  });

  it('hands the policy the selected normalized prediction and context, not a gate command', async () => {
    const fastGate = new MockFastGate({
      patterns: { 'CLOSE_FILTERS > OPEN_FILTERS': { outcomeId: 'open_filter_section' } },
      outcomeVocabulary: {
        id: 'testbed-semantic',
        version: 'testbed-semantic/1.0.0',
        outcomes: ['open_filter_section']
      }
    });
    const engine = createAdaptiveInferenceEngine({
      fastGate,
      slowGate: new MockSlowGate({ intervention: 'offer_assistance' })
    });
    const result = await engine.evaluate(contextFor(['CLOSE_FILTERS', 'OPEN_FILTERS']));

    expect(result.prediction).toBeDefined();
    // The testbed's candidate resolver turns the semantic outcome into an adaptation; the
    // gate itself need not have emitted a command.
    const command = createTestbedCandidateResolver().resolve(result.prediction!, uiContext);
    expect(command?.type).toBe('simplify_options');
    expect(command?.source).toBe('fast');
    expect(command?.reason).toContain('open_filter_section');
  });
});
