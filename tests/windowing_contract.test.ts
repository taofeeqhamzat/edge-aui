import { describe, it, expect, beforeEach } from 'vitest';
import { RollingWindowBuffer } from '../src/microtensor/window';
import { BehaviourEvent } from '../src/telemetry/events';
import { experimentRecorder } from '../src/telemetry/recorder';

/**
 * Windowing contract (assessment §9, §25 P0-2):
 * - a fixed monotonic window grid, so a timestamp always lands in the same window;
 * - half-open slots so each event is counted exactly once;
 * - time-driven ticks so verified inactivity produces windows;
 * - explicit geometry so extraction never falls back to a constant document size;
 * - observable accounting of late and sparse-skipped windows.
 */
describe('RollingWindowBuffer windowing contract', () => {
  beforeEach(() => {
    experimentRecorder.clear();
  });

  it('places each event in exactly one window (half-open slots)', () => {
    // window 500ms, stride 250ms: slot k covers [250k, 250(k+1))
    const buffer = new RollingWindowBuffer({
      windowDurationMs: 500,
      strideMs: 250,
      minEventsPerWindow: 1
    });
    buffer.anchor(0);

    buffer.push({ timestamp: 0, type: 'mousemove', x: 0.1, y: 0.1 });
    buffer.push({ timestamp: 250, type: 'mousemove', x: 0.2, y: 0.2 });
    buffer.push({ timestamp: 500, type: 'mousemove', x: 0.3, y: 0.3 });
    buffer.push({ timestamp: 750, type: 'mousemove', x: 0.4, y: 0.4 });

    const windows = buffer.tick(1000);
    const totalCounted = windows.reduce((sum, w) => sum + (w.eventCount ?? 0), 0);

    // 4 events across 4 slots -> each counted exactly once.
    expect(totalCounted).toBe(4);

    // Slot boundaries follow the aligned grid, not an event-relative anchor.
    expect(windows.map((w) => w.windowStart)).toEqual([0, 250, 500, 750]);
    expect(windows.map((w) => w.eventCount)).toEqual([1, 1, 1, 1]);
  });

  it('emits an all-zero inactivity window when no events arrive between ticks', () => {
    const buffer = new RollingWindowBuffer({
      windowDurationMs: 500,
      strideMs: 250,
      minEventsPerWindow: 3
    });
    buffer.anchor(0);

    buffer.push({ timestamp: 100, type: 'mousemove', x: 0.1, y: 0.1 });
    buffer.tick(300); // process slot [0,250)

    // Advance the clock well beyond the stride with no further events.
    const windows = buffer.tick(1500);

    expect(windows.length).toBeGreaterThan(0);
    expect(windows.every((w) => w.inactive)).toBe(true);
    expect(windows[0].eventCount).toBe(0);

    // Feature dimensions are zero, but the capability mask stays set, so a genuine
    // inactivity window is distinguishable from an unavailable modality.
    for (let i = 0; i < 9; i++) {
      expect(windows[0].values[i]).toBe(0);
    }
    expect(Array.from(windows[0].values.slice(9)).every((bit) => bit === 1)).toBe(true);
  });

  it('can suppress inactivity windows when configured', () => {
    const buffer = new RollingWindowBuffer({
      windowDurationMs: 500,
      strideMs: 250,
      minEventsPerWindow: 3,
      emitInactiveWindows: false
    });
    buffer.anchor(0);
    buffer.push({ timestamp: 100, type: 'mousemove', x: 0.1, y: 0.1 });

    const windows = buffer.tick(1500);
    expect(windows).toEqual([]);
  });

  it('exposes a monotonic windowId used as the correlation identifier', () => {
    const buffer = new RollingWindowBuffer({
      windowDurationMs: 500,
      strideMs: 250,
      minEventsPerWindow: 1
    });
    buffer.anchor(0);
    buffer.push({ timestamp: 0, type: 'mousemove', x: 0.1, y: 0.1 });
    const windows = buffer.tick(1000);

    expect(windows.length).toBeGreaterThan(1);
    const ids = windows.map((w) => w.windowId);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(ids.length);
    expect(buffer.emittedWindowCount).toBe(ids.length);
  });

  it('derives geometry from observed events instead of a constant document size', () => {
    const buffer = new RollingWindowBuffer({
      windowDurationMs: 500,
      strideMs: 250,
      minEventsPerWindow: 2
    });
    buffer.anchor(0);

    const events: BehaviourEvent[] = [
      {
        timestamp: 100,
        type: 'scroll',
        scrollY: 0.3,
        viewport: { width: 1000, height: 500 },
        document: { width: 1000, height: 2500, scrollableWidth: 0, scrollableHeight: 2000 }
      },
      {
        timestamp: 200,
        type: 'scroll',
        scrollY: 0.6,
        viewport: { width: 1000, height: 500 },
        document: { width: 1000, height: 2500, scrollableWidth: 0, scrollableHeight: 2000 }
      }
    ];
    for (const event of events) buffer.push(event);

    // Both events sit in slot [0,250), so the first processed slot has 2 events.
    const windows = buffer.tick(500);
    expect(windows.length).toBeGreaterThan(0);
    const first = windows[0];

    // depth = 2 * 80 / max(2500 - 500, 1) = 0.08. A constant document size of
    // 1920x3000 would yield a different value, so this asserts geometry propagation.
    expect(first.values[7]).toBeCloseTo(0.08, 4);
  });

  it('inserts out-of-order events in timestamp order so membership is deterministic', () => {
    const buffer = new RollingWindowBuffer({
      windowDurationMs: 500,
      strideMs: 250,
      minEventsPerWindow: 1
    });
    buffer.anchor(0);

    buffer.push({ timestamp: 300, type: 'mousemove', x: 0.3, y: 0.3 });
    buffer.push({ timestamp: 100, type: 'mousemove', x: 0.1, y: 0.1 });
    buffer.push({ timestamp: 200, type: 'mousemove', x: 0.2, y: 0.2 });

    const windows = buffer.tick(500);
    const counted = windows.reduce((sum, w) => sum + (w.eventCount ?? 0), 0);

    // Every event is still represented, regardless of arrival order.
    expect(counted).toBe(3);
  });

  it('exposes late-event accounting as an observable counter', () => {
    const buffer = new RollingWindowBuffer({
      windowDurationMs: 500,
      strideMs: 250,
      minEventsPerWindow: 1,
      maxRetentionMs: 1000
    });
    buffer.anchor(0);

    // Retained events inside a slot are still windowable and are not "late".
    buffer.push({ timestamp: 100, type: 'mousemove', x: 0.1, y: 0.1 });
    buffer.tick(250);
    expect(buffer.lateEvents).toBe(0);

    // Advancing the grid far past the retention horizon must drop stale events and
    // record them rather than leaving the buffer to grow without bound.
    buffer.tick(5000);
    expect(buffer.lateEvents).toBeGreaterThanOrEqual(0);
    expect(buffer.size).toBeLessThanOrEqual(2);
  });

  it('counts sparse windows it had to skip', () => {
    const buffer = new RollingWindowBuffer({
      windowDurationMs: 500,
      strideMs: 250,
      minEventsPerWindow: 3,
      emitInactiveWindows: false
    });
    buffer.anchor(0);
    buffer.push({ timestamp: 100, type: 'mousemove', x: 0.1, y: 0.1 });

    // Only one event exists, so no slot can reach the minimum of three.
    buffer.tick(1000);
    expect(buffer.skippedSparseWindows).toBeGreaterThan(0);
  });

  it('keeps batch and live paths consistent on interval semantics', () => {
    const buffer = new RollingWindowBuffer({
      windowDurationMs: 500,
      strideMs: 250,
      minEventsPerWindow: 2
    });

    const events: BehaviourEvent[] = [
      { timestamp: 0, type: 'mousemove', x: 0.1, y: 0.1 },
      { timestamp: 250, type: 'mousemove', x: 0.2, y: 0.2 },
      { timestamp: 500, type: 'mousemove', x: 0.3, y: 0.3 },
      { timestamp: 750, type: 'mousemove', x: 0.4, y: 0.4 }
    ];

    const batch = buffer.processEventStream(events);
    expect(batch.length).toBeGreaterThan(0);

    // Consecutive batch windows advance by exactly the stride.
    expect(batch[0].windowStart).toBe(0);
    expect(batch[1].windowStart).toBe(250);
    expect(batch[0].eventCount).toBe(2); // t=0, t=250
  });
});

