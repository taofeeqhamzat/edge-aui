import { describe, it, expect } from 'vitest';
import {
  encodeUIContext,
  validateContextVector,
  CONTEXT_VECTOR_DIM
} from '../src/types/contextVector';
import { UIContext } from '../src/types/uiContext';

const baseContext: UIContext = {
  route: 'Analytics',
  availableActions: ['click'],
  primaryActionAvailable: true,
  helpAvailable: false,
  expandable: false
};

describe('UIContext to R^6 encoding (assessment §15 / §25 P2-2)', () => {
  it('produces a vector of the model-preparation context_dim', () => {
    const vector = encodeUIContext(baseContext);
    expect(vector.length).toBe(CONTEXT_VECTOR_DIM);
    expect(CONTEXT_VECTOR_DIM).toBe(6);
  });

  it('is bounded in [0, 1] for every component', () => {
    const vector = encodeUIContext({
      ...baseContext,
      taskId: 'T1',
      taskStepId: 'T1-4',
      availableActions: ['click', 'change', 'hover', 'select', 'input', 'focus', 'toggle'],
      expandable: true,
      helpAvailable: true
    });

    const validation = validateContextVector(vector);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it('encodes the route as a normalized vocabulary index', () => {
    const overview = encodeUIContext({ ...baseContext, route: 'Overview' });
    const settings = encodeUIContext({ ...baseContext, route: 'Settings' });

    expect(overview[0]).toBe(0);
    expect(settings[0]).toBeGreaterThan(overview[0]);
    // Unknown routes fall back to 0 rather than throwing or exceeding bounds.
    expect(encodeUIContext({ ...baseContext, route: 'Unknown' })[0]).toBe(0);
  });

  it('encodes capability flags as binary components', () => {
    const vector = encodeUIContext({
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
    const atStart = encodeUIContext({ ...baseContext, taskId: 'T1', taskStepId: 'T1-1' });
    const atEnd = encodeUIContext({ ...baseContext, taskId: 'T1', taskStepId: 'T1-4' });

    expect(atStart[4]).toBe(0);
    expect(atEnd[4]).toBeCloseTo(3 / 4, 6);
    expect(atEnd[4]).toBeGreaterThan(atStart[4]);
  });

  it('reports zero task progress when no task is active', () => {
    expect(encodeUIContext(baseContext)[4]).toBe(0);
  });

  it('scales action availability by the vocabulary size', () => {
    const one = encodeUIContext({ ...baseContext, availableActions: ['click'] });
    const many = encodeUIContext({
      ...baseContext,
      availableActions: ['click', 'change', 'hover', 'select', 'input', 'focus', 'toggle']
    });

    expect(one[5]).toBeCloseTo(1 / 7, 6);
    expect(many[5]).toBe(1);
  });

  it('is deterministic for identical context', () => {
    const a = encodeUIContext(baseContext);
    const b = encodeUIContext({ ...baseContext });
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
