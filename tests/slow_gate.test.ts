import { describe, it, expect } from 'vitest';
import { MockSlowGate } from '../src/gates/slow/mockSlowGate';
import { SlowGateInput } from '../src/gates/slow/types';
import { UIContext } from '../src/types/telemetry';

function createDummyInput(options?: {
  shape?: [number, number, number];
  length?: number;
  activeComponentId?: string;
  expandable?: boolean;
}): SlowGateInput {
  const shape = options?.shape ?? [1, 8, 18];
  const length = options?.length ?? (shape[0] * shape[1] * shape[2]);
  const sequence = new Float32Array(length);
  // populate with dummy kinematic values
  for (let i = 0; i < length; i++) {
    sequence[i] = (i % 18) / 18.0;
  }

  const context: UIContext = {
    route: 'Analytics',
    activeComponentId: options?.activeComponentId ?? 'filter-accordion-region',
    componentRole: 'accordion',
    taskId: 'task-1',
    taskStepId: 'step-2',
    availableActions: ['click', 'toggle'],
    primaryActionAvailable: true,
    helpAvailable: false,
    expandable: options?.expandable ?? true
  };

  return {
    sequence,
    shape,
    context
  };
}

describe('SlowGate & MockSlowGate', () => {
  it('receives typed MicroTensor sequence and returns probabilistic outcome and candidate intervention', async () => {
    const gate = new MockSlowGate({
      outcome: 'HOVER_DWELL',
      intervention: 'expand_tooltip',
      confidence: 0.91
    });

    const input = createDummyInput({ activeComponentId: 'kpi-card-revenue' });
    const result = await gate.infer(input);

    expect(result.source).toBe('slow');
    expect(result.outcome).toBe('HOVER_DWELL');
    expect(result.confidence).toBe(0.91);
    expect(result.intervention).toBeDefined();
    expect(result.intervention?.type).toBe('expand_tooltip');
    expect(result.intervention?.source).toBe('slow');
    expect(result.intervention?.targetComponentId).toBe('kpi-card-revenue');
    expect(result.intervention?.confidence).toBe(0.91);
    expect(typeof result.intervention?.issuedAt).toBe('number');
  });

  it('validates tensor shape and buffer length strictly', async () => {
    const gate = new MockSlowGate({ validateShape: true });

    // Shape is [1, 8, 18] (144 items), but buffer length is only 50
    const malformedInput = createDummyInput({ length: 50 });

    await expect(gate.infer(malformedInput)).rejects.toThrow(
      /Invalid input tensor length: expected 144/
    );
  });

  it('passes probabilities vector if configured', async () => {
    const probs = new Float32Array([0.1, 0.7, 0.15, 0.05]);
    const gate = new MockSlowGate({
      outcome: 'BACKTRACK',
      probabilities: probs,
      confidence: 0.7
    });

    const input = createDummyInput();
    const result = await gate.infer(input);

    expect(result.probabilities).toBe(probs);
    expect(result.outcome).toBe('BACKTRACK');
    expect(result.confidence).toBe(0.7);
  });

  it('supports custom conditional predicate on UIContext or sequence values', async () => {
    const gate = new MockSlowGate({
      outcome: 'HOVER_DWELL',
      intervention: 'simplify_options',
      confidence: 0.82,
      predicate: (input) => input.context.expandable === true
    });

    // 1. When expandable is true -> condition met
    const inputExpandable = createDummyInput({ expandable: true });
    const resultMatch = await gate.infer(inputExpandable);
    expect(resultMatch.intervention?.type).toBe('simplify_options');

    // 2. When expandable is false -> condition not met
    const inputNotExpandable = createDummyInput({ expandable: false });
    const resultMiss = await gate.infer(inputNotExpandable);
    expect(resultMiss.outcome).toBe('NO_OUTCOME');
    expect(resultMiss.confidence).toBe(0);
    expect(resultMiss.intervention).toBeUndefined();
  });

  it('simulates async inference latency when delayMs is configured', async () => {
    const gate = new MockSlowGate({ delayMs: 25 });
    const input = createDummyInput();

    const start = performance.now();
    await gate.infer(input);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(20);
  });

  it('supports dynamic reconfiguration and tracks last input', async () => {
    const gate = new MockSlowGate();
    expect(gate.getLastInput()).toBeNull();

    const input = createDummyInput({ activeComponentId: 'btn-apply' });
    await gate.infer(input);
    expect(gate.getLastInput()).toBe(input);

    gate.setMockOutcome('FORM_SUBMIT');
    gate.setMockIntervention('highlight_primary_action');
    gate.setConfidence(0.99);

    const result2 = await gate.infer(input);
    expect(result2.outcome).toBe('FORM_SUBMIT');
    expect(result2.intervention?.type).toBe('highlight_primary_action');
    expect(result2.confidence).toBe(0.99);
  });
});
