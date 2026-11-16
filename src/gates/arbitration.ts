/**
 * AdaptiveInferenceEngine Dual-Gate Arbitration
 * Implements Stage 7.3 specifications from docs/testbed/prd.md Section 21 & docs/plan/tasks/7.3.md.
 * 
 * Orchestrates dual-engine gate arbitration adhering to ADR-002:
 * 1. Macro sequence is evaluated by Fast Gate (PrefixSpan pattern matcher) first.
 * 2. If Fast Gate matches -> emits Fast Gate intervention immediately (Slow Gate strictly short-circuited).
 * 3. If Fast Gate misses -> invokes Slow Gate (recurrent GRU / ONNX worker) with MicroTensor sequence.
 */

import { MacroInteraction } from '../telemetry/events';
import { UIContext } from '../types/uiContext.js';
import { InterventionCommand } from '../intervention/types';
import { getWallClockTimestamp } from '../telemetry/normalizer';
import { FastGate, GateDecision } from './fast/types';
import { SlowGate, SlowGateResult } from './slow/types';
import {
  GatePrediction,
  PREDICTION_CONTRACT_VERSION,
  PredictionProvenance,
  PredictionResult,
  PredictionTarget,
  nextPredictionId,
  stampPrediction
} from './contracts';

export interface InferenceContext {
  macroSequence: MacroInteraction[];
  microTensorSequence: Float32Array;
  tensorShape?: [number, number, number];
  uiContext: UIContext;
}

export interface InferenceResult {
  /**
   * Candidate adaptation emitted by the deciding gate.
   *
   * Compatibility field: the policy acts on `prediction` and resolves it into a command
   * through the application's candidate resolver. Present only while gates still emit a
   * command of their own.
   */
  intervention?: InterventionCommand;
  /** The selected normalized prediction. Absent when neither gate produced one. */
  prediction?: PredictionResult;
  /** Lineage of the decision: gate, versions, mapping source and latency. */
  provenance: PredictionProvenance;
  matchedGate: 'fast' | 'slow' | 'none';
  fastDecision: GateDecision;
  slowResult?: SlowGateResult;
  latencyMs: number;
  /** Independent latency of Fast Gate evaluation (ADR-003). */
  fastGateLatencyMs?: number;
  /** Independent latency of Slow Gate evaluation (ADR-003). Undefined when short-circuited. */
  slowGateLatencyMs?: number;
  /** Canonical trace clock: epoch milliseconds (`getWallClockTimestamp()`). */
  timestamp: number;
}

export interface AdaptiveInferenceEngineOptions {
  fastGate?: FastGate;
  slowGate?: SlowGate;
  enableFastGate?: boolean;
  enableSlowGate?: boolean;
  /**
   * Issues the identity of each selected prediction. Defaults to the module-wide
   * monotonic sequence, so one process never reuses a prediction id.
   */
  createPredictionId?: () => string;
}

export class AdaptiveInferenceEngine {
  private fastGate?: FastGate;
  private slowGate?: SlowGate;
  private enableFastGate: boolean;
  private enableSlowGate: boolean;
  private readonly createPredictionId: () => string;

  constructor(options: AdaptiveInferenceEngineOptions = {}) {
    this.fastGate = options.fastGate;
    this.slowGate = options.slowGate;
    this.enableFastGate = options.enableFastGate ?? true;
    this.enableSlowGate = options.enableSlowGate ?? true;
    this.createPredictionId = options.createPredictionId ?? nextPredictionId;
  }

