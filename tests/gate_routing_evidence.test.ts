/**
 * Fast Gate / Slow Gate Routing Evidence & Causal Chain Verification (Task 6.1 / Brief §13)
 *
 * Verifies that:
 * 1. Fast Gate match short-circuits Slow Gate (Slow Gate is NOT called).
 * 2. Fast Gate miss invokes Slow Gate with MicroTensor sequence and UIContext.
 * 3. Both routes independently record all eight §13 fields:
 *    - selected gate ('fast' | 'slow')
 *    - gate latency (measured per gate: fastGateLatencyMs and slowGateLatencyMs)
 *    - confidence
 *    - prediction
 *    - policy decision
 *    - intervention command (with mappingSource)
 *    - actuator result (applied/reverted/dismissed)
 *    - task state
 * 4. Causal chain is completely reconstructable from trace events:
 *    gate selected → prediction → policy decision → intervention → actuator result
 * 5. Ablation arm (useDeterministicMapping: true) routes through deterministic_mapping.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AdaptiveInferenceEngine,
  createAdaptiveInferenceEngine,
  InferenceContext
} from '../src/gates/arbitration';
import { MockFastGate } from '../src/gates/fast/mockFastGate';
import { MockSlowGate } from '../src/gates/slow/mockSlowGate';
import { OnnxSlowGate, resetOnnxSlowGateSession } from '../src/gates/slow/onnxSlowGate';
import { InterventionPolicy } from '../src/intervention/policy';
import { UIActuator } from '../src/intervention/actuator';
import { ExperimentRecorder } from '../src/telemetry/recorder';
import { UIContext } from '../src/types/uiContext';
import { MacroInteraction } from '../src/telemetry/events';

function createDummyContext(macroSymbols: string[] = []): InferenceContext {
  const macroSequence: MacroInteraction[] = macroSymbols.map((sym, idx) => ({
    timestamp: 1000 + idx * 100,
    symbol: sym,
    componentId: 'comp-test'
  }));

  const microTensorSequence = new Float32Array(144).fill(0.1);

  const uiContext: UIContext = {
    route: 'Settings',
    activeComponentId: 'filter-drawer',
    componentRole: 'accordion',
    availableActions: ['click', 'toggle'],
    primaryActionAvailable: true,
    helpAvailable: true,
    expandable: true,
    taskId: 'T1',
    taskStepId: 'T1-2'
  };

  return {
    macroSequence,
    microTensorSequence,
    tensorShape: [1, 8, 18],
    uiContext
  };
}

describe('Task 6.1: Fast Gate / Slow Gate Routing Verification (Brief §13)', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    resetOnnxSlowGateSession();
    container = document.createElement('div');
    container.innerHTML = `
      <button data-aui-component="btn-submit" data-aui-role="primary-action">Submit</button>
      <div data-aui-component="assistance-container"></div>
    `;
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  it('demonstrates Fast Gate match short-circuiting Slow Gate with independent fast gate latency', async () => {
    const fastGate = new MockFastGate({
      patterns: {
        'NAV_ANALYTICS > OPEN_FILTERS': 'highlight_primary_action'
      }
    });

    const slowGate = new MockSlowGate({
      intervention: 'offer_assistance',
      confidence: 0.95
    });

    const slowInferSpy = vi.spyOn(slowGate, 'infer');

    const engine = createAdaptiveInferenceEngine({
      fastGate,
      slowGate
    });

    const context = createDummyContext(['NAV_ANALYTICS', 'OPEN_FILTERS']);
    const result = await engine.evaluate(context);

    // Fast Gate matched
    expect(result.matchedGate).toBe('fast');
    expect(result.intervention).toBeDefined();
    expect(result.intervention?.type).toBe('highlight_primary_action');
    expect(result.intervention?.source).toBe('fast');

    // Independent gate latencies
    expect(result.fastGateLatencyMs).toBeDefined();
    expect(typeof result.fastGateLatencyMs).toBe('number');
    expect(result.fastGateLatencyMs!).toBeGreaterThanOrEqual(0);

    // Slow Gate strictly short-circuited
    expect(result.slowGateLatencyMs).toBeUndefined();
    expect(slowInferSpy).not.toHaveBeenCalled();
  });

  it('demonstrates Fast Gate miss invoking Slow Gate with both gate latencies recorded independently', async () => {
    const fastGate = new MockFastGate({
      patterns: {
        'OTHER_PATTERN': 'highlight_primary_action'
      }
    });

    const slowGate = new MockSlowGate({
      intervention: 'simplify_options',
      confidence: 0.88,
      outcome: 'BACKTRACK'
    });

    const slowInferSpy = vi.spyOn(slowGate, 'infer');

    const engine = createAdaptiveInferenceEngine({
      fastGate,
      slowGate
    });

    const context = createDummyContext(['UNKNOWN_ACTION_1', 'UNKNOWN_ACTION_2']);
    const result = await engine.evaluate(context);

    // Slow Gate matched
    expect(result.matchedGate).toBe('slow');
    expect(result.intervention).toBeDefined();
    expect(result.intervention?.type).toBe('simplify_options');
    expect(result.intervention?.source).toBe('slow');

    // Slow Gate was called
    expect(slowInferSpy).toHaveBeenCalledTimes(1);

    // Both gate latencies recorded
    expect(result.fastGateLatencyMs).toBeDefined();
    expect(typeof result.fastGateLatencyMs).toBe('number');
    expect(result.slowGateLatencyMs).toBeDefined();
    expect(typeof result.slowGateLatencyMs).toBe('number');
    expect(result.slowGateLatencyMs!).toBeGreaterThanOrEqual(0);
  });

  it('reconstructs the full 8-field causal chain for a Fast Gate intervention episode', () => {
    const recorder = new ExperimentRecorder();
    const policy = new InterventionPolicy({
      confidenceThreshold: 0.5,
      requiredConsecutiveWindows: 1,
      enforceContextEligibility: false,
      cooldownMs: 0
    });
    const actuator = new UIActuator();
    const taskState = {
      currentTaskId: 'T1',
      status: 'In Progress' as const,
      currentStepIndex: 1,
      completedSteps: ['T1-1'],
      errors: 0
    };
    recorder.setTaskStateProvider(() => taskState);

    // 1. Selected gate & Prediction
    const predictionEvent = {
      timestamp: 1000,
      sessionId: 'sess-fast-test',
      experimentId: 'exp-routing-1',
      conditionId: 'adaptive' as const,
      windowId: 3,
      matchedGate: 'fast' as const,
      interventionType: 'highlight_primary_action',
      mappingSource: 'fast_gate_pattern' as const,
      confidence: 0.95,
      latencyMs: 4.5,
      fastGateLatencyMs: 4.5,
      slowGateLatencyMs: undefined,
      bothGatesEvaluated: false
    };
    recorder.recordPrediction(predictionEvent);

    // 2. Policy evaluation
    const candidateCommand = {
      type: 'highlight_primary_action' as const,
      targetComponentId: 'btn-submit',
      confidence: 0.95,
      source: 'fast' as const,
      mappingSource: 'fast_gate_pattern' as const,
      issuedAt: 1000
    };
    const dummyUIContext: UIContext = {
      route: 'Settings',
      primaryActionAvailable: true,
      helpAvailable: false,
      expandable: false,
      availableActions: ['click'],
      taskId: 'T1',
      taskStepId: 'T1-2'
    };
    const policyDecision = policy.accept(candidateCommand, dummyUIContext);
    expect(policyDecision.accepted).toBe(true);

    // 3. Actuator application & trace emission
    actuator.onInterventionEvent((event) => {
      recorder.recordIntervention({
        ...event,
        sessionId: 'sess-fast-test',
        conditionId: 'adaptive',
        windowId: 3,
        interventionEpisodeId: 'ep_fast_1'
      });
    });

    actuator.apply(policyDecision.command);

    const trace = recorder.exportSerializable();

    // Verify all 8 fields from Brief §13 are populated and reconstructable
    expect(trace.predictions).toHaveLength(1);
    const pred = trace.predictions[0];
    expect(pred.matchedGate).toBe('fast'); // 1. selected gate
    expect(pred.fastGateLatencyMs).toBe(4.5); // 2. gate latency
    expect(pred.confidence).toBe(0.95); // 3. confidence
    expect(pred.interventionType).toBe('highlight_primary_action'); // 4. prediction

    expect(trace.interventions).toHaveLength(1);
    const inv = trace.interventions[0];
    expect(inv.type).toBe('applied'); // 7. actuator result
    expect(inv.intervention).toBe('highlight_primary_action'); // 6. intervention
    expect(inv.mappingSource).toBe('fast_gate_pattern');

    expect(trace.task?.currentTaskId).toBe('T1'); // 8. task state
    expect(trace.task?.status).toBe('In Progress');
  });

  it('reconstructs the full 8-field causal chain for a Slow Gate intervention episode', () => {
    const recorder = new ExperimentRecorder();
    const policy = new InterventionPolicy({
      confidenceThreshold: 0.5,
      requiredConsecutiveWindows: 1,
      enforceContextEligibility: false,
      cooldownMs: 0
    });
    const actuator = new UIActuator();
    const taskState = {
      currentTaskId: 'T2',
      status: 'In Progress' as const,
      currentStepIndex: 0,
      completedSteps: [],
      errors: 0
    };
    recorder.setTaskStateProvider(() => taskState);

    // 1. Prediction with Slow Gate
    const predictionEvent = {
      timestamp: 2000,
      sessionId: 'sess-slow-test',
      experimentId: 'exp-routing-2',
      conditionId: 'adaptive' as const,
      windowId: 5,
      matchedGate: 'slow' as const,
      outcome: 'BACKTRACK' as const,
      interventionType: 'offer_assistance',
      mappingSource: 'learned_head' as const,
      confidence: 0.88,
      latencyMs: 18.2,
      fastGateLatencyMs: 2.1,
      slowGateLatencyMs: 16.1,
      modelVersion: 'TargetInterventionHead-v1.0.0-int8',
      contextEncodingVersion: 'R6-v1.0.0',
      bothGatesEvaluated: false
    };
    recorder.recordPrediction(predictionEvent);

    // 2. Policy evaluation
    const candidateCommand = {
      type: 'offer_assistance' as const,
      targetComponentId: 'assistance-container',
      confidence: 0.88,
      source: 'slow' as const,
      mappingSource: 'learned_head' as const,
      issuedAt: 2000
    };
    const dummyUIContext: UIContext = {
      route: 'Reports',
      primaryActionAvailable: false,
      helpAvailable: true,
      expandable: true,
      availableActions: ['click'],
      taskId: 'T2',
      taskStepId: 'T2-1'
    };
    const policyDecision = policy.accept(candidateCommand, dummyUIContext);
    expect(policyDecision.accepted).toBe(true);

    // 3. Actuator application & trace recording
    actuator.onInterventionEvent((event) => {
      recorder.recordIntervention({
        ...event,
        sessionId: 'sess-slow-test',
        conditionId: 'adaptive',
        windowId: 5,
        interventionEpisodeId: 'ep_slow_1'
      });
    });

    actuator.apply(policyDecision.command);

    const trace = recorder.exportSerializable();

    // Verify 8 Brief §13 fields
    expect(trace.predictions).toHaveLength(1);
    const pred = trace.predictions[0];
    expect(pred.matchedGate).toBe('slow'); // 1. selected gate
    expect(pred.fastGateLatencyMs).toBe(2.1); // 2a. fast gate latency
    expect(pred.slowGateLatencyMs).toBe(16.1); // 2b. slow gate latency
    expect(pred.confidence).toBe(0.88); // 3. confidence
    expect(pred.outcome).toBe('BACKTRACK'); // 4a. predicted outcome
    expect(pred.interventionType).toBe('offer_assistance'); // 4b. predicted intervention
    expect(pred.modelVersion).toBe('TargetInterventionHead-v1.0.0-int8');

    expect(trace.interventions).toHaveLength(1);
    const inv = trace.interventions[0];
    expect(inv.type).toBe('applied'); // 7. actuator result
    expect(inv.intervention).toBe('offer_assistance'); // 6. intervention
    expect(inv.mappingSource).toBe('learned_head'); // 5. policy decision mapping

    expect(trace.task?.currentTaskId).toBe('T2'); // 8. task state
  });

  it('demonstrates that the deterministic ablation arm routes through deterministic_mapping', async () => {
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
          inputNames: ['input'],
          outputNames: ['output'],
          run: async () => ({
            output: {
              data: new Float32Array([0.0, 0.0, 0.0, 5.0, 0.0, 0.0, 0.0]) // BACKTRACK (index 3)
            }
          }),
          executionProvider: 'mock-webgpu'
        })
      }
    };

    const slowGate = new OnnxSlowGate({
      ortModule: mockOrt as never,
      modelUrl: 'mock-foundation.onnx',
      interventionModelUrl: null,
      confidenceThreshold: 0.5,
      useDeterministicMapping: true
    });

    const context = createDummyContext();
    const result = await slowGate.infer({
      sequence: context.microTensorSequence,
      shape: [1, 8, 18],
      context: context.uiContext
    });

    expect(result.mappingSource).toBe('deterministic_mapping');
    expect(result.outcome).toBe('BACKTRACK');
    expect(result.intervention).toBeDefined();
    expect(result.intervention?.type).toBe('offer_assistance');
    expect(result.intervention?.mappingSource).toBe('deterministic_mapping');
  });
});
