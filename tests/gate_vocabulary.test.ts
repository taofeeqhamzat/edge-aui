/**
 * Configurable Gate Vocabularies (Task 20.3)
 *
 * Both gates used to own a hardcoded class order: the Slow Gate a 7-class outcome order and
 * a 5-class intervention order, the Fast Gate an intervention-only pattern map. A model
 * manifest now supplies the ordered vocabulary, its identity/version and the model version,
 * and every prediction records them.
 *
 * The legacy bundle keeps working: with no manifest supplied, the gate loads the same
 * `model_int8.onnx` / `intervention_head_int8.onnx` artifacts under the built-in 7/5-class
 * vocabularies.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  OnnxSlowGate,
  resetOnnxSlowGateSession,
  OUTCOME_CLASS_ORDER,
  TARGET_INTERVENTION_ORDER,
  SLOW_GATE_NUM_CLASSES,
  TARGET_INTERVENTION_NUM_CLASSES
} from '../src/gates/slow/onnxSlowGate';
import { FOUNDATION_OUTCOME_VOCABULARY_VERSION } from '../src/gates/slow/types';
import {
  DEFAULT_SLOW_GATE_MANIFEST,
  FOUNDATION_OUTCOME_CLASSES,
  INTERVENTION_CLASSES,
  parseBundleManifest,
  type SlowGateManifest
} from '../src/config/modelManifest';
import { MockFastGate } from '../src/gates/fast/mockFastGate';
import { PrefixSpanFastGate } from '../src/gates/fast/prefixSpanFastGate';
import type { UIContext } from '../src/types/uiContext';
import type { OutcomeVocabulary } from '../src/gates/contracts';

const CONTEXT: UIContext = {
  route: 'Anywhere',
  primaryActionAvailable: true,
  helpAvailable: true,
  expandable: true,
  availableActions: ['click']
};

function sequence(): Float32Array {
  return new Float32Array(8 * 18).fill(0.1);
}

/** Foundation-only fake runtime: `output` logits are supplied by the test. */
function mockFoundationOrt(logits: number[]) {
  return {
    env: { wasm: { numThreads: 1, simd: true } },
    Tensor: class {},
    InferenceSession: {
      create: async () => ({
        inputNames: ['sequence_input'],
        outputNames: ['output'],
        run: async () => ({ output: { data: new Float32Array(logits) } }),
        executionProvider: 'mock-wasm'
      })
    }
  };
}

/** Dual-head fake runtime, for the legacy compatibility path. */
function mockDualHeadOrt(foundationLogits: number[], interventionLogits: number[]) {
  let created = 0;
  return {
    env: { wasm: { numThreads: 1, simd: true } },
    Tensor: class {},
    InferenceSession: {
      create: async () => {
        created += 1;
        return created === 1
          ? {
              inputNames: ['sequence_input'],
              outputNames: ['output'],
              run: async () => ({ output: { data: new Float32Array(foundationLogits) } }),
              executionProvider: 'mock-wasm'
            }
          : {
              inputNames: ['sequence_input', 'context_input'],
              outputNames: ['intervention_logits'],
              run: async () => ({
                intervention_logits: { data: new Float32Array(interventionLogits) }
              }),
              executionProvider: 'mock-wasm'
            };
      }
    }
  };
}

const TWO_CLASS_FOUNDATION: OutcomeVocabulary = {
  id: 'fixture-foundation',
  version: 'fixture/2.0.0',
  outcomes: ['idle_state', 'engaged_state']
};

const TWO_CLASS_MANIFEST: SlowGateManifest = {
  foundation: {
    modelUrl: '/models/model_int8.onnx',
    vocabulary: TWO_CLASS_FOUNDATION,
    modelVersion: 'grid-c1-v2.0.0'
  }
};

