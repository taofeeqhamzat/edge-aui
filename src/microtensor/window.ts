/**
 * Rolling Temporal Window Buffer
 * Implements 500ms sliding windows with 250ms stride for continuous MicroTensor extraction.
 * Guarantees bounded memory footprint (< 20MB) and non-blocking operation.
 *
 * Windowing contract (assessment §9 / §25 P0-2):
 * - Interval semantics are HALF-OPEN: `[windowStart, windowEnd)`. This matches
 *   model-preparation/src/preprocessing.py (`np.searchsorted(..., side="left")`) and
 *   prevents an event that lands exactly on a boundary from being counted twice.
 * - `tick(currentTime)` is time-driven, not event-driven, so verified user inactivity
 *   produces windows instead of silence. An inactivity window is emitted with
 *   `inactive: true` and an all-zero feature vector, and is therefore distinguishable
 *   from a window whose modalities were unavailable (capability mask remains set).
 * - Geometry (viewport + document) is resolved explicitly and never silently
 *   defaults to a constant document size.
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
import { getGeometrySnapshot } from '../telemetry/normalizer';
import { defaultCollector } from '../runtime/instrumentation';

export type WindowListener = (window: MicroTensorWindow) => void;

/** Outcome of advancing one grid slot. */
interface SlotResult {
  window: MicroTensorWindow | null;
  droppedLateEvents: number;
}

export interface RollingWindowBufferOptions {
  windowDurationMs?: number; // default: 500
  strideMs?: number; // default: 250
  minEventsPerWindow?: number; // default: 3
  maxRetentionMs?: number; // default: 5000
  maxEventCapacity?: number; // default: 2000
  modalitySupport?: ModalitySupport;
  autoRecordToTrace?: boolean; // default: true
  /**
   * Emit windows during verified inactivity. Default true. When false the buffer
   * behaves like the legacy event-driven implementation.
   */
  emitInactiveWindows?: boolean;
  /**
   * Configurable settlement delay in milliseconds (ADR-005).
   * Holds each grid slot open for this duration before final settlement so late
   * events within the stride can still populate it.
   */
  settlementDelayMs?: number;
  /**
   * Alias for settlementDelayMs.
   */
  flushDelayMs?: number;
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
  private emitInactiveWindows: boolean;
  private flushDelayMs: number;

  private lastWindowEnd: number | null = null;
  private maxObservedTime = 0;
  private windowIdCounter = 0;
  private gridEstablished = false;
  private lateEventCount = 0;
  private skippedSparseWindowCount = 0;
  private settledSparseWindowCount = 0;

  constructor(options: RollingWindowBufferOptions = {}) {
    this.windowDurationMs = options.windowDurationMs ?? PREPROCESSING_CONFIG.window_size_ms;
    this.strideMs = options.strideMs ?? PREPROCESSING_CONFIG.stride_ms;
    this.minEventsPerWindow = options.minEventsPerWindow ?? PREPROCESSING_CONFIG.min_events_per_window;
    this.maxRetentionMs = options.maxRetentionMs ?? 5000;
    this.maxEventCapacity = options.maxEventCapacity ?? 2000;
    this.modalitySupport = options.modalitySupport ?? DEFAULT_MODALITY_SUPPORT;
    this.autoRecordToTrace = options.autoRecordToTrace ?? true;
    this.emitInactiveWindows = options.emitInactiveWindows ?? true;
    const configuredDelay = options.settlementDelayMs ?? options.flushDelayMs ?? 0;
    this.flushDelayMs = Math.max(0, configuredDelay);
  }

  /**
   * Pushes a single canonical BehaviourEvent into the rolling buffer.
   * Out-of-order events are inserted in timestamp order so window membership is
   * timestamp-deterministic and does not depend on arrival jitter (assessment §9).
   */
  public push(event: BehaviourEvent): void {
    defaultCollector.timeSync('window assignment', 'main', () => {
      if (this.lastWindowEnd !== null && this.maxObservedTime >= this.lastWindowEnd + this.strideMs) {
        if (event.timestamp < this.lastWindowEnd + this.strideMs) {
          (event as unknown as { _delayedArrival?: boolean })._delayedArrival = true;
        }
      }
      this.maxObservedTime = Math.max(this.maxObservedTime, event.timestamp);

      const last = this.events[this.events.length - 1];
      if (!last || event.timestamp >= last.timestamp) {
        this.events.push(event);
      } else {
        let insertAt = this.events.length - 1;
        while (insertAt > 0 && this.events[insertAt - 1].timestamp > event.timestamp) {
          insertAt--;
        }
        this.events.splice(insertAt, 0, event);
      }

      // Enforce capacity bound to preserve memory (< 20MB budget)
      if (this.events.length > this.maxEventCapacity) {
        this.events.shift();
      }

      // Anchor the grid at the first observed event only until the grid has been
      // established by an explicit anchor() or by the first tick(). Without this guard a
      // late-arriving event could silently re-anchor the whole window grid.
      if (this.lastWindowEnd === null && !this.gridEstablished) {
        this.gridEstablished = true;
        this.anchor(event.timestamp);
      }
    });
  }

