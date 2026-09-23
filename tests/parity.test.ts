/**
 * MicroTensor Python ↔ TypeScript Parity Test Suite
 * Implements Stage 11.2 specifications from docs/testbed/prd.md Section 35 & docs/plan/tasks/11.2.md.
 * 
 * Verifies:
 * 1. Zero covariate shift: Floating-point outputs match Python reference within 1e-4 tolerance.
 * 2. Exact alignment of feature indices (0-8 continuous kinematics, 9-17 binary modality mask).
 * 3. Modality capability masking semantics across stationary, movement, dwell, and scroll streams.
 */

import { describe, it, expect } from 'vitest';
import { computeWindowMicroTensor } from '../src/microtensor/features';
import { MICROTENSOR_DIM, NUM_BEHAVIOURAL_FEATURES } from '../src/microtensor/schema';
import syntheticFixture from './fixtures/syntheticEvents.json';
import { BehaviourEvent } from '../src/telemetry/events';

describe('Task 11.2: Python ↔ TypeScript MicroTensor Parity', () => {
  it('contains valid synthetic benchmark scenarios', () => {
    expect(syntheticFixture.scenarios.length).toBeGreaterThanOrEqual(4);
    const names = syntheticFixture.scenarios.map((s) => s.name);
    expect(names).toContain('stationary_pointer');
    expect(names).toContain('accelerated_movement_turns');
    expect(names).toContain('hover_dwell');
    expect(names).toContain('viewport_scroll');
    expect(names).toContain('masked_modalities_pointer_only');
  });

  syntheticFixture.scenarios.forEach((scenario) => {
    it(`achieves parity for scenario: ${scenario.name} within 1e-4 tolerance`, () => {
      const events: BehaviourEvent[] = scenario.events.map((e) => ({
        timestamp: e.timestamp,
        type: e.type as any,
        x: e.x,
        y: e.y,
        componentId: e.componentId,
        targetTag: e.type === 'mouseover' ? 'BUTTON' : undefined
      }));

      const microtensor = computeWindowMicroTensor(events, {
        viewport: scenario.viewport,
        document: scenario.document,
        windowDurationMs: scenario.windowDurationMs,
        modalitySupport: scenario.modalitySupport
      });

      expect(microtensor.length).toBe(MICROTENSOR_DIM);
      expect(microtensor.length).toBe(18);

      const expected = scenario.expectedMicroTensor;
      expect(expected.length).toBe(18);

      for (let i = 0; i < 18; i++) {
        const actualVal = microtensor[i];
        const expectedVal = expected[i];
        const diff = Math.abs(actualVal - expectedVal);

        expect(
          diff,
          `Scenario '${scenario.name}', dimension ${i}: actual=${actualVal.toFixed(6)}, expected=${expectedVal.toFixed(6)}, diff=${diff.toFixed(6)}`
        ).toBeLessThanOrEqual(1e-4);
      }
    });
  });

  it('guarantees feature index ordering and binary modality mask semantics', () => {
    const maskedScenario = syntheticFixture.scenarios.find(
      (s) => s.name === 'masked_modalities_pointer_only'
    );
    expect(maskedScenario).toBeDefined();

    const events: BehaviourEvent[] = maskedScenario!.events.map((e) => ({
      timestamp: e.timestamp,
      type: e.type as any,
      x: e.x,
      y: e.y,
      componentId: e.componentId
    }));

    const result = computeWindowMicroTensor(events, {
      viewport: maskedScenario!.viewport,
      document: maskedScenario!.document,
      windowDurationMs: maskedScenario!.windowDurationMs,
      modalitySupport: maskedScenario!.modalitySupport
    });

    // Verify first 9 dimensions are features in [0, 1]
    for (let i = 0; i < NUM_BEHAVIOURAL_FEATURES; i++) {
      expect(result[i]).toBeGreaterThanOrEqual(0.0);
      expect(result[i]).toBeLessThanOrEqual(1.0);
    }

    // Verify last 9 dimensions are binary flags in {0.0, 1.0}
    for (let i = NUM_BEHAVIOURAL_FEATURES; i < MICROTENSOR_DIM; i++) {
      expect([0.0, 1.0]).toContain(result[i]);
    }

    // In pointer-only scenario:
    // DOM dwell (index 5) feature and mask (index 14) must be 0
    expect(result[5]).toBe(0.0);
    expect(result[9 + 5]).toBe(0.0);

    // Scroll depth (index 7) & velocity (index 8) features and masks must be 0
    expect(result[7]).toBe(0.0);
    expect(result[8]).toBe(0.0);
    expect(result[9 + 7]).toBe(0.0);
    expect(result[9 + 8]).toBe(0.0);

    // Pointer kinematics (indices 0, 1, 2, 3, 4, 6) mask flags must be 1
    const pointerIndices = [0, 1, 2, 3, 4, 6];
    for (const idx of pointerIndices) {
      expect(result[9 + idx]).toBe(1.0);
    }
  });
});