describe('model manifest', () => {
  it('declares the built-in vocabularies and the legacy artifact paths', () => {
    expect(DEFAULT_SLOW_GATE_MANIFEST.foundation.vocabulary.outcomes).toEqual([
      ...FOUNDATION_OUTCOME_CLASSES
    ]);
    expect(DEFAULT_SLOW_GATE_MANIFEST.intervention?.vocabulary.outcomes).toEqual([
      ...INTERVENTION_CLASSES
    ]);
    expect(DEFAULT_SLOW_GATE_MANIFEST.foundation.modelUrl).toContain('model_int8.onnx');
    expect(DEFAULT_SLOW_GATE_MANIFEST.intervention?.modelUrl).toContain(
      'intervention_head_int8.onnx'
    );
  });

  it('keeps the legacy exported class orders equal to the manifest', () => {
    expect(OUTCOME_CLASS_ORDER).toEqual([...FOUNDATION_OUTCOME_CLASSES]);
    expect(SLOW_GATE_NUM_CLASSES).toBe(OUTCOME_CLASS_ORDER.length);
    expect(TARGET_INTERVENTION_ORDER).toEqual([...INTERVENTION_CLASSES]);
    expect(TARGET_INTERVENTION_NUM_CLASSES).toBe(TARGET_INTERVENTION_ORDER.length);
  });

  it('parses a model-preparation bundle manifest into the runtime contract', () => {
    const manifest = parseBundleManifest({
      model_artifact_int8: 'intervention_head_int8.onnx',
      onnx_hash_sha256: '89d4549a81195da8b3563240bb13a5f30d72a13b8174ba67621edef6db84b5c0',
      output_contract: { intervention_logits: { shape: ['batch', 5] } },
      intervention_vocabulary: ['simplify_options', 'highlight_primary_action', 'offer_assistance', 'expand_tooltip', 'no_op']
    });

    expect(manifest.intervention?.vocabulary.outcomes).toEqual([
      'simplify_options',
      'highlight_primary_action',
      'offer_assistance',
      'expand_tooltip',
      'no_op'
    ]);
    // The artifact hash is the version identity of the graph that was actually exported.
    expect(manifest.intervention?.modelVersion).toContain('89d4549a8119');
  });

  it('rejects a bundle manifest whose vocabulary contradicts its declared output shape', () => {
    expect(() =>
      parseBundleManifest({
        model_artifact_int8: 'intervention_head_int8.onnx',
        output_contract: { intervention_logits: { shape: ['batch', 5] } },
        intervention_vocabulary: ['no_op', 'offer_assistance']
      })
    ).toThrow(/vocabulary/i);
  });
});

describe('Slow Gate vocabulary is configurable', () => {
  beforeEach(() => {
    resetOnnxSlowGateSession();
  });

  it('maps the model output index through the configured vocabulary order', async () => {
    const gate = new OnnxSlowGate({
      ortModule: mockFoundationOrt([0.1, 4.0]) as never,
      manifest: TWO_CLASS_MANIFEST
    });

    const result = await gate.infer({ sequence: sequence(), shape: [1, 8, 18], context: CONTEXT });

    expect(result.prediction?.outcomeId).toBe('engaged_state');
    expect(result.prediction?.outcomeIndex).toBe(1);
    expect(result.prediction?.vocabularyId).toBe('fixture-foundation');
    expect(result.prediction?.vocabularyVersion).toBe('fixture/2.0.0');
    expect(result.prediction?.modelVersion).toBe('grid-c1-v2.0.0');
    // The generic outcome taxonomy does not describe a custom vocabulary.
    expect(result.outcome).toBeUndefined();
  });

  it('fails visibly when the vocabulary length contradicts the model output dimension', async () => {
    const gate = new OnnxSlowGate({
      ortModule: mockFoundationOrt([0.1, 0.2, 0.3]) as never,
      manifest: TWO_CLASS_MANIFEST
    });

    await expect(
      gate.infer({ sequence: sequence(), shape: [1, 8, 18], context: CONTEXT })
    ).rejects.toThrow(/fixture-foundation/);
  });
});

