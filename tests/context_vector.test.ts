import { describe, it, expect } from 'vitest';
import {
  encodeUIContext,
  validateContextVector,
  CONTEXT_VECTOR_DIM
} from '../src/types/contextVector';
import { UIContext } from '../src/types/uiContext';
import { TESTBED_CONTEXT_ENCODING_CONFIG, TASK_STEP_COUNTS } from '../src/testbed/config/contextEncoding';
import { EXPERIMENTAL_TASKS } from '../src/testbed/tasks/taskModel';

/** These cases assert the testbed's own route/task vocabulary, so they encode with it. */
const encode = (context: UIContext) => encodeUIContext(context, TESTBED_CONTEXT_ENCODING_CONFIG);

const baseContext: UIContext = {
  route: 'Analytics',
  availableActions: ['click'],
  primaryActionAvailable: true,
  helpAvailable: false,
  expandable: false
};

describe('UIContext to R^6 encoding (assessment §15 / §25 P2-2)', () => {
  it('produces a vector of the model-preparation context_dim', () => {
    const vector = encode(baseContext);
    expect(vector.length).toBe(CONTEXT_VECTOR_DIM);
    expect(CONTEXT_VECTOR_DIM).toBe(6);
  });

  it('is bounded in [0, 1] for every component', () => {
    const vector = encode({
      ...baseContext,
      taskId: 'TD1',
      taskStepId: 'TD1-5',
      availableActions: ['click', 'change', 'hover', 'select', 'input', 'focus', 'toggle'],
      expandable: true,
      helpAvailable: true
    });

    const validation = validateContextVector(vector);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it('encodes the route as a normalized vocabulary index', () => {
    const overview = encode({ ...baseContext, route: 'Overview' });
    const settings = encode({ ...baseContext, route: 'Settings' });

    expect(overview[0]).toBe(0);
    expect(settings[0]).toBeGreaterThan(overview[0]);
    // Unknown routes fall back to 0 rather than throwing or exceeding bounds.
    expect(encode({ ...baseContext, route: 'Unknown' })[0]).toBe(0);
  });

  it('encodes capability flags as binary components', () => {
    const vector = encode({
      ...baseContext,
      primaryActionAvailable: true,
      helpAvailable: false,
      expandable: true
    });

    expect(vector[1]).toBe(1);
    expect(vector[2]).toBe(0);
    expect(vector[3]).toBe(1);
  });

  it('encodes task progress from the current step', () => {
    const atStart = encode({ ...baseContext, taskId: 'TD1', taskStepId: 'TD1-1' });
    const atEnd = encode({ ...baseContext, taskId: 'TD1', taskStepId: 'TD1-5' });

    expect(atStart[4]).toBe(0);
    expect(atEnd[4]).toBeCloseTo(4 / 5, 6);
    expect(atEnd[4]).toBeGreaterThan(atStart[4]);
  });

  it('reports zero task progress when no task is active', () => {
    expect(encode(baseContext)[4]).toBe(0);
  });

  it('scales action availability by the vocabulary size', () => {
    const one = encode({ ...baseContext, availableActions: ['click'] });
    const many = encode({
      ...baseContext,
      availableActions: ['click', 'change', 'hover', 'select', 'input', 'focus', 'toggle']
    });

    expect(one[5]).toBeCloseTo(1 / 7, 6);
    expect(many[5]).toBe(1);
  });

  it('is deterministic for identical context', () => {
    const a = encode(baseContext);
    const b = encode({ ...baseContext });
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('rejects malformed vectors', () => {
    const wrongLength = validateContextVector(new Float32Array(4));
    expect(wrongLength.valid).toBe(false);
    expect(wrongLength.errors.some((e) => e.includes('6 elements'))).toBe(true);

    const outOfBounds = new Float32Array(CONTEXT_VECTOR_DIM);
    outOfBounds[2] = 1.5;
    expect(validateContextVector(outOfBounds).valid).toBe(false);

    const notFinite = new Float32Array(CONTEXT_VECTOR_DIM);
    notFinite[0] = Number.NaN;
    expect(validateContextVector(notFinite).valid).toBe(false);
  });
});

describe('testbed context encoding vocabulary', () => {
  it('declares a step count matching the task model for every task', () => {
    for (const [taskId, task] of Object.entries(EXPERIMENTAL_TASKS)) {
      expect(TASK_STEP_COUNTS[taskId], `step count for ${taskId}`).toBe(
        task.steps?.length ?? 0
      );
    }
  });
});