  /**
   * Anchors the window grid to a monotonic origin.
   *
   * Windows are emitted on the fixed grid
   * `[k*stride, k*stride + windowDuration)` for integer k, so a given absolute time
   * always belongs to the same window regardless of when events happened to arrive or
   * when the buffer was created. An event-anchored grid would make window boundaries
   * depend on the first interaction, which is not comparable across sessions.
   */
  public anchor(originTimestamp: number): void {
    this.gridEstablished = true;
    this.lastWindowEnd = originTimestamp;
    this.maxObservedTime = Math.max(this.maxObservedTime, originTimestamp);
    this.evictOlderThan(originTimestamp - this.maxRetentionMs);
  }

  /**
   * Advances the temporal clock and emits every MicroTensor window whose stride
   * boundary has elapsed. Returns the windows emitted by this call (possibly none).
   *
   * This is intentionally time-driven: calling it from a timer as well as on event
   * arrival is what makes verified inactivity observable.
   */
  public tick(currentTime?: number): MicroTensorWindow[] {
    const now = currentTime ?? (this.events.length > 0
      ? this.events[this.events.length - 1].timestamp
      : null);

    if (now === null) {
      return [];
    }

    this.maxObservedTime = Math.max(this.maxObservedTime, now);

    // Anchor lazily to the first observed time so every window sits on the same grid.
    if (this.lastWindowEnd === null) {
      this.anchor(now);
      return [];
    }

    const emitted: MicroTensorWindow[] = [];

    // A slot is only processed once the observed clock is past its end plus the flush
    // delay, so trailing events can still populate it.
    while (now - this.lastWindowEnd >= this.strideMs + this.flushDelayMs) {
      const result = this.advanceOneWindow();

      // null means the buffer was reset; stop rather than spin.
      if (result === null) {
        break;
      }

      if (result.window) {
        emitted.push(result.window);
      } else if (result.droppedLateEvents > 0) {
        // Events arrived after their window had already been closed. Counted rather
        // than silently ignored so the condition is observable in tests and tooling.
        this.lateEventCount += result.droppedLateEvents;
      }
      // A skipped sparse window still advances the grid, so the loop always continues.
    }

    return emitted;
  }

  /**
   * Processes the next grid slot `[lastWindowEnd, lastWindowEnd + stride)`.
   *
   * Returns a `null` slot result only when the buffer has been reset. A non-null
   * result always advances the grid: either a window is emitted, or the slot is
   * skipped and any events that arrived after the slot closed are reported as late.
   */
  private advanceOneWindow(): SlotResult | null {
    if (this.lastWindowEnd === null) {
      return null;
    }

    const windowStart = this.lastWindowEnd;
    const windowEnd = windowStart + this.strideMs;

    // HALF-OPEN slot [windowStart, windowEnd): an event exactly on windowEnd belongs
    // to the next slot only, so it is counted once.
    const slotEvents = this.events.filter(
      (ev) => ev.timestamp >= windowStart && ev.timestamp < windowEnd
    );

    // Evict and detect events that arrived after this slot was already processed,
    // while retaining everything still within the lookback/retention span.
    const droppedLateEvents = this.evictOlderThan(windowStart - this.maxRetentionMs);

    const isInactive = slotEvents.length === 0;
    const meetsMinimum = slotEvents.length >= this.minEventsPerWindow;

    const delayedCount = slotEvents.filter(
      (ev) => Boolean((ev as unknown as { _delayedArrival?: boolean })._delayedArrival)
    ).length;
    const nominalCount = slotEvents.length - delayedCount;

    if (!meetsMinimum && !(isInactive && this.emitInactiveWindows)) {
      this.skippedSparseWindowCount++;
      this.lastWindowEnd = windowEnd;
      return { window: null, droppedLateEvents };
    }

    if (meetsMinimum && nominalCount < this.minEventsPerWindow && delayedCount > 0) {
      this.settledSparseWindowCount++;
    }

    const window = this.buildWindow(
      windowStart,
      windowEnd,
      slotEvents,
      isInactive,
      // The tensor span is the full window duration ending at the slot end.
      this.windowDurationMs
    );

    this.lastWindowEnd = windowEnd;

    if (this.autoRecordToTrace) {
      experimentRecorder.recordMicroTensor(window);
    }

    this.emit(window);
    return { window, droppedLateEvents };
  }

