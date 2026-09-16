import { describe, it, expect } from 'vitest';
import {
  clamp,
  getMonotonicTimestamp,
  normalizeCoordinates,
  normalizeScroll,
  getViewportDimensions
} from '../src/telemetry/normalizer';
import type { BehaviourEvent } from '../src/telemetry/events';

describe('telemetry/normalizer', () => {
  describe('clamp()', () => {
    it('clamps values within [min, max]', () => {
      expect(clamp(0.5, 0, 1)).toBe(0.5);
      expect(clamp(-0.2, 0, 1)).toBe(0);
      expect(clamp(1.5, 0, 1)).toBe(1);
    });

    it('handles NaN gracefully by returning min', () => {
      expect(clamp(NaN, 0, 1)).toBe(0);
    });
  });

  describe('normalizeCoordinates()', () => {
    it('normalizes client coordinates to [0, 1] relative to viewport dimensions', () => {
      const result = normalizeCoordinates(960, 540, 1920, 1080);
      expect(result.x).toBeCloseTo(0.5, 5);
      expect(result.y).toBeCloseTo(0.5, 5);
    });

    it('strictly clamps out-of-bounds coordinates to [0, 1]', () => {
      const negativeResult = normalizeCoordinates(-150, -50, 1920, 1080);
      expect(negativeResult.x).toBe(0);
      expect(negativeResult.y).toBe(0);

      const overflowResult = normalizeCoordinates(2500, 1500, 1920, 1080);
      expect(overflowResult.x).toBe(1);
      expect(overflowResult.y).toBe(1);
    });

    it('handles zero or invalid viewport dimensions without producing NaN or Infinity', () => {
      const zeroDims = normalizeCoordinates(100, 100, 0, 0);
      expect(Number.isFinite(zeroDims.x)).toBe(true);
      expect(Number.isFinite(zeroDims.y)).toBe(true);
      expect(zeroDims.x).toBeGreaterThanOrEqual(0);
      expect(zeroDims.x).toBeLessThanOrEqual(1);

      const nanDims = normalizeCoordinates(100, 100, NaN, NaN);
      expect(Number.isFinite(nanDims.x)).toBe(true);
      expect(Number.isFinite(nanDims.y)).toBe(true);
    });

    it('uses fallback viewport dimensions when dimensions are omitted', () => {
      const result = normalizeCoordinates(960, 540);
      expect(result.x).toBeGreaterThanOrEqual(0);
      expect(result.x).toBeLessThanOrEqual(1);
      expect(result.y).toBeGreaterThanOrEqual(0);
      expect(result.y).toBeLessThanOrEqual(1);
    });
  });

  describe('normalizeScroll()', () => {
    it('normalizes scroll depth to [0, 1] given scrollable extent', () => {
      const halfScroll = normalizeScroll(0, 500, 0, 1000);
      expect(halfScroll.scrollX).toBe(0);
      expect(halfScroll.scrollY).toBeCloseTo(0.5, 5);

      const fullScroll = normalizeScroll(200, 1000, 200, 1000);
      expect(fullScroll.scrollX).toBe(1);
      expect(fullScroll.scrollY).toBe(1);
    });

    it('returns 0 when there is zero scrollable distance', () => {
      const zeroScroll = normalizeScroll(0, 0, 0, 0);
      expect(zeroScroll.scrollX).toBe(0);
      expect(zeroScroll.scrollY).toBe(0);
    });

    it('clamps negative or exceeding scroll values', () => {
      const overScroll = normalizeScroll(-50, 1500, 100, 1000);
      expect(overScroll.scrollX).toBe(0);
      expect(overScroll.scrollY).toBe(1);
    });
  });

  describe('getMonotonicTimestamp()', () => {
    it('returns non-negative increasing millisecond timestamps', async () => {
      const t1 = getMonotonicTimestamp();
      expect(typeof t1).toBe('number');
      expect(t1).toBeGreaterThanOrEqual(0);

      await new Promise((r) => setTimeout(r, 10));
      const t2 = getMonotonicTimestamp();
      expect(t2).toBeGreaterThanOrEqual(t1);
    });
  });

  describe('BehaviourEvent Canonical Schema Compliance', () => {
    it('constructs a valid canonical BehaviourEvent with normalized properties', () => {
      const norm = normalizeCoordinates(480, 270, 1920, 1080);
      const scroll = normalizeScroll(0, 250, 0, 1000);

      const event: BehaviourEvent = {
        timestamp: getMonotonicTimestamp(),
        type: 'mousemove',
        x: norm.x,
        y: norm.y,
        scrollX: scroll.scrollX,
        scrollY: scroll.scrollY,
        componentId: 'kpi-card-total',
        componentRole: 'kpi-card',
        route: 'Overview',
        action: 'hover',
        taskId: 'T1',
        taskStepId: 'step-1'
      };

      expect(event.type).toBe('mousemove');
      expect(event.x).toBeCloseTo(0.25, 4);
      expect(event.y).toBeCloseTo(0.25, 4);
      expect(event.scrollY).toBeCloseTo(0.25, 4);
      expect(event.componentId).toBe('kpi-card-total');
    });
  });
});
