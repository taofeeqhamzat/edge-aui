/**
 * Rolling Temporal Window Buffer
 * Implements 500ms sliding windows with 250ms stride for continuous MicroTensor extraction.
 * Guarantees bounded memory footprint (< 20MB) and non-blocking operation.
 */

import { BehaviourEvent } from '../telemetry/events';
import { experimentRecorder } from '../telemetry/recorder';
import {
  MicroTensorWindow,
  ModalitySupport,
  DEFAULT_MODALITY_SUPPORT
} from './schema';
import { computeWindowMicroTensor, ComputeMicroTensorOptions } from './features';
import { PREPROCESSING_CONFIG } from '../config/pipelineConfig';

export type WindowListener = (window: MicroTensorWindow) => void;

export interface RollingWindowBufferOptions {
  windowDurationMs?: number; // default: 500
  strideMs?: number; // default: 250
  minEventsPerWindow?: number; // default: 3
  maxRetentionMs?: number; // default: 5000
  maxEventCapacity?: number; // default: 2000
  modalitySupport?: ModalitySupport;
  autoRecordToTrace?: boolean; // default: true
}

export class RollingWindowBuffer {
  private events: BehaviourEvent[] = [];
  private listeners: Set<WindowListener> = new Set();

  private windowDurationMs: number;
  private strideMs: number;
  private minEventsPerWindow: number;
  private maxRetentionMs: number;
  private maxEventCapacity: number;
  private modalitySupport: ModalitySupport;
  private autoRecordToTrace: boolean;

  private lastWindowEnd: number | null = null;

  constructor(options: RollingWindowBufferOptions = {}) {
    this.windowDurationMs = options.windowDurationMs ?? PREPROCESSING_CONFIG.window_size_ms;
    this.strideMs = options.strideMs ?? PREPROCESSING_CONFIG.stride_ms;
    this.minEventsPerWindow = options.minEventsPerWindow ?? PREPROCESSING_CONFIG.min_events_per_window;
    this.maxRetentionMs = options.maxRetentionMs ?? 5000;
    this.maxEventCapacity = options.maxEventCapacity ?? 2000;
    this.modalitySupport = options.modalitySupport ?? DEFAULT_MODALITY_SUPPORT;
    this.autoRecordToTrace = options.autoRecordToTrace ?? true;
  }

  /**
   * Pushes a single canonical BehaviourEvent into the rolling buffer.
   */
  public push(event: BehaviourEvent): void {
    this.events.push(event);

    // Enforce capacity bound to preserve memory (< 20MB budget)
    if (this.events.length > this.maxEventCapacity) {
      this.events.shift();
    }

    // Initialize first window boundary on first event
    if (this.lastWindowEnd === null) {
      this.lastWindowEnd = event.timestamp;
    }
  }

  /**
   * Advances temporal clock and emits microtensor windows if stride has elapsed.
   */
  public tick(currentTime?: number): MicroTensorWindow | null {
    if (this.events.length === 0) {
      return null;
    }

    const now = currentTime ?? this.events[this.events.length - 1].timestamp;

    if (this.lastWindowEnd === null) {
      this.lastWindowEnd = this.events[0].timestamp;
    }

    if (now - this.lastWindowEnd < this.strideMs) {
      return null;
    }

    const windowEnd = this.lastWindowEnd + this.strideMs;
    const windowStart = windowEnd - this.windowDurationMs;

    // Filter events in [windowStart, windowEnd]
    const windowEvents = this.events.filter(
      (ev) => ev.timestamp >= windowStart && ev.timestamp <= windowEnd
    );

    this.lastWindowEnd = windowEnd;

    // Evict events older than retention cutoff
    const cutoff = windowEnd - this.maxRetentionMs;
    this.evictOlderThan(cutoff);

    // Check minimum events requirement
    if (windowEvents.length < this.minEventsPerWindow) {
      return null;
    }

    const tensorValues = computeWindowMicroTensor(windowEvents, {
      windowDurationMs: this.windowDurationMs,
      modalitySupport: this.modalitySupport
    });

    const window: MicroTensorWindow = {
      windowStart,
      windowEnd,
      values: tensorValues
    };

    if (this.autoRecordToTrace) {
      experimentRecorder.recordMicroTensor(window);
    }

    this.emit(window);
    return window;
  }

  /**
   * Batch extracts sliding windows from a static canonical event list (useful for tests and replay).
   */
  public processEventStream(
    events: BehaviourEvent[],
    options: ComputeMicroTensorOptions = {}
  ): MicroTensorWindow[] {
    if (events.length < this.minEventsPerWindow) {
      return [];
    }

    const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);
    const startTime = sortedEvents[0].timestamp;
    const endTime = sortedEvents[sortedEvents.length - 1].timestamp;

    const windows: MicroTensorWindow[] = [];
    let tCurr = startTime;

    while (tCurr + this.windowDurationMs <= endTime) {
      const winStart = tCurr;
      const winEnd = tCurr + this.windowDurationMs;

      const slice = sortedEvents.filter(
        (ev) => ev.timestamp >= winStart && ev.timestamp <= winEnd
      );

      if (slice.length >= this.minEventsPerWindow) {
        const values = computeWindowMicroTensor(slice, {
          windowDurationMs: this.windowDurationMs,
          modalitySupport: options.modalitySupport ?? this.modalitySupport,
          viewport: options.viewport,
          document: options.document,
          scales: options.scales
        });

        windows.push({
          windowStart: winStart,
          windowEnd: winEnd,
          values
        });
      }

      tCurr += this.strideMs;
    }

    return windows;
  }

  /**
   * Subscribes a listener to emitted MicroTensor windows.
   */
  public subscribe(listener: WindowListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(window: MicroTensorWindow): void {
    for (const listener of this.listeners) {
      try {
        listener(window);
      } catch (err) {
        console.error('[RollingWindowBuffer] Listener error:', err);
      }
    }
  }

  private evictOlderThan(cutoffTimestamp: number): void {
    let removeCount = 0;
    while (removeCount < this.events.length && this.events[removeCount].timestamp < cutoffTimestamp) {
      removeCount++;
    }
    if (removeCount > 0) {
      this.events.splice(0, removeCount);
    }
  }

  public clear(): void {
    this.events = [];
    this.lastWindowEnd = null;
  }

  public get size(): number {
    return this.events.length;
  }
}
