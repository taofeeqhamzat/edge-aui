/**
 * Task 2.2: Vectoriser Parity Suite (TypeScript ↔ Rust/WASM)
 * Verifies mathematical and behavioural parity over identical canonical events.
 *
 * Tested properties (brief §5):
 * 1. numerical parity (1e-4 tolerance)
 * 2. boundary behaviour
 * 3. modality masks
 * 4. missing capabilities
 * 5. inactivity
 * 6. geometry
 * 7. ordering
 * 8. malformed input handling
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import initWasm, { vectorize_canonical_events } from '../wasm-vectorizer/pkg/wasm_vectorizer.js';
import { computeWindowMicroTensor } from '../src/microtensor/features';
import { MICROTENSOR_DIM, NUM_BEHAVIOURAL_FEATURES } from '../src/microtensor/schema';
import { BehaviourEvent } from '../src/telemetry/events';
import syntheticFixture from './fixtures/syntheticEvents.json';

const TOLERANCE = 1e-4;

describe('Task 2.2: Vectoriser Parity Suite (TypeScript ↔ Rust/WASM)', () => {
  beforeAll(async () => {
    const wasmPath = path.resolve(__dirname, '../wasm-vectorizer/pkg/wasm_vectorizer_bg.wasm');
    if (!fs.existsSync(wasmPath)) {
      throw new Error(`WASM binary not found at ${wasmPath}. Run 'npm run build:wasm' before running parity tests.`);
    }
    const wasmBuffer = fs.readFileSync(wasmPath);
    await initWasm({ module_or_path: wasmBuffer });
  });

  // 1. Numerical Parity across all synthetic reference scenarios
  describe('1. numerical parity (tolerance <= 1e-4)', () => {
    syntheticFixture.scenarios.forEach((scenario) => {
      it(`numerical parity: matches TypeScript vectorizer on scenario '${scenario.name}' within ${TOLERANCE}`, () => {
        const events: BehaviourEvent[] = scenario.events.map((e) => ({
          timestamp: e.timestamp,
          type: e.type as any,
          x: e.x,
          y: e.y,
          componentId: e.componentId,
          targetTag: e.type === 'mouseover' ? 'BUTTON' : undefined
        }));

        const options = {
          viewport: scenario.viewport,
          document: scenario.document,
          windowDurationMs: scenario.windowDurationMs,
          modalitySupport: scenario.modalitySupport
        };

        const tsTensor = computeWindowMicroTensor(events, options);
        const wasmTensor = vectorize_canonical_events(events, options);

        expect(tsTensor.length).toBe(MICROTENSOR_DIM);
        expect(wasmTensor.length).toBe(MICROTENSOR_DIM);

        for (let i = 0; i < MICROTENSOR_DIM; i++) {
          const delta = Math.abs(tsTensor[i] - wasmTensor[i]);
          expect(
            delta,
            `Scenario '${scenario.name}' [dim ${i}]: TS=${tsTensor[i].toFixed(6)}, WASM=${wasmTensor[i].toFixed(6)}, delta=${delta.toFixed(6)}`
          ).toBeLessThanOrEqual(TOLERANCE);
        }
      });
    });
  });

  // 2. Boundary Behaviour
  describe('2. boundary behaviour', () => {
    it('boundary behaviour: handles extreme velocities and coordinates bounded in [0, 1]', () => {
      const extremeEvents: BehaviourEvent[] = [
        { timestamp: 0, type: 'mousemove', x: 0.0, y: 0.0 },
        { timestamp: 1, type: 'mousemove', x: 10.0, y: 10.0 }, // extreme leap outside [0, 1]
        { timestamp: 2, type: 'scroll', scrollY: 100.0 }
      ];

      const options = {
        viewport: { width: 1920, height: 1080 },
        document: { width: 1920, height: 3000 },
        windowDurationMs: 500
      };

      const tsTensor = computeWindowMicroTensor(extremeEvents, options);
      const wasmTensor = vectorize_canonical_events(extremeEvents, options);

      for (let i = 0; i < MICROTENSOR_DIM; i++) {
        expect(Number.isNaN(wasmTensor[i])).toBe(false);
        expect(Number.isFinite(wasmTensor[i])).toBe(true);
        expect(wasmTensor[i]).toBeGreaterThanOrEqual(0.0);
        expect(wasmTensor[i]).toBeLessThanOrEqual(1.0);

        const delta = Math.abs(tsTensor[i] - wasmTensor[i]);
        expect(
          delta,
          `Boundary extreme [dim ${i}]: TS=${tsTensor[i].toFixed(6)}, WASM=${wasmTensor[i].toFixed(6)}, delta=${delta.toFixed(6)}`
        ).toBeLessThanOrEqual(TOLERANCE);
      }
    });

    it('boundary behaviour: handles sub-millisecond timestamps (dt < 1ms) clamping to 1.0ms', () => {
      const subMsEvents: BehaviourEvent[] = [
        { timestamp: 100.0, type: 'mousemove', x: 0.1, y: 0.1 },
        { timestamp: 100.2, type: 'mousemove', x: 0.15, y: 0.15 } // dt = 0.2ms -> clamped to 1.0ms
      ];

      const options = {
        viewport: { width: 1920, height: 1080 }
      };

      const tsTensor = computeWindowMicroTensor(subMsEvents, options);
      const wasmTensor = vectorize_canonical_events(subMsEvents, options);

      for (let i = 0; i < MICROTENSOR_DIM; i++) {
        const delta = Math.abs(tsTensor[i] - wasmTensor[i]);
        expect(
          delta,
          `Sub-ms dt [dim ${i}]: TS=${tsTensor[i].toFixed(6)}, WASM=${wasmTensor[i].toFixed(6)}, delta=${delta.toFixed(6)}`
        ).toBeLessThanOrEqual(TOLERANCE);
      }
    });
  });

  // 3. Modality Masks
  describe('3. modality masks', () => {
    it('modality masks: matches across all 8 capability permutations', () => {
      const events: BehaviourEvent[] = [
        { timestamp: 100, type: 'mousemove', x: 0.2, y: 0.2 },
        { timestamp: 200, type: 'mousemove', x: 0.4, y: 0.3 },
        { timestamp: 250, type: 'mouseover', componentId: 'submit-btn' },
        { timestamp: 300, type: 'scroll' }
      ];

      const permutations = [
        { pointer: true, dom: true, scroll: true },
        { pointer: true, dom: true, scroll: false },
        { pointer: true, dom: false, scroll: true },
        { pointer: true, dom: false, scroll: false },
        { pointer: false, dom: true, scroll: true },
        { pointer: false, dom: true, scroll: false },
        { pointer: false, dom: false, scroll: true },
        { pointer: false, dom: false, scroll: false }
      ];

      for (const mod of permutations) {
        const options = {
          viewport: { width: 1920, height: 1080 },
          document: { width: 1920, height: 3000 },
          modalitySupport: mod
        };
        const tsTensor = computeWindowMicroTensor(events, options);
        const wasmTensor = vectorize_canonical_events(events, options);

        for (let i = 0; i < MICROTENSOR_DIM; i++) {
          const delta = Math.abs(tsTensor[i] - wasmTensor[i]);
          expect(
            delta,
            `Modality permutation ${JSON.stringify(mod)} [dim ${i}]: TS=${tsTensor[i]}, WASM=${wasmTensor[i]}`
          ).toBeLessThanOrEqual(TOLERANCE);
        }
      }
    });
  });

  // 4. Missing Capabilities
  describe('4. missing capabilities', () => {
    it('missing capabilities: zeros features and sets mask to 0 when capability is omitted', () => {
      const events: BehaviourEvent[] = [
        { timestamp: 100, type: 'mousemove', x: 0.2, y: 0.2 },
        { timestamp: 200, type: 'mousemove', x: 0.4, y: 0.4 },
        { timestamp: 250, type: 'mouseover', componentId: 'button-ok' },
        { timestamp: 300, type: 'scroll' }
      ];

      // Dom and scroll disabled
      const options = {
        viewport: { width: 1920, height: 1080 },
        document: { width: 1920, height: 3000 },
        modalitySupport: { pointer: true, dom: false, scroll: false }
      };

      const tsTensor = computeWindowMicroTensor(events, options);
      const wasmTensor = vectorize_canonical_events(events, options);

      // DOM feature (5) and mask (14) must be 0
      expect(wasmTensor[5]).toBe(0.0);
      expect(wasmTensor[9 + 5]).toBe(0.0);
      // Scroll features (7, 8) and masks (16, 17) must be 0
      expect(wasmTensor[7]).toBe(0.0);
      expect(wasmTensor[8]).toBe(0.0);
      expect(wasmTensor[9 + 7]).toBe(0.0);
      expect(wasmTensor[9 + 8]).toBe(0.0);

      // Parity with TS
      for (let i = 0; i < MICROTENSOR_DIM; i++) {
        expect(Math.abs(tsTensor[i] - wasmTensor[i])).toBeLessThanOrEqual(TOLERANCE);
      }
    });
  });

  // 5. Inactivity
  describe('5. inactivity', () => {
    it('inactivity: empty events window produces identical zero kinematic features with active masks', () => {
      const emptyEvents: BehaviourEvent[] = [];
      const options = {
        viewport: { width: 1920, height: 1080 },
        document: { width: 1920, height: 3000 },
        windowDurationMs: 500
      };

      const tsTensor = computeWindowMicroTensor(emptyEvents, options);
      const wasmTensor = vectorize_canonical_events(emptyEvents, options);

      // All 9 features must be 0.0
      for (let i = 0; i < NUM_BEHAVIOURAL_FEATURES; i++) {
        expect(wasmTensor[i]).toBe(0.0);
        expect(tsTensor[i]).toBe(0.0);
      }

      // All 9 masks must be 1.0 (since modalities are supported)
      for (let i = NUM_BEHAVIOURAL_FEATURES; i < MICROTENSOR_DIM; i++) {
        expect(wasmTensor[i]).toBe(1.0);
        expect(tsTensor[i]).toBe(1.0);
      }

      for (let i = 0; i < MICROTENSOR_DIM; i++) {
        expect(Math.abs(tsTensor[i] - wasmTensor[i])).toBeLessThanOrEqual(TOLERANCE);
      }
    });
  });

  // 6. Geometry
  describe('6. geometry', () => {
    it('geometry: produces identical scaling across varied viewport and document geometries', () => {
      const events: BehaviourEvent[] = [
        { timestamp: 0, type: 'mousemove', x: 0.1, y: 0.2 },
        { timestamp: 100, type: 'mousemove', x: 0.5, y: 0.6 },
        { timestamp: 200, type: 'scroll' },
        { timestamp: 250, type: 'scroll' }
      ];

      const geometries = [
        { viewport: { width: 1366, height: 768 }, document: { width: 1366, height: 2400 } },
        { viewport: { width: 1920, height: 1080 }, document: { width: 1920, height: 3000 } },
        { viewport: { width: 2560, height: 1440 }, document: { width: 2560, height: 6000 } },
        { viewport: { width: 3840, height: 2160 }, document: { width: 3840, height: 10000 } }
      ];

      for (const geom of geometries) {
        const tsTensor = computeWindowMicroTensor(events, geom);
        const wasmTensor = vectorize_canonical_events(events, geom);

        for (let i = 0; i < MICROTENSOR_DIM; i++) {
          const delta = Math.abs(tsTensor[i] - wasmTensor[i]);
          expect(
            delta,
            `Geometry ${geom.viewport.width}x${geom.viewport.height} [dim ${i}]: TS=${tsTensor[i]}, WASM=${wasmTensor[i]}`
          ).toBeLessThanOrEqual(TOLERANCE);
        }
      }
    });
  });

  // 7. Ordering
  describe('7. ordering', () => {
    it('ordering: processes multi-event sequences consistently', () => {
      const events: BehaviourEvent[] = [
        { timestamp: 100, type: 'mousemove', x: 0.1, y: 0.1 },
        { timestamp: 150, type: 'mousemove', x: 0.2, y: 0.15 },
        { timestamp: 200, type: 'mousemove', x: 0.3, y: 0.25 },
        { timestamp: 250, type: 'mousemove', x: 0.3, y: 0.4 },
        { timestamp: 300, type: 'mousemove', x: 0.45, y: 0.4 }
      ];

      const options = {
        viewport: { width: 1920, height: 1080 },
        document: { width: 1920, height: 3000 }
      };

      const tsTensor = computeWindowMicroTensor(events, options);
      const wasmTensor = vectorize_canonical_events(events, options);

      for (let i = 0; i < MICROTENSOR_DIM; i++) {
        expect(Math.abs(tsTensor[i] - wasmTensor[i])).toBeLessThanOrEqual(TOLERANCE);
      }
    });
  });

  // 8. Malformed Input Handling
  describe('8. malformed input handling', () => {
    it('malformed input: both reject non-positive viewport dimensions', () => {
      expect(() => {
        computeWindowMicroTensor([], { viewport: { width: 0, height: 1080 } });
      }).toThrow(/Invalid non-positive viewport/);

      expect(() => {
        vectorize_canonical_events([], { viewport: { width: 0, height: 1080 } });
      }).toThrow(/Invalid non-positive viewport/);

      expect(() => {
        computeWindowMicroTensor([], { viewport: { width: 1920, height: -10 } });
      }).toThrow(/Invalid non-positive viewport/);

      expect(() => {
        vectorize_canonical_events([], { viewport: { width: 1920, height: -10 } });
      }).toThrow(/Invalid non-positive viewport/);
    });

    it('malformed input: both reject non-positive document dimensions', () => {
      expect(() => {
        computeWindowMicroTensor([], { document: { width: 0, height: 3000 } });
      }).toThrow(/Invalid non-positive document/);

      expect(() => {
        vectorize_canonical_events([], { document: { width: 0, height: 3000 } });
      }).toThrow(/Invalid non-positive document/);
    });
  });
});
