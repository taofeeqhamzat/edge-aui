/**
 * Trace Mapping Attribution & Schema 1.2.0 Contract Tests (Task 5.3 / ADR-006)
 *
 * Verifies that:
 * 1. Each intervention episode in the trace carries `mappingSource` from the closed taxonomy:
 *    ('learned_head' | 'deterministic_mapping' | 'fast_gate_pattern').
 * 2. Each prediction record carries `modelVersion` and `contextEncodingVersion`.
 * 3. The trace schema version is bumped to 1.2.0, and older 1.1.0 traces can still be read
 *    with valid backward compatibility.
 * 4. Traces with learned-head interventions and deterministic interventions are distinguishable programmatically.
 * 5. PrefixSpan Fast Gate interventions carry mappingSource: 'fast_gate_pattern'.
 */

import { describe, it, expect } from 'vitest';
import {
  EXPERIMENT_TRACE_SCHEMA_VERSION,
  SUPPORTED_EXPERIMENT_TRACE_SCHEMA_VERSIONS,
  validateExperimentTrace,
  type SerializableExperimentTrace
} from '../src/telemetry/traceSchema';
import { ExperimentRecorder } from '../src/telemetry/recorder';
import { OnnxSlowGate, resetOnnxSlowGateSession } from '../src/gates/slow/onnxSlowGate';
import { PrefixSpanFastGate } from '../src/gates/fast/prefixSpanFastGate';
import { UIContext } from '../src/types/uiContext';
import { MappingSource } from '../src/telemetry/events';

