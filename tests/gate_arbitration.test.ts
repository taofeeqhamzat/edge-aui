import { describe, it, expect, vi } from 'vitest';
import {
  AdaptiveInferenceEngine,
  createAdaptiveInferenceEngine,
  InferenceContext
} from '../src/gates/arbitration';
import { MockFastGate } from '../src/gates/fast/mockFastGate';
import { MockSlowGate } from '../src/gates/slow/mockSlowGate';
import { MacroInteraction } from '../src/telemetry/events';
import { UIContext } from '../src/types/telemetry';

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
