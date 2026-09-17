/**
 * Sequence Builder (T=8)
 * Aggregates consecutive 500ms MicroTensor windows into recurrent tensor sequences.
 * Emits (1, T, 18) tensors formatted as Float32Array(T * 18) for the Slow Gate GRU.
 */

import {
  MicroTensorWindow,
  MicroTensorSequence,
  SequenceConfig,
  DEFAULT_SEQUENCE_CONFIG,
  MICROTENSOR_DIM
} from './schema';

export type SequenceListener = (
  sequence: MicroTensorSequence,
  tensor: Float32Array
) => void;

export class SequenceBuilder {
  private windows: MicroTensorWindow[] = [];
  private readonly config: SequenceConfig;
  private listeners: Set<SequenceListener> = new Set();
  private sessionId?: string;

  constructor(config: Partial<SequenceConfig> = {}, sessionId?: string) {
    this.config = {
      ...DEFAULT_SEQUENCE_CONFIG,
      ...config
    };
    this.sessionId = sessionId;
  }

  /**
   * Pushes a new MicroTensorWindow into the rolling FIFO sequence buffer.
   * Evicts the oldest window when capacity T exceeds sequenceLength.
   */
  public push(window: MicroTensorWindow): void {
    this.windows.push(window);

    // Keep FIFO window buffer strictly bounded to sequenceLength T
    if (this.windows.length > this.config.sequenceLength) {
      this.windows.shift();
    }

    if (this.isFull()) {
      const seq = this.getSequence();
      const tensor = this.getTensor();
      this.emit(seq, tensor);
    }
  }

  /**
   * Returns whether the buffer contains a complete sequence of T windows.
   */
  public isFull(): boolean {
    return this.windows.length >= this.config.sequenceLength;
  }

  /**
   * Returns current count of buffered windows.
   */
  public get length(): number {
    return this.windows.length;
  }

  /**
   * Returns a copy of the current buffered windows.
   */
  public getWindows(): MicroTensorWindow[] {
    return [...this.windows];
  }

  /**
   * Returns typed MicroTensorSequence representation.
   */
  public getSequence(sessionId?: string): MicroTensorSequence {
    return {
      windows: [...this.windows],
      sequenceLength: this.config.sequenceLength,
      strideMs: this.config.strideMs,
      windowMs: this.config.windowMs,
      sessionId: sessionId ?? this.sessionId
    };
  }

  /**
   * Returns tensor data formatted as a contiguous Float32Array of size T * 18.
   * If padWithZeros is true and buffer has fewer than T windows, pads leading windows with zeros.
   */
  public getTensor(padWithZeros = true): Float32Array {
    const totalFloats = this.config.sequenceLength * MICROTENSOR_DIM;
    const tensor = new Float32Array(totalFloats);

    const available = this.windows.length;
    if (available === 0) {
      return tensor;
    }

    const padCount = Math.max(0, this.config.sequenceLength - available);
    const startWindowIdx = padWithZeros ? padCount : 0;

    for (let i = 0; i < available; i++) {
      const destWindowIdx = startWindowIdx + i;
      if (destWindowIdx >= this.config.sequenceLength) break;

      const offset = destWindowIdx * MICROTENSOR_DIM;
      tensor.set(this.windows[i].values, offset);
    }

    return tensor;
  }

  /**
   * Returns tensor shape tuple: [1, T, 18] for ONNX tensor instantiation.
   */
  public getShape(): [number, number, number] {
    return [1, this.config.sequenceLength, MICROTENSOR_DIM];
  }

  /**
   * Subscribes a listener to complete sequence emissions.
   */
  public subscribe(listener: SequenceListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Sets or updates the active session ID.
   */
  public setSessionId(id: string): void {
    this.sessionId = id;
  }

  /**
   * Clears the rolling sequence buffer.
   */
  public clear(): void {
    this.windows = [];
  }

  private emit(sequence: MicroTensorSequence, tensor: Float32Array): void {
    for (const listener of this.listeners) {
      try {
        listener(sequence, tensor);
      } catch (err) {
        console.error('[SequenceBuilder] Listener error:', err);
      }
    }
  }
}