  /**
   * Computes the 18-D tensor for a window and assigns its correlation identifiers.
   * Geometry is taken from the newest event that carries it, so the extractor never
   * falls back to a constant document height.
   */
  private buildWindow(
    windowStart: number,
    windowEnd: number,
    windowEvents: BehaviourEvent[],
    isInactive: boolean,
    tensorSpanMs: number
  ): MicroTensorWindow {
    const geometry = this.resolveGeometry(windowEvents);

    const tensorValues = defaultCollector.timeSync(
      'MicroTensor extraction',
      'main',
      () =>
        computeWindowMicroTensor(windowEvents, {
          windowDurationMs: tensorSpanMs,
          modalitySupport: this.modalitySupport,
          viewport: geometry.viewport,
          document: geometry.document
        }),
      { windowId: this.windowIdCounter }
    );

    return {
      windowId: this.windowIdCounter++,
      windowStart,
      windowEnd,
      values: tensorValues,
      eventCount: windowEvents.length,
      inactive: isInactive
    };
  }

  /**
   * Resolves viewport/document geometry from the most recent event that observed it,
   * falling back to the live geometry snapshot, and only then to defaults.
   */
  private resolveGeometry(windowEvents: BehaviourEvent[]): {
    viewport?: { width: number; height: number };
    document?: { width: number; height: number; scrollableWidth: number; scrollableHeight: number };
  } {
    for (let i = windowEvents.length - 1; i >= 0; i--) {
      const ev = windowEvents[i];
      if (ev.viewport && ev.document) {
        return { viewport: ev.viewport, document: ev.document };
      }
    }

    // Look back in the retained buffer for the most recent observed geometry.
    for (let i = this.events.length - 1; i >= 0; i--) {
      const ev = this.events[i];
      if (ev.viewport && ev.document) {
        return { viewport: ev.viewport, document: ev.document };
      }
    }

    const snapshot = getGeometrySnapshot();
    return { viewport: snapshot.viewport, document: snapshot.document };
  }

  /**
   * Batch extracts sliding windows from a static canonical event list (useful for tests and replay).
   * Events are sorted and window intervals are half-open, matching the live path.
   */
  public processEventStream(
    events: BehaviourEvent[],
    options: ComputeMicroTensorOptions = {}
  ): MicroTensorWindow[] {
    if (events.length === 0) {
      return [];
    }

    const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);
    if (sortedEvents.length < this.minEventsPerWindow) {
      return [];
    }

    const startTime = sortedEvents[0].timestamp;
    const endTime = sortedEvents[sortedEvents.length - 1].timestamp;

    const windows: MicroTensorWindow[] = [];
    let tCurr = startTime;

    while (tCurr + this.windowDurationMs <= endTime) {
      const winStart = tCurr;
      const winEnd = tCurr + this.windowDurationMs;

      const slice = sortedEvents.filter(
        (ev) => ev.timestamp >= winStart && ev.timestamp < winEnd
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
          windowId: this.windowIdCounter++,
          windowStart: winStart,
          windowEnd: winEnd,
          values,
          eventCount: slice.length,
          inactive: false
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

  /**
   * Removes events older than `cutoffTimestamp` and returns how many were removed.
   * A non-zero count during a tick means activity arrived after its window closed.
   */
  private evictOlderThan(cutoffTimestamp: number): number {
    let removeCount = 0;
    while (removeCount < this.events.length && this.events[removeCount].timestamp < cutoffTimestamp) {
      removeCount++;
    }
    if (removeCount > 0) {
      this.events.splice(0, removeCount);
    }
    return removeCount;
  }

  public clear(): void {
    this.events = [];
    this.lastWindowEnd = null;
    this.gridEstablished = false;
    this.windowIdCounter = 0;
    this.lateEventCount = 0;
    this.skippedSparseWindowCount = 0;
    this.settledSparseWindowCount = 0;
  }

  public get size(): number {
    return this.events.length;
  }

  /** The number of windows emitted since the last clear(). */
  public get emittedWindowCount(): number {
    return this.windowIdCounter;
  }

  /**
   * Number of events that arrived after their grid slot had already been processed.
   * Non-zero means real activity was not represented in any emitted window.
   */
  public get lateEvents(): number {
    return this.lateEventCount;
  }

  /** Number of sparse windows skipped for falling below `minEventsPerWindow`. */
  public get skippedSparseWindows(): number {
    return this.skippedSparseWindowCount;
  }

  /**
   * Number of sparse windows that were below threshold at nominal slot end
   * but successfully crossed minEventsPerWindow and settled during the settlement delay.
   */
  public get settledSparseWindows(): number {
    return this.settledSparseWindowCount;
  }

  /** The configured settlement delay in milliseconds (ADR-005). */
  public get settlementDelay(): number {
    return this.flushDelayMs;
  }
}
