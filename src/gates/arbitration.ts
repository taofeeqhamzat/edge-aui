/**
 * AdaptiveInferenceEngine Dual-Gate Arbitration
 * Implements Stage 7.3 specifications from clipboard.9.md Section 21 & docs/plan/tasks/7.3.md.
 * 
 * Orchestrates dual-engine gate arbitration adhering to ADR-002:
 * 1. Macro sequence is evaluated by Fast Gate (PrefixSpan pattern matcher) first.
 * 2. If Fast Gate matches -> emits Fast Gate intervention immediately (Slow Gate strictly short-circuited).
 * 3. If Fast Gate misses -> invokes Slow Gate (recurrent GRU / ONNX worker) with MicroTensor sequence.
 */

import { MacroInteraction } from '../telemetry/events';
import { UIContext } from '../types/telemetry';
import { InterventionCommand } from '../intervention/types';
import { FastGate, GateDecision } from './fast/types';
import { SlowGate, SlowGateResult } from './slow/types';

export interface InferenceContext {
  macroSequence: MacroInteraction[];
  microTensorSequence: Float32Array;
  tensorShape?: [number, number, number];
  uiContext: UIContext;
}

export interface InferenceResult {
  intervention?: InterventionCommand;
  matchedGate: 'fast' | 'slow' | 'none';
  fastDecision: GateDecision;
  slowResult?: SlowGateResult;
  latencyMs: number;
  timestamp: number;
}

export interface AdaptiveInferenceEngineOptions {
  fastGate?: FastGate;
  slowGate?: SlowGate;
  enableFastGate?: boolean;
  enableSlowGate?: boolean;
}

export class AdaptiveInferenceEngine {
  private fastGate?: FastGate;
  private slowGate?: SlowGate;
  private enableFastGate: boolean;
  private enableSlowGate: boolean;

  constructor(options: AdaptiveInferenceEngineOptions = {}) {
    this.fastGate = options.fastGate;
    this.slowGate = options.slowGate;
    this.enableFastGate = options.enableFastGate ?? true;
    this.enableSlowGate = options.enableSlowGate ?? true;
  }

  /**
   * Executes dual-engine arbitration across Fast and Slow gates.
   */
  public async evaluate(context: InferenceContext): Promise<InferenceResult> {
    const startTime = performance.now();
    const timestamp = Date.now();

    let fastDecision: GateDecision = {
      matched: false,
      source: 'fast'
    };

    // 1. Evaluate Fast Gate if enabled
    if (this.enableFastGate && this.fastGate) {
      try {
        fastDecision = await this.fastGate.evaluate(context.macroSequence);
      } catch (err) {
        console.error('[AdaptiveInferenceEngine] Fast Gate evaluation error:', err);
        fastDecision = { matched: false, source: 'fast' };
      }

      // ADR-002: Fast Gate Precedence - Short-circuit Slow Gate on match
      if (fastDecision.matched && fastDecision.intervention && fastDecision.intervention.type !== 'no_op') {
        const latencyMs = performance.now() - startTime;
        return {
          intervention: fastDecision.intervention,
          matchedGate: 'fast',
          fastDecision,
          latencyMs,
          timestamp
        };
      }
    }

    // 2. Fast Gate Miss (or disabled): Invoke Slow Gate
    let slowResult: SlowGateResult | undefined;

    if (this.enableSlowGate && this.slowGate) {
      try {
        const shape = context.tensorShape ?? [1, 8, 18];
        slowResult = await this.slowGate.infer({
          sequence: context.microTensorSequence,
          shape,
          context: context.uiContext
        });

        if (slowResult.intervention && slowResult.intervention.type !== 'no_op') {
          const latencyMs = performance.now() - startTime;
          return {
            intervention: slowResult.intervention,
            matchedGate: 'slow',
            fastDecision,
            slowResult,
            latencyMs,
            timestamp
          };
        }
      } catch (err) {
        console.error('[AdaptiveInferenceEngine] Slow Gate inference error:', err);
      }
    }

    // 3. No intervention matched by either gate
    const latencyMs = performance.now() - startTime;
    return {
      matchedGate: 'none',
      fastDecision,
      slowResult,
      latencyMs,
      timestamp
    };
  }

  public setFastGate(gate?: FastGate): void {
    this.fastGate = gate;
  }

  public setSlowGate(gate?: SlowGate): void {
    this.slowGate = gate;
  }

  public setEnableFastGate(enabled: boolean): void {
    this.enableFastGate = enabled;
  }

  public setEnableSlowGate(enabled: boolean): void {
    this.enableSlowGate = enabled;
  }

  public isFastGateEnabled(): boolean {
    return this.enableFastGate;
  }

  public isSlowGateEnabled(): boolean {
    return this.enableSlowGate;
  }
}

/**
 * Factory helper creating configured AdaptiveInferenceEngine instance.
 */
export function createAdaptiveInferenceEngine(
  options?: AdaptiveInferenceEngineOptions
): AdaptiveInferenceEngine {
  return new AdaptiveInferenceEngine(options);
}
