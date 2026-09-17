import { describe, it, expect } from 'vitest';
import { SequenceBuilder } from '../src/microtensor/sequence';
import { MicroTensorWindow } from '../src/microtensor/schema';

function makeMockWindow(id: number, val: number): MicroTensorWindow {
  const values = new Float32Array(18).fill(val);
  return {
    windowStart: id * 250,
    windowEnd: id * 250 + 500,
    values
  };
}

describe('SequenceBuilder (Task 5.2 & T=8 Sequence Construction)', () => {
  it('initializes with default sequenceLength T=8 and shape [1, 8, 18]', () => {
    const builder = new SequenceBuilder();
    expect(builder.isFull()).toBe(false);
    expect(builder.length).toBe(0);
    expect(builder.getShape()).toEqual([1, 8, 18]);

    const emptyTensor = builder.getTensor();
    expect(emptyTensor.length).toBe(8 * 18); // 144 floats
    expect(emptyTensor.every((v) => v === 0)).toBe(true);
  });

  it('maintains rolling FIFO queue of T=8 consecutive windows', () => {
    const builder = new SequenceBuilder({ sequenceLength: 8 });

    // Push 8 windows with distinct values
    for (let i = 1; i <= 8; i++) {
      builder.push(makeMockWindow(i, i * 0.1));
    }

    expect(builder.isFull()).toBe(true);
    expect(builder.length).toBe(8);

    const tensor = builder.getTensor();
    expect(tensor.length).toBe(144);

    // First window in sequence is window 1 (val 0.1)
    expect(tensor[0]).toBeCloseTo(0.1, 4);
    // Last window in sequence is window 8 (val 0.8)
    expect(tensor[7 * 18]).toBeCloseTo(0.8, 4);

    // Push 9th window -> should evict window 1
    builder.push(makeMockWindow(9, 0.9));
    expect(builder.length).toBe(8);

    const updatedTensor = builder.getTensor();
    // New first window is window 2 (val 0.2)
    expect(updatedTensor[0]).toBeCloseTo(0.2, 4);
    // New last window is window 9 (val 0.9)
    expect(updatedTensor[7 * 18]).toBeCloseTo(0.9, 4);
  });

  it('correctly zero-pads leading windows when buffer is not yet full', () => {
    const builder = new SequenceBuilder({ sequenceLength: 8 });

    // Push 3 windows (values 0.5, 0.6, 0.7)
    builder.push(makeMockWindow(1, 0.5));
    builder.push(makeMockWindow(2, 0.6));
    builder.push(makeMockWindow(3, 0.7));

    expect(builder.isFull()).toBe(false);
    expect(builder.length).toBe(3);

    const tensor = builder.getTensor(true);
    expect(tensor.length).toBe(144);

    // First 5 windows (5 * 18 = 90 floats) must be padded zeros
    for (let i = 0; i < 5 * 18; i++) {
      expect(tensor[i]).toBe(0);
    }

    // Window index 5 (offset 90) is window 1 (val 0.5)
    expect(tensor[5 * 18]).toBeCloseTo(0.5, 4);
    // Window index 6 (offset 108) is window 2 (val 0.6)
    expect(tensor[6 * 18]).toBeCloseTo(0.6, 4);
    // Window index 7 (offset 126) is window 3 (val 0.7)
    expect(tensor[7 * 18]).toBeCloseTo(0.7, 4);
  });

  it('supports configurable sequence length T', () => {
    const builder = new SequenceBuilder({ sequenceLength: 4 });
    expect(builder.getShape()).toEqual([1, 4, 18]);

    for (let i = 1; i <= 4; i++) {
      builder.push(makeMockWindow(i, 0.2));
    }

    expect(builder.isFull()).toBe(true);
    expect(builder.getTensor().length).toBe(4 * 18); // 72 floats
  });

  it('emits sequences to subscribers when buffer is full', () => {
    const builder = new SequenceBuilder({ sequenceLength: 3 });
    const emittedWindows: number[] = [];

    const unsubscribe = builder.subscribe((seq, tensor) => {
      emittedWindows.push(seq.windows.length);
      expect(tensor.length).toBe(3 * 18);
    });

    builder.push(makeMockWindow(1, 0.1));
    builder.push(makeMockWindow(2, 0.2));
    expect(emittedWindows.length).toBe(0); // Not full yet

    builder.push(makeMockWindow(3, 0.3)); // Reaches capacity 3
    expect(emittedWindows.length).toBe(1);
    expect(emittedWindows[0]).toBe(3);

    builder.push(makeMockWindow(4, 0.4)); // Next full state
    expect(emittedWindows.length).toBe(2);

    unsubscribe();
    builder.push(makeMockWindow(5, 0.5));
    expect(emittedWindows.length).toBe(2);
  });

  it('clears sequence buffer on reset', () => {
    const builder = new SequenceBuilder();
    builder.push(makeMockWindow(1, 0.1));
    builder.push(makeMockWindow(2, 0.2));
    expect(builder.length).toBe(2);

    builder.clear();
    expect(builder.length).toBe(0);
    expect(builder.isFull()).toBe(false);
  });
});
