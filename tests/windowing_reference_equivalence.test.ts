/**
 * Windowing Reference Equivalence Test Suite (Plan 1 Task 1.3)
 *
 * Verifies that the live RollingWindowBuffer implementation is equivalent to the
 * canonical Python reference behaviour in `model-preparation/src/preprocessing.py`.
 *
 * Covers:
 * (a) Boundary event exactly on a window edge (half-open [start, end) exclusivity);
 * (b) Inactive interval producing all-zero/inactivity windows (with documented divergence);
 * (c) Slot sparse at emission time that becomes dense with delayed settlement (ADR-005);
 * (d) Distribution-shifted event position exercising geometry normalisation against reference viewport;
 * (e) Session start and end partial windows.
 *
 * Equivalence criterion: 1e-4 tolerance across all 18 MicroTensor dimensions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RollingWindowBuffer } from '../src/microtensor/window';
import { computeWindowMicroTensor } from '../src/microtensor/features';
import { BehaviourEvent } from '../src/telemetry/events';
import { experimentRecorder } from '../src/telemetry/recorder';
import equivalenceFixture from './fixtures/windowingEquivalenceStream.json';

const TOLERANCE = 1e-4;

describe('Task 1.3: Python-Reference Windowing Equivalence', () => {
  beforeEach(() => {
    experimentRecorder.clear();
  });

  // --------------------------------------------------------------------------
  // Scenario A: Boundary Event Exactly on a Window Edge
  // --------------------------------------------------------------------------
  it('Scenario A: verifies half-open boundary exclusivity on window edges against Python reference', () => {
    const scenario = equivalenceFixture.scenarios.find(
      (s) => s.name === 'scenario_a_boundary_event_on_edge'
    );
    expect(scenario).toBeDefined();

    const buffer = new RollingWindowBuffer({
      windowDurationMs: scenario!.windowDurationMs,
      strideMs: scenario!.strideMs,
      minEventsPerWindow: 3,
      settlementDelayMs: 0
    });
    buffer.anchor(0);

    for (const ev of scenario!.events) {
      buffer.push({
        timestamp: ev.timestamp,
        type: ev.type as any,
        x: ev.x,
        y: ev.y,
        viewport: scenario!.viewport,
        document: scenario!.document
      });
    }

    // Tick to cover slot 0 [0, 250) and slot 1 [250, 500)
    const windows = buffer.tick(500);
    expect(windows.length, 'Scenario A: should emit exactly 2 consecutive slots').toBe(2);

    // Slot 0: [0, 250)
    const slot0 = windows[0];
    expect(slot0.windowStart).toBe(0);
    expect(slot0.windowEnd).toBe(250);
    expect(slot0.eventCount, 'Scenario A: slot 0 must contain 3 events (t=0, 100, 200)').toBe(3);

    // Slot 1: [250, 500)
    const slot1 = windows[1];
    expect(slot1.windowStart).toBe(250);
    expect(slot1.windowEnd).toBe(500);
    expect(
      slot1.eventCount,
      'Scenario A: event at t=250 belongs strictly to slot 1 [250, 500) due to [start, end) semantics'
    ).toBe(3);

    // Compare 18-D MicroTensors against Python reference
    const expectedSlot0 = scenario!.expectedMicroTensors.slot0_events;
    for (let i = 0; i < 18; i++) {
      const diff = Math.abs(slot0.values[i] - expectedSlot0[i]);
      expect(
        diff,
        `Scenario A (Slot 0), dimension ${i}: actual=${slot0.values[i].toFixed(6)}, expected=${expectedSlot0[i].toFixed(6)}`
      ).toBeLessThanOrEqual(TOLERANCE);
    }

    const expectedSlot1 = scenario!.expectedMicroTensors.slot1_events;
    for (let i = 0; i < 18; i++) {
      const diff = Math.abs(slot1.values[i] - expectedSlot1[i]);
      expect(
        diff,
        `Scenario A (Slot 1), dimension ${i}: actual=${slot1.values[i].toFixed(6)}, expected=${expectedSlot1[i].toFixed(6)}`
      ).toBeLessThanOrEqual(TOLERANCE);
    }
  });

  // --------------------------------------------------------------------------
  // Scenario B: Inactive Interval Producing All-Zero / Inactivity Windows
  // --------------------------------------------------------------------------
  it('Scenario B: verifies inactivity emission and asserts documented divergence from Python reference', () => {
    const scenario = equivalenceFixture.scenarios.find(
      (s) => s.name === 'scenario_b_inactive_interval'
    );
    expect(scenario).toBeDefined();

    const buffer = new RollingWindowBuffer({
      windowDurationMs: scenario!.windowDurationMs,
      strideMs: scenario!.strideMs,
      minEventsPerWindow: 3,
      emitInactiveWindows: true,
      settlementDelayMs: 0
    });
    buffer.anchor(0);

    for (const ev of scenario!.events) {
      buffer.push({
        timestamp: ev.timestamp,
        type: ev.type as any,
        x: ev.x,
        y: ev.y,
        viewport: scenario!.viewport,
        document: scenario!.document
      });
    }

    // Tick past the resumed activity (slot ending at 1500)
    const windows = buffer.tick(1500);

    // Slot 0: [0, 250) - dense
    expect(windows[0].windowStart).toBe(0);
    expect(windows[0].inactive).toBe(false);
    expect(windows[0].eventCount).toBe(3);

    // Documented intentional divergence:
    // Inactivity slots [250, 500), [500, 750), [750, 1000), [1000, 1250)
    // TypeScript emits all-zero feature vectors with capability mask preserved.
    // Python drops empty windows because len(window_evs) < min_events_per_window.
    const inactiveSlots = windows.filter((w) => w.inactive);
    expect(
      inactiveSlots.length,
      'Scenario B: 1000ms idle span must yield 4 consecutive inactivity windows (250ms stride)'
    ).toBe(4);

    for (const inact of inactiveSlots) {
      expect(inact.eventCount).toBe(0);
      // Continuous kinematic features (0-8) must be zero
      for (let i = 0; i < 9; i++) {
        expect(inact.values[i], `Scenario B inactive feature ${i} must be 0`).toBe(0.0);
      }
      // Modality mask (9-17) must remain 1.0 (pointing capability is available)
      for (let i = 9; i < 18; i++) {
        expect(inact.values[i], `Scenario B inactive mask ${i} must be preserved as 1.0`).toBe(1.0);
      }
    }

    // Slot 5: [1250, 1500) - resumed dense slot
    const resumedSlot = windows.find((w) => w.windowStart === 1250);
    expect(resumedSlot).toBeDefined();
    expect(resumedSlot?.inactive).toBe(false);
    expect(resumedSlot?.eventCount).toBe(3);

    // Numerical parity of active slots with Python reference
    const expectedSlot0 = scenario!.expectedMicroTensors.slot0_events;
    for (let i = 0; i < 18; i++) {
      const diff = Math.abs(windows[0].values[i] - expectedSlot0[i]);
      expect(
        diff,
        `Scenario B (Slot 0), dimension ${i}: actual=${windows[0].values[i].toFixed(6)}, expected=${expectedSlot0[i].toFixed(6)}`
      ).toBeLessThanOrEqual(TOLERANCE);
    }

    const expectedResume = scenario!.expectedMicroTensors.slot_resume_events;
    for (let i = 0; i < 18; i++) {
      const diff = Math.abs(resumedSlot!.values[i] - expectedResume[i]);
      expect(
        diff,
        `Scenario B (Resume Slot), dimension ${i}: actual=${resumedSlot!.values[i].toFixed(6)}, expected=${expectedResume[i].toFixed(6)}`
      ).toBeLessThanOrEqual(TOLERANCE);
    }
  });

  // --------------------------------------------------------------------------
  // Scenario C: Slot Sparse at Emission Time that Becomes Dense with Delayed Settlement
  // --------------------------------------------------------------------------
  it('Scenario C: verifies delayed settlement sparse window recovery (ADR-005)', () => {
    const scenario = equivalenceFixture.scenarios.find(
      (s) => s.name === 'scenario_c_delayed_settlement_sparse_recovery'
    );
    expect(scenario).toBeDefined();

    const buffer = new RollingWindowBuffer({
      windowDurationMs: scenario!.windowDurationMs,
      strideMs: scenario!.strideMs,
      minEventsPerWindow: 3,
      settlementDelayMs: 250 // ADR-005 Option B: 250ms delay
    });
    buffer.anchor(0);

    // Push initial 2 events (sparse at nominal boundary)
    buffer.push({
      timestamp: 50,
      type: 'mousemove',
      x: 0.1,
      y: 0.1,
      viewport: scenario!.viewport,
      document: scenario!.document
    });
    buffer.push({
      timestamp: 100,
      type: 'mousemove',
      x: 0.15,
      y: 0.12,
      viewport: scenario!.viewport,
      document: scenario!.document
    });

    // Advance clock to nominal slot end: slot is held open by delayed settlement
    const earlyTick = buffer.tick(250);
    expect(earlyTick, 'Scenario C: slot must be held open during settlement delay').toEqual([]);

    // 3rd event arrives with timestamp 240 during the delay period
    buffer.push({
      timestamp: 240,
      type: 'mousemove',
      x: 0.2,
      y: 0.18,
      viewport: scenario!.viewport,
      document: scenario!.document
    });

    // Settle slot at delay expiry (t=500)
    const settledWindows = buffer.tick(500);
    expect(settledWindows.length, 'Scenario C: slot must settle when delay expires').toBe(1);

    const window = settledWindows[0];
    expect(window.windowStart).toBe(0);
    expect(window.windowEnd).toBe(250);
    expect(window.eventCount).toBe(3);
    expect(window.inactive).toBe(false);

    // Observable counter assertions
    expect(buffer.settledSparseWindows, 'Scenario C: settledSparseWindows counter must increment').toBe(1);
    expect(buffer.skippedSparseWindows, 'Scenario C: skippedSparseWindows must be 0').toBe(0);

    // Compare with Python reference
    const expectedSettled = scenario!.expectedMicroTensors.settled_events;
    for (let i = 0; i < 18; i++) {
      const diff = Math.abs(window.values[i] - expectedSettled[i]);
      expect(
        diff,
        `Scenario C (Settled Slot), dimension ${i}: actual=${window.values[i].toFixed(6)}, expected=${expectedSettled[i].toFixed(6)}`
      ).toBeLessThanOrEqual(TOLERANCE);
    }
  });

  // --------------------------------------------------------------------------
  // Scenario D: Distribution-Shifted Event Position & Geometry Normalisation
  // --------------------------------------------------------------------------
  it('Scenario D: verifies geometry normalisation against reference viewport with distribution shift', () => {
    const scenario = equivalenceFixture.scenarios.find(
      (s) => s.name === 'scenario_d_distribution_shifted_geometry'
    );
    expect(scenario).toBeDefined();

    const buffer = new RollingWindowBuffer({
      windowDurationMs: scenario!.windowDurationMs,
      strideMs: scenario!.strideMs,
      minEventsPerWindow: 3,
      settlementDelayMs: 0
    });
    buffer.anchor(0);

    for (const ev of scenario!.events) {
      buffer.push({
        timestamp: ev.timestamp,
        type: ev.type as any,
        x: ev.x,
        y: ev.y,
        scrollY: (ev as any).scrollY,
        viewport: scenario!.viewport,
        document: scenario!.document
      });
    }

    const windows = buffer.tick(250);
    expect(windows.length, 'Scenario D: should emit slot [0, 250)').toBe(1);

    const window = windows[0];
    const expected = scenario!.expectedMicroTensors.slot_events;

    for (let i = 0; i < 18; i++) {
      const diff = Math.abs(window.values[i] - expected[i]);
      expect(
        diff,
        `Scenario D, dimension ${i}: actual=${window.values[i].toFixed(6)}, expected=${expected[i].toFixed(6)}`
      ).toBeLessThanOrEqual(TOLERANCE);
    }
  });

  // --------------------------------------------------------------------------
  // Scenario E: Session Start and End Partial Windows
  // --------------------------------------------------------------------------
  it('Scenario E: verifies session start anchoring and partial window boundary determinism', () => {
    const scenario = equivalenceFixture.scenarios.find(
      (s) => s.name === 'scenario_e_session_start_end_partial'
    );
    expect(scenario).toBeDefined();

    const buffer = new RollingWindowBuffer({
      windowDurationMs: scenario!.windowDurationMs,
      strideMs: scenario!.strideMs,
      minEventsPerWindow: 3,
      settlementDelayMs: 0
    });

    // Anchor at session origin t=1000
    buffer.anchor(1000);

    for (const ev of scenario!.events) {
      buffer.push({
        timestamp: ev.timestamp,
        type: ev.type as any,
        x: ev.x,
        y: ev.y,
        viewport: scenario!.viewport,
        document: scenario!.document
      });
    }

    // Tick to 1500: should emit slot 0 [1000, 1250) and slot 1 [1250, 1500)
    const windows = buffer.tick(1500);
    expect(windows.length, 'Scenario E: should emit exactly 2 completed slots').toBe(2);

    expect(windows[0].windowStart).toBe(1000);
    expect(windows[0].windowEnd).toBe(1250);
    expect(windows[0].eventCount).toBe(3);

    expect(windows[1].windowStart).toBe(1250);
    expect(windows[1].windowEnd).toBe(1500);
    expect(windows[1].eventCount).toBe(3);

    // Partial window interval [1500, 1750) has only 1 event at 1550 and clock is at 1600.
    // Advancing clock to 1600 must NOT emit premature or partial window.
    const partialTick = buffer.tick(1600);
    expect(partialTick, 'Scenario E: partial slot [1500, 1750) must not emit before stride elapses').toEqual([]);

    // Compare completed slots against Python reference
    const expectedSlot0 = scenario!.expectedMicroTensors.slot0_events;
    for (let i = 0; i < 18; i++) {
      const diff = Math.abs(windows[0].values[i] - expectedSlot0[i]);
      expect(
        diff,
        `Scenario E (Slot 0), dimension ${i}: actual=${windows[0].values[i].toFixed(6)}, expected=${expectedSlot0[i].toFixed(6)}`
      ).toBeLessThanOrEqual(TOLERANCE);
    }

    const expectedSlot1 = scenario!.expectedMicroTensors.slot1_events;
    for (let i = 0; i < 18; i++) {
      const diff = Math.abs(windows[1].values[i] - expectedSlot1[i]);
      expect(
        diff,
        `Scenario E (Slot 1), dimension ${i}: actual=${windows[1].values[i].toFixed(6)}, expected=${expectedSlot1[i].toFixed(6)}`
      ).toBeLessThanOrEqual(TOLERANCE);
    }
  });
});