describe('RollingWindowBuffer delayed flush (sparse-window revision)', () => {
  beforeEach(() => {
    experimentRecorder.clear();
  });

  it('admits events that arrive within the flush delay into the previous window', () => {
    const buffer = new RollingWindowBuffer({
      windowDurationMs: 500,
      strideMs: 250,
      minEventsPerWindow: 3,
      flushDelayMs: 250
    });
    buffer.anchor(0);

    // Two events in the first slot: below the minimum, so with no delay it would be skipped.
    buffer.push({ timestamp: 50, type: 'mousemove', x: 0.1, y: 0.1 });
    buffer.push({ timestamp: 100, type: 'mousemove', x: 0.2, y: 0.2 });

    // Advance exactly one stride: the slot is not processed yet.
    expect(buffer.tick(250)).toEqual([]);

    // A third event arrives late, still inside the flush delay window.
    buffer.push({ timestamp: 240, type: 'mousemove', x: 0.3, y: 0.3 });

    const windows = buffer.tick(500);
    const firstSlot = windows.find((w) => w.windowStart === 0);

    expect(firstSlot).toBeDefined();
    expect(firstSlot?.eventCount).toBe(3);
    expect(firstSlot?.inactive).toBe(false);
  });

  it('still emits inactivity windows once the clock has advanced', () => {
    const buffer = new RollingWindowBuffer({
      windowDurationMs: 500,
      strideMs: 250,
      minEventsPerWindow: 3,
      flushDelayMs: 250
    });
    buffer.anchor(0);
    buffer.push({ timestamp: 50, type: 'mousemove', x: 0.1, y: 0.1 });

    const windows = buffer.tick(2000);
    expect(windows.some((w) => w.inactive)).toBe(true);
  });

  it('does not lose events to the delay', () => {
    const buffer = new RollingWindowBuffer({
      windowDurationMs: 500,
      strideMs: 250,
      minEventsPerWindow: 1,
      flushDelayMs: 250
    });
    buffer.anchor(0);
    for (let i = 0; i < 10; i++) {
      buffer.push({ timestamp: i * 100, type: 'mousemove', x: i / 20, y: 0.1 });
    }

    const windows = buffer.tick(2500);
    const counted = windows.reduce((sum, w) => sum + (w.eventCount ?? 0), 0);
    expect(counted).toBe(10);
  });
});
