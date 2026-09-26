/**
 * Pipeline Configuration Contract Tests
 *
 * Implements Stage 4.3 specifications from docs/plan/1/tasks/4.3.md and ADR-012.
 * Validates the 9 parameter groups of the framework Layer 2 runtime configuration surface:
 *   1. Default initialization with empty `{}`
 *   2. Strict boundary and invariant validation
 *   3. Subsystem propagation into RollingWindowBuffer, InterventionPolicy, MacroInteractionStream
 *   4. Observability and distinguishable trace output
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_RUNTIME_CONFIG,
  resolveRuntimeConfig,
  validateRuntimeConfig
} from '../src/config/runtimeConfig';
import { AdaptiveRuntime } from '../src/runtime/adaptiveRuntime';
import { experimentRecorder } from '../src/telemetry/recorder';
import { sessionManager } from '../src/telemetry/session';
import { DefaultUiAdapter } from '../src/integration';

describe('Pipeline Configuration Surface (ADR-012 / Task 4.2 & 4.3)', () => {
  beforeEach(() => {
    sessionManager.resetSession();
    experimentRecorder.clear();
  });

  describe('resolveRuntimeConfig & Default Configuration', () => {
    it('returns full DEFAULT_RUNTIME_CONFIG when invoked with empty object or undefined', () => {
      const config1 = resolveRuntimeConfig();
      const config2 = resolveRuntimeConfig({});

      expect(config1).toEqual(DEFAULT_RUNTIME_CONFIG);
      expect(config2).toEqual(DEFAULT_RUNTIME_CONFIG);

      // Verify all 9 parameter groups exist
      expect(config1.telemetry).toBeDefined();
      expect(config1.windowing).toBeDefined();
      expect(config1.microtensor).toBeDefined();
      expect(config1.macro).toBeDefined();
      expect(config1.fastGate).toBeDefined();
      expect(config1.slowGate).toBeDefined();
      expect(config1.policy).toBeDefined();
      expect(config1.actuation).toBeDefined();
      expect(config1.experiment).toBeDefined();
    });

    it('merges partial overrides without corrupting siblings', () => {
      const resolved = resolveRuntimeConfig({
        windowing: {
          windowDurationMs: 1000,
          strideMs: 500
        },
        policy: {
          confidenceThreshold: 0.90
        }
      });

      expect(resolved.windowing.windowDurationMs).toBe(1000);
      expect(resolved.windowing.strideMs).toBe(500);
      // Sibling field preserved
      expect(resolved.windowing.pendingOutcomeGraceMs).toBe(DEFAULT_RUNTIME_CONFIG.windowing.pendingOutcomeGraceMs);
      expect(resolved.policy.confidenceThreshold).toBe(0.90);
      expect(resolved.policy.cooldownMs).toBe(DEFAULT_RUNTIME_CONFIG.policy.cooldownMs);
    });
  });

  describe('Validation & Boundary Enforcement', () => {
    it('throws when windowDurationMs <= 0', () => {
      expect(() => {
        resolveRuntimeConfig({
          windowing: { windowDurationMs: 0 }
        });
      }).toThrow(/windowDurationMs: 0. Must be > 0/);

      expect(() => {
        resolveRuntimeConfig({
          windowing: { windowDurationMs: -100 }
        });
      }).toThrow(/windowDurationMs: -100. Must be > 0/);
    });

    it('throws when strideMs <= 0', () => {
      expect(() => {
        resolveRuntimeConfig({
          windowing: { strideMs: 0 }
        });
      }).toThrow(/strideMs: 0. Must be > 0/);
    });

    it('throws when strideMs > windowDurationMs', () => {
      expect(() => {
        resolveRuntimeConfig({
          windowing: {
            windowDurationMs: 500,
            strideMs: 600
          }
        });
      }).toThrow(/strideMs \(600\) cannot exceed windowDurationMs \(500\)/);
    });

    it('throws when policy.confidenceThreshold is out of [0, 1] range', () => {
      expect(() => {
        resolveRuntimeConfig({
          policy: { confidenceThreshold: -0.1 }
        });
      }).toThrow(/policy.confidenceThreshold: -0.1. Must be between 0 and 1/);

      expect(() => {
        resolveRuntimeConfig({
          policy: { confidenceThreshold: 1.5 }
        });
      }).toThrow(/policy.confidenceThreshold: 1.5. Must be between 0 and 1/);
    });

    it('throws when slowGate.confidenceThreshold is out of [0, 1] range', () => {
      expect(() => {
        resolveRuntimeConfig({
          slowGate: { confidenceThreshold: 1.1 }
        });
      }).toThrow(/slowGate.confidenceThreshold: 1.1. Must be between 0 and 1/);
    });

    it('throws when fastGate.minConfidence is out of [0, 1] range', () => {
      expect(() => {
        resolveRuntimeConfig({
          fastGate: { minConfidence: -0.5 }
        });
      }).toThrow(/fastGate.minConfidence: -0.5. Must be between 0 and 1/);
    });

    it('throws when macro.groupingIntervalMs <= 0', () => {
      expect(() => {
        resolveRuntimeConfig({
          macro: { groupingIntervalMs: 0 }
        });
      }).toThrow(/macro.groupingIntervalMs: 0. Must be > 0/);
    });
  });

  describe('AdaptiveRuntime Integration', () => {
    it('initializes with empty options and exposes effective default config', () => {
      const runtime = new AdaptiveRuntime({
        adapter: new DefaultUiAdapter(),
        forceInProcessWorker: true
      });

      const effective = runtime.getConfig();
      expect(effective).toEqual(DEFAULT_RUNTIME_CONFIG);
      expect(effective.telemetry.sampleIntervalMs).toBe(0);
      expect(effective.windowing.windowDurationMs).toBe(500);
      expect(effective.windowing.strideMs).toBe(250);
      expect(effective.policy.cooldownMs).toBe(5000);
    });

    it('propagates custom configuration overrides into AdaptiveRuntime', () => {
      const runtime = new AdaptiveRuntime({
        adapter: new DefaultUiAdapter(),
        forceInProcessWorker: true,
        config: {
          windowing: {
            windowDurationMs: 1000,
            strideMs: 500,
            inactivityThresholdMs: 3000
          },
          policy: {
            confidenceThreshold: 0.85,
            cooldownMs: 8000
          },
          macro: {
            groupingIntervalMs: 4000,
            maxRecentSymbols: 10
          }
        }
      });

      const effective = runtime.getConfig();
      expect(effective.windowing.windowDurationMs).toBe(1000);
      expect(effective.windowing.strideMs).toBe(500);
      expect(effective.windowing.inactivityThresholdMs).toBe(3000);
      expect(effective.policy.confidenceThreshold).toBe(0.85);
      expect(effective.policy.cooldownMs).toBe(8000);
      expect(effective.macro.groupingIntervalMs).toBe(4000);
      expect(effective.macro.maxRecentSymbols).toBe(10);
    });

    it('fails immediately when passed an invalid configuration', () => {
      expect(() => {
        new AdaptiveRuntime({
          adapter: new DefaultUiAdapter(),
          config: {
            windowing: {
              windowDurationMs: 500,
              strideMs: 750
            }
          }
        });
      }).toThrow(/strideMs \(750\) cannot exceed windowDurationMs \(500\)/);
    });
  });

  describe('Trace Recording & Distinguishable Traces', () => {
    it('records effectiveConfig into exported traces', () => {
      const runtimeA = new AdaptiveRuntime({
        adapter: new DefaultUiAdapter(),
        forceInProcessWorker: true,
        config: {
          policy: { confidenceThreshold: 0.70 }
        }
      });

      const session = sessionManager.startSession({
        experimentId: 'config_test_exp',
        conditionId: 'adaptive'
      });
      experimentRecorder.bindSession(session);

      const traceA = experimentRecorder.export();
      expect(traceA).toBeDefined();
      expect(traceA.effectiveConfig).toBeDefined();
      expect(traceA.effectiveConfig?.policy.confidenceThreshold).toBe(0.70);

      // Now create a second runtime with different config
      experimentRecorder.clear();
      const runtimeB = new AdaptiveRuntime({
        adapter: new DefaultUiAdapter(),
        forceInProcessWorker: true,
        config: {
          policy: { confidenceThreshold: 0.95 }
        }
      });

      const sessionB = sessionManager.startSession({
        experimentId: 'config_test_exp_b',
        conditionId: 'adaptive'
      });
      experimentRecorder.bindSession(sessionB);

      const traceB = experimentRecorder.export();
      expect(traceB).toBeDefined();
      expect(traceB.effectiveConfig?.policy.confidenceThreshold).toBe(0.95);

      // Verify traces are distinguishable by config
      expect(traceA?.effectiveConfig?.policy.confidenceThreshold).not.toBe(
        traceB?.effectiveConfig?.policy.confidenceThreshold
      );
    });
  });
});