describe('Slow Gate legacy compatibility', () => {
  beforeEach(() => {
    resetOnnxSlowGateSession();
  });

  it('loads the bundled artifacts under the built-in vocabularies when no manifest is given', async () => {
    const foundationLogits = [0, 0, 0, 0, 0, 6, 0]; // HOVER_DWELL
    const interventionLogits = [0, 0, 0, 6, 0]; // expand_tooltip
    const gate = new OnnxSlowGate({
      ortModule: mockDualHeadOrt(foundationLogits, interventionLogits) as never
    });

    const result = await gate.infer({ sequence: sequence(), shape: [1, 8, 18], context: CONTEXT });

    expect(result.outcome).toBe('HOVER_DWELL');
    expect(result.prediction?.outcomeId).toBe('expand_tooltip');
    expect(result.prediction?.vocabularyId).toBe('intervention');
    expect(result.prediction?.vocabularyVersion).toBe(
      DEFAULT_SLOW_GATE_MANIFEST.intervention?.vocabulary.version
    );
    expect(result.prediction?.modelVersion).toBe(
      DEFAULT_SLOW_GATE_MANIFEST.intervention?.modelVersion
    );
    expect(result.prediction?.mappingSource).toBe('learned_head');
  });

  it('keeps the deterministic mapping path on the configured foundation vocabulary', async () => {
    const gate = new OnnxSlowGate({
      ortModule: mockDualHeadOrt([0, 0, 0, 6, 0, 0, 0], [0, 0, 0, 0, 0]) as never,
      useDeterministicMapping: true
    });

    const result = await gate.infer({ sequence: sequence(), shape: [1, 8, 18], context: CONTEXT });

    expect(result.outcome).toBe('BACKTRACK');
    expect(result.prediction?.outcomeId).toBe('BACKTRACK');
    expect(result.prediction?.vocabularyVersion).toBe(FOUNDATION_OUTCOME_VOCABULARY_VERSION);
    expect(result.prediction?.mappingSource).toBe('deterministic_mapping');
  });
});

const SEMANTIC_VOCABULARY: OutcomeVocabulary = {
  id: 'testbed-semantic',
  version: 'semantic/1.0.0',
  outcomes: ['apply_filter', 'export_report', 'select_report']
};

describe('Fast Gate pattern → normalized outcome', () => {
  function macroInteractions(symbols: string[]) {
    return symbols.map((symbol, index) => ({
      timestamp: 1000 + index,
      symbol,
      componentId: 'any'
    }));
  }

  it('returns a normalized prediction for a declared semantic outcome', async () => {
    const gate = new MockFastGate({
      outcomeVocabulary: SEMANTIC_VOCABULARY,
      patterns: {
        'SYMBOL_A > SYMBOL_B': { outcomeId: 'apply_filter', confidence: 0.42 }
      }
    });

    const decision = await gate.evaluate(macroInteractions(['SYMBOL_A', 'SYMBOL_B']));

    expect(decision.matched).toBe(true);
    expect(decision.prediction?.outcomeId).toBe('apply_filter');
    expect(decision.prediction?.confidence).toBeCloseTo(0.42);
    expect(decision.prediction?.vocabularyVersion).toBe('semantic/1.0.0');
    expect(decision.prediction?.outcomeIndex).toBe(0);
    // No intervention command: the application resolver owns that mapping (Task 20.1).
    expect(decision.intervention).toBeUndefined();
  });

  it('still accepts a legacy intervention pattern', async () => {
    const gate = new MockFastGate({
      patterns: { 'SYMBOL_A': 'highlight_primary_action' }
    });

    const decision = await gate.evaluate(macroInteractions(['SYMBOL_A']));

    expect(decision.prediction?.outcomeId).toBe('highlight_primary_action');
    expect(decision.intervention?.type).toBe('highlight_primary_action');
  });

  it('rejects a pattern whose outcome is outside the configured vocabulary', () => {
    expect(
      () =>
        new MockFastGate({
          outcomeVocabulary: SEMANTIC_VOCABULARY,
          patterns: { 'SYMBOL_A': { outcomeId: 'not_in_vocabulary' } }
        })
    ).toThrow(/not_in_vocabulary/);
  });

  it('carries a semantic outcome through the mined-pattern gate', async () => {
    const gate = new PrefixSpanFastGate({
      getSequences: () => [['SYMBOL_A', 'SYMBOL_B']],
      outcomeVocabulary: SEMANTIC_VOCABULARY,
      mine: async () => [
        { pattern: ['SYMBOL_A', 'SYMBOL_B'], support: 2, confidence: 0.9 }
      ],
      resolveIntervention: () => ({ outcomeId: 'select_report', confidence: 0.8 }),
      minSupport: 1
    });

    const decision = await gate.evaluate(macroInteractions(['SYMBOL_A', 'SYMBOL_B']));

    expect(decision.prediction?.outcomeId).toBe('select_report');
    expect(decision.prediction?.outcomeIndex).toBe(2);
    expect(decision.prediction?.vocabularyVersion).toBe('semantic/1.0.0');
    expect(decision.prediction?.confidence).toBeCloseTo(0.8);
    expect(decision.intervention).toBeUndefined();
  });
});
