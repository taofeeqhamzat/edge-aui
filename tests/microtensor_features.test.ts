import { describe, it, expect } from 'vitest';
import {
  computeWindowMicroTensor
} from '../src/microtensor/features';
import {
  FEATURE_NAMES,
  NUM_BEHAVIOURAL_FEATURES,
  MICROTENSOR_DIM,
  NORMALIZATION_CONFIG
} from '../src/microtensor/schema';
import { BehaviourEvent } from '../src/telemetry/events';

describe('MicroTensor Feature Extraction (Task 5.1 & Parity with config.yaml)', () => {
  it('has exact 18-D schema and matches config.yaml feature definitions', () => {
    expect(NUM_BEHAVIOURAL_FEATURES).toBe(9);
    expect(MICROTENSOR_DIM).toBe(18);
    expect(FEATURE_NAMES).toEqual([
      'meanVelocity',
      'maxVelocity',
      'meanAcceleration',
      'hesitationCount',
      'totalTrajectoryLength',
      'dwellTimeMs',
      'trajectoryEntropy',
      'scrollDepthPercentage',
      'scrollVelocity'
    ]);
    expect(NORMALIZATION_CONFIG.mean_velocity_scale).toBe(10);
    expect(NORMALIZATION_CONFIG.max_velocity_scale).toBe(10);
    expect(NORMALIZATION_CONFIG.mean_acceleration_scale).toBe(1);
    expect(NORMALIZATION_CONFIG.hesitation_scale).toBe(25);
    expect(NORMALIZATION_CONFIG.trajectory_scale).toBe(2000);
    expect(NORMALIZATION_CONFIG.scroll_velocity_scale).toBe(5);
  });

  it('fails visibly when viewport dimensions are non-positive', () => {
    expect(() => {
      computeWindowMicroTensor([], { viewport: { width: 0, height: 1080 } });
    }).toThrow(/Invalid non-positive viewport/);

    expect(() => {
      computeWindowMicroTensor([], { viewport: { width: 1920, height: -50 } });
    }).toThrow(/Invalid non-positive viewport/);
  });

  it('preserves stationary cursor semantics with active pointer modality mask (ADR-001 & ADR-004)', () => {
    const stationaryEvents: BehaviourEvent[] = [
      {
        timestamp: 100,
        type: 'mousemove',
        x: 0.5,
        y: 0.5
      }
    ];

    const tensor = computeWindowMicroTensor(stationaryEvents, {
      viewport: { width: 1920, height: 1080 },
      modalitySupport: { pointer: true, dom: true, scroll: true }
    });

    expect(tensor.length).toBe(18);
    // Kinematic features must be 0.0 for stationary cursor
    expect(tensor[0]).toBe(0.0); // meanVelocity
    expect(tensor[1]).toBe(0.0); // maxVelocity
    expect(tensor[2]).toBe(0.0); // meanAcceleration
    expect(tensor[3]).toBe(0.0); // hesitationCount
    expect(tensor[4]).toBe(0.0); // totalTrajectoryLength
    expect(tensor[6]).toBe(0.0); // trajectoryEntropy

    // Modality mask (indices 9..17) must be 1.0 because sensor is available
    expect(tensor[9 + 0]).toBe(1.0); // mask_mean_velocity
    expect(tensor[9 + 1]).toBe(1.0); // mask_max_velocity
    expect(tensor[9 + 2]).toBe(1.0); // mask_mean_acceleration
    expect(tensor[9 + 3]).toBe(1.0); // mask_hesitation_count
    expect(tensor[9 + 4]).toBe(1.0); // mask_total_trajectory_length
    expect(tensor[9 + 6]).toBe(1.0); // mask_trajectory_entropy
  });

  it('extracts accurate kinematic metrics from pointer trajectories', () => {
    // 1920x1080 viewport
    // Event 1: (x: 0.1, y: 0.1) at t=0 -> px: (192, 108)
    // Event 2: (x: 0.2, y: 0.1) at t=100 -> px: (384, 108) -> dx=192px, dt=100ms -> v=1.92 px/ms
    // Event 3: (x: 0.2, y: 0.3) at t=200 -> px: (384, 324) -> dy=216px, dt=100ms -> v=2.16 px/ms
    // Angle turn: from 0 deg (east) to 90 deg (south) -> 90 deg turn (> 45 deg) -> hesitation = 1
    const events: BehaviourEvent[] = [
      { timestamp: 0, type: 'mousemove', x: 0.1, y: 0.1 },
      { timestamp: 100, type: 'mousemove', x: 0.2, y: 0.1 },
      { timestamp: 200, type: 'mousemove', x: 0.2, y: 0.3 }
    ];

    const tensor = computeWindowMicroTensor(events, {
      viewport: { width: 1920, height: 1080 }
    });

    const expectedDist1 = 192;
    const expectedDist2 = 216;
    const expectedTotalDist = expectedDist1 + expectedDist2; // 408 px
    const expectedV1 = 192 / 100; // 1.92 px/ms
    const expectedV2 = 216 / 100; // 2.16 px/ms
    const expectedMeanVel = (expectedV1 + expectedV2) / 2; // 2.04 px/ms
    const expectedMaxVel = expectedV2; // 2.16 px/ms

    // Normalized by 10.0
    expect(tensor[0]).toBeCloseTo(expectedMeanVel / 10.0, 4);
    expect(tensor[1]).toBeCloseTo(expectedMaxVel / 10.0, 4);

    // Total trajectory length normalized by 2000.0
    expect(tensor[4]).toBeCloseTo(expectedTotalDist / 2000.0, 4);

    // 1 turn of 90 degrees > 45 degrees -> hesitation = 1 / 25.0
    expect(tensor[3]).toBeCloseTo(1.0 / 25.0, 4);

    // Trajectory entropy must be strictly in [0, 1]
    expect(tensor[6]).toBeGreaterThan(0.0);
    expect(tensor[6]).toBeLessThanOrEqual(1.0);
  });

  it('accumulates DOM dwell time correctly without pointer movement', () => {
    // 3 DOM hover events on interactive elements
    // 3 * 40ms = 120ms / 500ms = 0.24
    const events: BehaviourEvent[] = [
      { timestamp: 100, type: 'mouseover', componentId: 'btn-apply-filters' },
      { timestamp: 200, type: 'mouseover', componentId: 'btn-apply-filters' },
      { timestamp: 300, type: 'mouseover', componentId: 'btn-apply-filters' }
    ];

    const tensor = computeWindowMicroTensor(events, {
      windowDurationMs: 500
    });

    expect(tensor[5]).toBeCloseTo(0.24, 3);
    expect(tensor[9 + 5]).toBe(1.0); // DOM mask active
  });

  it('calculates scroll depth and scroll velocity', () => {
    const events: BehaviourEvent[] = [
      { timestamp: 100, type: 'scroll', scrollY: 0.45 },
      { timestamp: 200, type: 'scroll', scrollY: 0.50 }
    ];

    const tensor = computeWindowMicroTensor(events, {
      windowDurationMs: 500
    });

    // Uses the latest scrollY = 0.50
    expect(tensor[7]).toBeCloseTo(0.50, 2);

    // 2 scroll events * 100 / 500ms = 0.4 px/ms scroll speed; normalized by 5.0 -> 0.4 / 5.0 = 0.08
    expect(tensor[8]).toBeCloseTo(0.08, 3);

    // Scroll masks active
    expect(tensor[9 + 7]).toBe(1.0);
    expect(tensor[9 + 8]).toBe(1.0);
  });

  it('masks inactive modalities and zeros out corresponding feature dimensions', () => {
    const events: BehaviourEvent[] = [
      { timestamp: 100, type: 'mousemove', x: 0.1, y: 0.1 },
      { timestamp: 200, type: 'mousemove', x: 0.2, y: 0.1 },
      { timestamp: 250, type: 'scroll', scrollY: 0.5 },
      { timestamp: 300, type: 'mouseover', componentId: 'btn-test' }
    ];

    // Pointer support only (DOM and scroll disabled)
    const tensor = computeWindowMicroTensor(events, {
      modalitySupport: { pointer: true, dom: false, scroll: false }
    });

    // Pointer features and masks are active
    expect(tensor[0]).toBeGreaterThan(0.0);
    expect(tensor[9 + 0]).toBe(1.0);

    // DOM and scroll features are strictly 0.0
    expect(tensor[5]).toBe(0.0); // dwellTimeMs
    expect(tensor[7]).toBe(0.0); // scrollDepthPercentage
    expect(tensor[8]).toBe(0.0); // scrollVelocity

    // DOM and scroll masks are strictly 0.0
    expect(tensor[9 + 5]).toBe(0.0);
    expect(tensor[9 + 7]).toBe(0.0);
    expect(tensor[9 + 8]).toBe(0.0);
  });

  it('guarantees all 18 tensor elements are bounded in [0.0, 1.0] with zero NaNs and zero Infs', () => {
    const extremeEvents: BehaviourEvent[] = [
      { timestamp: 0, type: 'mousemove', x: 0.0, y: 0.0 },
      { timestamp: 1, type: 'mousemove', x: 1.0, y: 1.0 }, // extreme velocity jump
      { timestamp: 2, type: 'scroll', scrollY: 10.0 } // out-of-bounds scroll
    ];

    const tensor = computeWindowMicroTensor(extremeEvents, {
      viewport: { width: 1920, height: 1080 }
    });

    for (let i = 0; i < tensor.length; i++) {
      expect(Number.isNaN(tensor[i])).toBe(false);
      expect(Number.isFinite(tensor[i])).toBe(true);
      expect(tensor[i]).toBeGreaterThanOrEqual(0.0);
      expect(tensor[i]).toBeLessThanOrEqual(1.0);
    }
  });
});
