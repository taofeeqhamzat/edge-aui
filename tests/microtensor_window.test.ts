import { describe, it, expect, beforeEach } from 'vitest';
import { RollingWindowBuffer } from '../src/microtensor/window';
import { BehaviourEvent } from '../src/telemetry/events';
import { experimentRecorder } from '../src/telemetry/recorder';

describe('RollingWindowBuffer (Task 5.1 & Window Extraction)', () => {
  beforeEach(() => {
    experimentRecorder.clear();
  });

  it('aggregates events and emits MicroTensorWindow on stride tick', () => {
    const buffer = new RollingWindowBuffer({
      windowDurationMs: 500,
      strideMs: 250,
      minEventsPerWindow: 3
    });

    // Feed events in interval [0, 250]
    buffer.push({ timestamp: 50, type: 'mousemove', x: 0.1, y: 0.1 });
    buffer.push({ timestamp: 100, type: 'mousemove', x: 0.12, y: 0.11 });
    buffer.push({ timestamp: 200, type: 'mousemove', x: 0.15, y: 0.13 });

    // Tick before stride elapsed (e.g. at t=200) -> returns null
    const earlyTick = buffer.tick(200);
    expect(earlyTick).toBeNull();

    // Push event at t=300 and tick at t=300 -> stride (250ms) has elapsed
    buffer.push({ timestamp: 300, type: 'mousemove', x: 0.2, y: 0.2 });
    const window = buffer.tick(300);

    expect(window).not.toBeNull();
    expect(window!.windowEnd).toBe(300);
    expect(window!.windowStart).toBe(300 - 500); // -200
    expect(window!.values.length).toBe(18);

    // Verified recorded in experiment trace
    expect(experimentRecorder.getEventCounts().microTensors).toBe(1);
  });

  it('drops windows that do not meet minEventsPerWindow', () => {
    const buffer = new RollingWindowBuffer({
      windowDurationMs: 500,
      strideMs: 250,
      minEventsPerWindow: 3
    });

    buffer.push({ timestamp: 10, type: 'mousemove', x: 0.1, y: 0.1 });
    // Only 1 event
    const window = buffer.tick(300);
    expect(window).toBeNull();
  });

  it('supports batch event stream processing with 500ms window and 250ms stride', () => {
    const buffer = new RollingWindowBuffer({
      windowDurationMs: 500,
      strideMs: 250,
      minEventsPerWindow: 2
    });

    // 1000ms duration event stream
    const events: BehaviourEvent[] = [
      { timestamp: 0, type: 'mousemove', x: 0.1, y: 0.1 },
      { timestamp: 100, type: 'mousemove', x: 0.2, y: 0.1 },
      { timestamp: 250, type: 'mousemove', x: 0.2, y: 0.2 },
      { timestamp: 500, type: 'mousemove', x: 0.3, y: 0.2 },
      { timestamp: 750, type: 'mousemove', x: 0.3, y: 0.4 },
      { timestamp: 1000, type: 'mousemove', x: 0.4, y: 0.5 }
    ];

    const windows = buffer.processEventStream(events);

    // Windows expected:
    // [0, 500], [250, 750], [500, 1000] -> 3 windows
    expect(windows.length).toBe(3);

    expect(windows[0].windowStart).toBe(0);
    expect(windows[0].windowEnd).toBe(500);

    expect(windows[1].windowStart).toBe(250);
    expect(windows[1].windowEnd).toBe(750);

    expect(windows[2].windowStart).toBe(500);
    expect(windows[2].windowEnd).toBe(1000);

    for (const w of windows) {
      expect(w.values.length).toBe(18);
    }
  });

  it('notifies subscribers via onWindow / subscribe callback', () => {
    const buffer = new RollingWindowBuffer({
      windowDurationMs: 500,
      strideMs: 250,
      minEventsPerWindow: 2
    });

    const emitted: number[] = [];
    const unsubscribe = buffer.subscribe((win) => {
      emitted.push(win.windowEnd);
    });

    buffer.push({ timestamp: 0, type: 'mousemove', x: 0.1, y: 0.1 });
    buffer.push({ timestamp: 100, type: 'mousemove', x: 0.2, y: 0.2 });
    buffer.tick(300);

    expect(emitted.length).toBe(1);
    expect(emitted[0]).toBe(250);

    unsubscribe();
    buffer.push({ timestamp: 350, type: 'mousemove', x: 0.3, y: 0.3 });
    buffer.tick(600);

    // No new emission after unsubscribe
    expect(emitted.length).toBe(1);
  });
});
