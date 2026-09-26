import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import initWasm, {
  vectorize_canonical_events,
  vectorize_canonical_window,
  get_wasm_gate_version
} from '../wasm-vectorizer/pkg/wasm_vectorizer.js';
import { BehaviourEvent } from '../src/telemetry/events';
import { MICROTENSOR_DIM, NUM_BEHAVIOURAL_FEATURES } from '../src/microtensor/schema';

describe('Task 2.1: Canonical-Event Rust/WASM Vectoriser Contract', () => {
  beforeAll(async () => {
    const wasmPath = path.resolve(__dirname, '../wasm-vectorizer/pkg/wasm_vectorizer_bg.wasm');
    const wasmBuffer = fs.readFileSync(wasmPath);
    await initWasm({ module_or_path: wasmBuffer });
  });

  it('verifies the WASM gate module is loaded and reports version', () => {
    const version = get_wasm_gate_version();
    expect(version).toContain('Edge-AUI-Deterministic-Gate');
  });

  it('accepts canonical events and returns an 18-D Float32Array', () => {
    const events: BehaviourEvent[] = [
      { timestamp: 0, type: 'mousemove', x: 0.1, y: 0.1 },
      { timestamp: 100, type: 'mousemove', x: 0.2, y: 0.2 }
    ];

    const tensor = vectorize_canonical_events(events, {
      viewport: { width: 1920, height: 1080 },
      document: { width: 1920, height: 3000 },
      windowDurationMs: 500
    });

    expect(tensor).toBeInstanceOf(Float32Array);
    expect(tensor.length).toBe(MICROTENSOR_DIM);
    expect(tensor.length).toBe(18);

    // First 9 elements are normalized features in [0, 1]
    for (let i = 0; i < NUM_BEHAVIOURAL_FEATURES; i++) {
      expect(tensor[i]).toBeGreaterThanOrEqual(0.0);
      expect(tensor[i]).toBeLessThanOrEqual(1.0);
    }

    // Last 9 elements are modality mask values in {0, 1}
    for (let i = NUM_BEHAVIOURAL_FEATURES; i < MICROTENSOR_DIM; i++) {
      expect([0.0, 1.0]).toContain(tensor[i]);
    }
  });

  it('reports modality masks explicitly so missing capabilities are auditable', () => {
    const events: BehaviourEvent[] = [
      { timestamp: 100, type: 'mousemove', x: 0.2, y: 0.2 },
      { timestamp: 200, type: 'mouseover', componentId: 'button-1' },
      { timestamp: 300, type: 'scroll' }
    ];

    // Pointer-only modality capability
    const detailed = vectorize_canonical_window(events, {
      viewport: { width: 1920, height: 1080 },
      document: { width: 1920, height: 3000 },
      windowDurationMs: 500,
      modalitySupport: { pointer: true, dom: false, scroll: false }
    });

    expect(detailed).toBeDefined();
    expect(detailed.features.length).toBe(9);
    expect(detailed.modalityMask.length).toBe(9);
    expect(detailed.tensor.length).toBe(18);

    // Pointer features active (meanVelocity, maxVelocity, meanAccel, hesitation, trajLen, trajEntropy)
    expect(detailed.modalityMask[0]).toBe(1.0); // meanVelocity
    expect(detailed.modalityMask[1]).toBe(1.0); // maxVelocity
    expect(detailed.modalityMask[2]).toBe(1.0); // meanAcceleration
    expect(detailed.modalityMask[3]).toBe(1.0); // hesitationCount
    expect(detailed.modalityMask[4]).toBe(1.0); // totalTrajectoryLength
    expect(detailed.modalityMask[6]).toBe(1.0); // trajectoryEntropy

    // Disabled capabilities strictly 0 in mask and in features
    expect(detailed.modalityMask[5]).toBe(0.0); // dwellTimeMs mask
    expect(detailed.features[5]).toBe(0.0); // dwellTimeMs feature
    expect(detailed.modalityMask[7]).toBe(0.0); // scrollDepth mask
    expect(detailed.features[7]).toBe(0.0); // scrollDepth feature
    expect(detailed.modalityMask[8]).toBe(0.0); // scrollVelocity mask
    expect(detailed.features[8]).toBe(0.0); // scrollVelocity feature
  });

  it('returns a typed error for malformed or missing input rather than panicking', () => {
    expect(() => {
      vectorize_canonical_events(null as any, {});
    }).toThrow(/cannot be null or undefined/);

    expect(() => {
      vectorize_canonical_events(undefined as any, {});
    }).toThrow(/cannot be null or undefined/);

    expect(() => {
      vectorize_canonical_events([], { viewport: { width: 0, height: 1080 } });
    }).toThrow(/Invalid non-positive viewport/);

    expect(() => {
      vectorize_canonical_events([], { viewport: { width: 1920, height: -10 } });
    }).toThrow(/Invalid non-positive viewport/);

    expect(() => {
      vectorize_canonical_events([], { document: { width: -100, height: 2000 } });
    }).toThrow(/Invalid non-positive document/);

    expect(() => {
      vectorize_canonical_events([{ invalidField: true }] as any, {});
    }).toThrow();
  });
});