  /**
   * Executes dual-engine arbitration across Fast and Slow gates.
   *
   * Output on the normalized contract: the selected `prediction` (identity-stamped) and
   * the `provenance` of the decision. `intervention` is still passed through while gates
   * emit one, but the policy no longer needs it (Task 20.1).
   */
  public async evaluate(context: InferenceContext): Promise<InferenceResult> {
    const startTime = performance.now();
    // Epoch, not `Date.now()`-as-a-shortcut: the prediction is a persisted trace record, so
    // it must share the canonical clock with behaviour events and task events (F-01).
    const timestamp = getWallClockTimestamp();
    const contextTarget = predictionTargetFrom(context.uiContext);

    let fastDecision: GateDecision = {
      matched: false,
      source: 'fast'
    };
    let fastGateLatencyMs: number | undefined;
    let slowGateLatencyMs: number | undefined;

    // 1. Evaluate Fast Gate if enabled
    if (this.enableFastGate && this.fastGate) {
      const fastStart = performance.now();
      try {
        fastDecision = await this.fastGate.evaluate(context.macroSequence);
      } catch (err) {
        console.error('[AdaptiveInferenceEngine] Fast Gate evaluation error:', err);
        fastDecision = { matched: false, source: 'fast' };
      }
      fastGateLatencyMs = performance.now() - fastStart;

      // ADR-002: Fast Gate Precedence - Short-circuit Slow Gate on match.
      //
      // A match that resolves to `no_op` is not actionable, so the Slow Gate still runs
      // (unchanged behaviour). A gate that reports a matched prediction without a command
      // is actionable: the application resolver decides the adaptation.
      const declaresNoOp = fastDecision.intervention?.type === 'no_op';
      const fastShortCircuits =
        fastDecision.matched &&
        !declaresNoOp &&
        (fastDecision.intervention !== undefined || fastDecision.prediction?.matched === true);

      if (fastShortCircuits) {
        const latencyMs = performance.now() - startTime;
        const prediction = this.stamp(fastDecision.prediction, timestamp, contextTarget);
        return {
          intervention: fastDecision.intervention,
          prediction,
          provenance: {
            gate: 'fast',
            contractVersion: PREDICTION_CONTRACT_VERSION,
            gateVersion: fastDecision.gateVersion,
            mappingSource: prediction?.mappingSource,
            latencyMs,
            gateLatencyMs: fastGateLatencyMs
          },
          matchedGate: 'fast',
          fastDecision,
          latencyMs,
          fastGateLatencyMs,
          slowGateLatencyMs: undefined,
          timestamp
        };
      }
    }

    // 2. Fast Gate Miss (or disabled): Invoke Slow Gate
    let slowResult: SlowGateResult | undefined;

    if (this.enableSlowGate && this.slowGate) {
      const slowStart = performance.now();
      try {
        const shape = context.tensorShape ?? [1, 8, 18];
        slowResult = await this.slowGate.infer({
          sequence: context.microTensorSequence,
          shape,
          context: context.uiContext
        });
      } catch (err) {
        console.error('[AdaptiveInferenceEngine] Slow Gate inference error:', err);
      }
      slowGateLatencyMs = performance.now() - slowStart;

      if (slowResult?.intervention && slowResult.intervention.type !== 'no_op') {
        const latencyMs = performance.now() - startTime;
        const prediction = this.stamp(slowResult.prediction, timestamp, contextTarget);
        return {
          intervention: slowResult.intervention,
          prediction,
          provenance: {
            gate: 'slow',
            contractVersion: PREDICTION_CONTRACT_VERSION,
            gateVersion: slowResult.gateVersion,
            mappingSource: prediction?.mappingSource ?? slowResult.mappingSource,
            latencyMs,
            gateLatencyMs: slowGateLatencyMs
          },
          matchedGate: 'slow',
          fastDecision,
          slowResult,
          latencyMs,
          fastGateLatencyMs,
          slowGateLatencyMs,
          timestamp
        };
      }
    }

    // 3. No intervention matched by either gate. The prediction is still reported when a
    // gate produced one, so "predicted, no adaptation" stays distinguishable from
    // "no prediction" in the trace.
    const selected = selectPrediction(fastDecision.prediction, slowResult?.prediction);
    const latencyMs = performance.now() - startTime;
    return {
      prediction: this.stamp(selected, timestamp, contextTarget),
      provenance: {
        gate: selected?.source ?? 'none',
        contractVersion: PREDICTION_CONTRACT_VERSION,
        gateVersion: selected?.source === 'slow' ? slowResult?.gateVersion : fastDecision.gateVersion,
        mappingSource: selected?.mappingSource,
        latencyMs,
        gateLatencyMs: selected?.source === 'slow' ? slowGateLatencyMs : fastGateLatencyMs
      },
      matchedGate: 'none',
      fastDecision,
      slowResult,
      latencyMs,
      fastGateLatencyMs,
      slowGateLatencyMs,
      timestamp
    };
  }

  /** Stamps a gate prediction, or returns undefined when the gate produced none. */
  private stamp(
    prediction: GatePrediction | undefined,
    timestamp: number,
    target: PredictionTarget
  ): PredictionResult | undefined {
    if (!prediction) return undefined;
    return stampPrediction(prediction, {
      predictionId: this.createPredictionId(),
      timestamp,
      target
    });
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
 * Chooses the prediction the decision is made on.
 *
 * A matched Slow Gate prediction wins over a matched Fast one only when the Fast Gate did
 * not short-circuit, which by construction means its match was not actionable. An
 * unmatched prediction is still returned when neither gate asserted one, so the trace can
 * show what was inferred.
 */
function selectPrediction(
  fast: GatePrediction | undefined,
  slow: GatePrediction | undefined
): GatePrediction | undefined {
  if (slow?.matched) return slow;
  if (fast?.matched) return fast;
  return slow ?? fast;
}

/** Projects the evaluated UI context onto the prediction's target reference. */
function predictionTargetFrom(context: UIContext): PredictionTarget {
  const target: PredictionTarget = {};
  if (context.route) target.route = context.route;
  if (context.taskId) target.taskId = context.taskId;
  if (context.taskStepId) target.taskStepId = context.taskStepId;
  if (context.activeComponentId) target.componentId = context.activeComponentId;
  return target;
}

/**
 * Factory helper creating configured AdaptiveInferenceEngine instance.
 */
export function createAdaptiveInferenceEngine(
  options?: AdaptiveInferenceEngineOptions
): AdaptiveInferenceEngine {
  return new AdaptiveInferenceEngine(options);
}