describe('Task 5.3: Trace Mapping Attribution & Schema 1.2.0', () => {
  it('declares EXPERIMENT_TRACE_SCHEMA_VERSION = "1.2.0" and supports legacy 1.1.0', () => {
    expect(EXPERIMENT_TRACE_SCHEMA_VERSION).toBe('1.2.0');
    expect(SUPPORTED_EXPERIMENT_TRACE_SCHEMA_VERSIONS).toContain('1.2.0');
    expect(SUPPORTED_EXPERIMENT_TRACE_SCHEMA_VERSIONS).toContain('1.1.0');
  });

  it('validates a schema 1.2.0 trace with mappingSource and model attribution', () => {
    const trace: SerializableExperimentTrace = {
      schemaVersion: '1.2.0',
      exportedAt: new Date().toISOString(),
      session: {
        sessionId: 'test-session-120',
        startedAt: 100,
        startedAtEpochMs: Date.now(),
        experimentId: 'exp-trace-attribution',
        conditionId: 'adaptive',
        taskId: 'T1'
      },
      metadata: {
        durationMs: 5000,
        totalEvents: 3,
        behaviourCount: 0,
        microTensorCount: 1,
        macroCount: 0,
        outcomeCount: 0,
        predictionCount: 1,
        interventionCount: 1,
        taskEventCount: 0,
        conditionId: 'adaptive'
      },
      behaviourEvents: [],
      microTensors: [
        {
          windowId: 1,
          windowStart: 100,
          windowEnd: 600,
          values: new Array(18).fill(0.1)
        }
      ],
      macroInteractions: [],
      outcomes: [],
      predictions: [
        {
          timestamp: 600,
          sessionId: 'test-session-120',
          experimentId: 'exp-trace-attribution',
          conditionId: 'adaptive',
          windowId: 1,
          matchedGate: 'slow',
          outcome: 'BACKTRACK',
          interventionType: 'simplify_options',
          mappingSource: 'learned_head',
          confidence: 0.85,
          latencyMs: 12.4,
          modelVersion: 'TargetInterventionHead-v1.0.0-int8',
          contextEncodingVersion: 'R6-v1.0.0',
          bothGatesEvaluated: false
        }
      ],
      interventions: [
        {
          timestamp: 610,
          type: 'applied',
          intervention: 'simplify_options',
          source: 'slow',
          mappingSource: 'learned_head',
          confidence: 0.85,
          interventionEpisodeId: 'ep_1',
          sessionId: 'test-session-120',
          experimentId: 'exp-trace-attribution',
          conditionId: 'adaptive',
          windowId: 1
        }
      ],
      taskEvents: []
    };

    const validation = validateExperimentTrace(trace);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
    expect(validation.isLegacyVersion).toBe(false);
  });

  it('provides backward compatibility for schema 1.1.0 traces while identifying legacy status', () => {
    const legacyTrace = {
      schemaVersion: '1.1.0',
      exportedAt: new Date().toISOString(),
      session: {
        sessionId: 'legacy-session-110',
        startedAt: 50,
        startedAtEpochMs: Date.now(),
        conditionId: 'baseline'
      },
      metadata: {
        durationMs: 2000,
        totalEvents: 0,
        behaviourCount: 0,
        microTensorCount: 0,
        macroCount: 0,
        outcomeCount: 0,
        predictionCount: 0,
        interventionCount: 0,
        taskEventCount: 0,
        conditionId: 'baseline'
      },
      behaviourEvents: [],
      microTensors: [],
      macroInteractions: [],
      outcomes: [],
      predictions: [],
      interventions: [],
      taskEvents: []
    };

    const validation = validateExperimentTrace(legacyTrace);
    expect(validation.valid).toBe(true);
    expect(validation.isLegacyVersion).toBe(true);
  });

  it('rejects unsupported trace versions with an actionable message', () => {
    const unsupportedTrace = {
      schemaVersion: '0.8.0',
      exportedAt: new Date().toISOString(),
      session: { sessionId: 'bad' },
      metadata: { totalEvents: 0, durationMs: 0, conditionId: 'baseline' },
      behaviourEvents: [],
      microTensors: [],
      macroInteractions: [],
      outcomes: [],
      predictions: [],
      interventions: [],
      taskEvents: []
    };

    const validation = validateExperimentTrace(unsupportedTrace);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => e.includes("expected '1.2.0' (or supported legacy '1.1.0')"))).toBe(true);
  });

  it('programmatically distinguishes traces generated by learned_head vs deterministic_mapping vs fast_gate_pattern', () => {
    function filterInterventionsByMapping(
      trace: SerializableExperimentTrace,
      mapping: MappingSource
    ) {
      return trace.interventions.filter((inv) => inv.mappingSource === mapping);
    }

    const learnedTrace: SerializableExperimentTrace = {
      schemaVersion: '1.2.0',
      exportedAt: new Date().toISOString(),
      session: { sessionId: 'sess-learned', startedAt: 0, conditionId: 'adaptive' },
      metadata: {
        durationMs: 1000,
        totalEvents: 1,
        behaviourCount: 0,
        microTensorCount: 0,
        macroCount: 0,
        outcomeCount: 0,
        predictionCount: 0,
        interventionCount: 1,
        taskEventCount: 0,
        conditionId: 'adaptive'
      },
      behaviourEvents: [],
      microTensors: [],
      macroInteractions: [],
      outcomes: [],
      predictions: [],
      interventions: [
        {
          timestamp: 100,
          type: 'applied',
          intervention: 'highlight_primary_action',
          source: 'slow',
          mappingSource: 'learned_head',
          interventionEpisodeId: 'ep_1'
        }
      ],
      taskEvents: []
    };

    const deterministicTrace: SerializableExperimentTrace = {
      schemaVersion: '1.2.0',
      exportedAt: new Date().toISOString(),
      session: { sessionId: 'sess-determ', startedAt: 0, conditionId: 'adaptive' },
      metadata: {
        durationMs: 1000,
        totalEvents: 1,
        behaviourCount: 0,
        microTensorCount: 0,
        macroCount: 0,
        outcomeCount: 0,
        predictionCount: 0,
        interventionCount: 1,
        taskEventCount: 0,
        conditionId: 'adaptive'
      },
      behaviourEvents: [],
      microTensors: [],
      macroInteractions: [],
      outcomes: [],
      predictions: [],
      interventions: [
        {
          timestamp: 100,
          type: 'applied',
          intervention: 'offer_assistance',
          source: 'slow',
          mappingSource: 'deterministic_mapping',
          interventionEpisodeId: 'ep_2'
        }
      ],
      taskEvents: []
    };

    const fastGateTrace: SerializableExperimentTrace = {
      schemaVersion: '1.2.0',
      exportedAt: new Date().toISOString(),
      session: { sessionId: 'sess-fast', startedAt: 0, conditionId: 'adaptive' },
      metadata: {
        durationMs: 1000,
        totalEvents: 1,
        behaviourCount: 0,
        microTensorCount: 0,
        macroCount: 0,
        outcomeCount: 0,
        predictionCount: 0,
        interventionCount: 1,
        taskEventCount: 0,
        conditionId: 'adaptive'
      },
      behaviourEvents: [],
      microTensors: [],
      macroInteractions: [],
      outcomes: [],
      predictions: [],
      interventions: [
        {
          timestamp: 100,
          type: 'applied',
          intervention: 'simplify_options',
          source: 'fast',
          mappingSource: 'fast_gate_pattern',
          interventionEpisodeId: 'ep_3'
        }
      ],
      taskEvents: []
    };

    // Assert programmatic distinction across mapping sources
    expect(filterInterventionsByMapping(learnedTrace, 'learned_head')).toHaveLength(1);
    expect(filterInterventionsByMapping(learnedTrace, 'deterministic_mapping')).toHaveLength(0);

    expect(filterInterventionsByMapping(deterministicTrace, 'deterministic_mapping')).toHaveLength(1);
    expect(filterInterventionsByMapping(deterministicTrace, 'learned_head')).toHaveLength(0);

    expect(filterInterventionsByMapping(fastGateTrace, 'fast_gate_pattern')).toHaveLength(1);
    expect(filterInterventionsByMapping(fastGateTrace, 'learned_head')).toHaveLength(0);
  });

  it('verifies that PrefixSpanFastGate emits mappingSource: "fast_gate_pattern"', async () => {
    const mockMiner = async () => [
      { pattern: ['NAV_OVERVIEW', 'NAV_REPORTS'], support: 3, confidence: 0.9 }
    ];

    const gate = new PrefixSpanFastGate({
      mine: mockMiner,
      getSequences: () => [['NAV_OVERVIEW', 'NAV_REPORTS']],
      resolveIntervention: () => ({ type: 'simplify_options' })
    });

    const result = await gate.evaluate([
      { timestamp: 1, symbol: 'NAV_OVERVIEW' },
      { timestamp: 2, symbol: 'NAV_REPORTS' }
    ]);

    expect(result.matched).toBe(true);
    expect(result.source).toBe('fast');
    expect(result.intervention).toBeDefined();
    expect(result.intervention?.source).toBe('fast');
    expect(result.intervention?.mappingSource).toBe('fast_gate_pattern');
  });

  it('verifies that OnnxSlowGate populates mappingSource on both learned and deterministic paths', async () => {
    resetOnnxSlowGateSession();

    const mockOrt = {
      env: { wasm: { numThreads: 1, simd: true } },
      Tensor: class MockTensor {
        data: Float32Array;
        dims: number[];
        type: string;
        constructor(type: string, data: Float32Array, dims: number[]) {
          this.type = type;
          this.data = data;
          this.dims = dims;
        }
      },
      InferenceSession: {
        create: async () => ({
          inputNames: ['sequence_input', 'context_input'],
          outputNames: ['intervention_logits'],
          run: async () => ({
            intervention_logits: {
              data: new Float32Array([0.0, 0.0, 5.0, 0.0, 0.0]) // class index 2: offer_assistance, p ~ 0.97
            }
          }),
          executionProvider: 'mock-webgpu'
        })
      }
    };

    const dummyContext: UIContext = {
      route: 'Settings',
      primaryActionAvailable: true,
      helpAvailable: false,
      expandable: true,
      availableActions: ['click']
    };

    // 1. Learned head path
    const learnedGate = new OnnxSlowGate({
      ortModule: mockOrt as never,
      modelUrl: null,
      interventionModelUrl: 'mock-head.onnx',
      confidenceThreshold: 0.5,
      useDeterministicMapping: false
    });

    const learnedRes = await learnedGate.infer({
      sequence: new Float32Array(8 * 18).fill(0.1),
      shape: [1, 8, 18],
      context: dummyContext
    });

    expect(learnedRes.mappingSource).toBe('learned_head');
    expect(learnedRes.intervention?.mappingSource).toBe('learned_head');

    // 2. Deterministic baseline ablation path
    resetOnnxSlowGateSession();
    const deterministicGate = new OnnxSlowGate({
      ortModule: mockOrt as never,
      modelUrl: null,
      interventionModelUrl: 'mock-head.onnx',
      confidenceThreshold: 0.5,
      useDeterministicMapping: true
    });

    const deterministicRes = await deterministicGate.infer({
      sequence: new Float32Array(8 * 18).fill(0.1),
      shape: [1, 8, 18],
      context: dummyContext
    });

    expect(deterministicRes.mappingSource).toBe('deterministic_mapping');
    // If an intervention was emitted, it has deterministic_mapping
    if (deterministicRes.intervention) {
      expect(deterministicRes.intervention.mappingSource).toBe('deterministic_mapping');
    }
  });
});
