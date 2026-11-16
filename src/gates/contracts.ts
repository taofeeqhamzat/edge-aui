/**
 * Normalized Prediction Contract (Task 20.1)
 *
 * The framework is interface-agnostic: it predicts an *outcome identifier string* that the
 * application supplies through configuration. Core code never requires a particular
 * outcome ID, so the same gate code serves a testbed, an onboarding flow or a checkout.
 *
 * Two layers exist on purpose:
 *
 * - `GatePrediction` is what a gate emits. A gate knows the outcome and its confidence;
 *   it does not know the session clock, the trace identity, or the UI context of the
 *   window being evaluated.
 * - `PredictionResult` is the normalized, identity-stamped record that arbitration emits
 *   and the policy consumes. It adds a stable `predictionId`, the canonical `timestamp`,
 *   the contract version and the resolved target/context reference.
 *
 * `InterventionCommand` remains the actuation contract. A gate no longer decides a UI
 * adaptation: it predicts an outcome, and the policy turns that outcome into a candidate
 * command through an application-supplied resolver (see `intervention/policy.ts`).
 */

import type { InterventionMappingSource } from '../intervention/types';
import { INTERVENTION_SCHEMA_VERSION } from '../intervention/types';

/** Version of this normalized contract. Bumped when a required field changes meaning. */
export const PREDICTION_CONTRACT_VERSION = '1.0.0';

/**
 * Vocabulary version reported by a prediction whose outcome ID comes from the legacy
 * intervention vocabulary (a predicted intervention class treated as an outcome).
 */
export const INTERVENTION_OUTCOME_VOCABULARY_VERSION = INTERVENTION_SCHEMA_VERSION;

export type PredictionSource = 'fast' | 'slow';

/** Reference to the UI context a prediction was computed against. */
export interface PredictionTarget {
  /** Annotation ID of the component in focus when the window was evaluated. */
  componentId?: string;
  route?: string;
  taskId?: string;
  taskStepId?: string;
}

/** What a gate emits. Deliberately free of trace identity. */
export interface GatePrediction {
  /** Application-supplied outcome identifier. Core assigns no meaning to the value. */
  outcomeId: string;
  /** Identity of the vocabulary `outcomeId` belongs to, so a renamed class is visible. */
  vocabularyVersion: string;
  /** Class index within the configured vocabulary, when the gate knows it. */
  outcomeIndex?: number;
  /** Confidence or match strength in [0, 1]. */
  confidence: number;
  /** Whether the gate asserts this prediction (a pattern matched / an outcome was inferred). */
  matched: boolean;
  source: PredictionSource;
  /** Model artifact version serving the prediction, when known. */
  modelVersion?: string;
  /** How the outcome was produced, carried through so the trace can attribute it. */
  mappingSource?: InterventionMappingSource;
  /** Target/context reference as far as the gate knows it (arbitration merges it). */
  target?: PredictionTarget;
}

/** The normalized record arbitration emits and the policy consumes. */
export interface PredictionResult extends GatePrediction {
  predictionId: string;
  /** Canonical trace clock: epoch milliseconds, shared with behaviour/task events. */
  timestamp: number;
  contractVersion: string;
}

/** Values arbitration supplies when it promotes a `GatePrediction` to a `PredictionResult`. */
export interface PredictionStamp {
  predictionId: string;
  timestamp: number;
  /** UI context of the evaluated window; per-prediction target fields win over it. */
  target?: PredictionTarget;
}

/**
 * Promotes a gate prediction to the normalized record. Pure: the same gate prediction and
 * stamp always produce the same result.
 */
export function stampPrediction(
  prediction: GatePrediction,
  stamp: PredictionStamp
): PredictionResult {
  return {
    ...prediction,
    predictionId: stamp.predictionId,
    timestamp: stamp.timestamp,
    contractVersion: PREDICTION_CONTRACT_VERSION,
    target: { ...stamp.target, ...prediction.target }
  };
}

/**
 * Monotonic prediction identity.
 *
 * Arbitration is the single producer of normalized predictions, so identity is issued in
 * one place. The runtime reuses `result.prediction.predictionId` when it records the trace
 * event, which is what keeps the trace id and the prediction id the same value (F-05).
 */
let predictionSequence = 0;

export function nextPredictionId(): string {
  predictionSequence += 1;
  return `pred_${predictionSequence}`;
}

/** Test seam: restores the identity sequence between tests. */
export function resetPredictionIdSequence(): void {
  predictionSequence = 0;
}

/**
 * Lineage of one arbitration decision, preserved separately from the prediction itself so
 * that "which gate decided, with which mapping, how fast" stays answerable even when the
 * outcome vocabulary changes.
 */
export interface PredictionProvenance {
  gate: PredictionSource | 'none';
  contractVersion: string;
  /** Version of the pattern set or model that served the selected prediction. */
  gateVersion?: string;
  mappingSource?: InterventionMappingSource;
  latencyMs: number;
  /** Latency of the gate that produced the selected prediction, when one ran. */
  gateLatencyMs?: number;
}

/**
 * Index and value of the largest entry in a probability/logit vector.
 *
 * Both slow gate implementations need this, and two copies of the loop used to exist: the
 * one that returns a class name and the one that returns an intervention type. The loop is
 * the same decision, so it lives in one place.
 */
export function argmax(probabilities: ArrayLike<number>): {
  index: number;
  confidence: number;
} {
  let index = 0;
  let confidence = -Infinity;
  for (let i = 0; i < probabilities.length; i++) {
    if (probabilities[i] > confidence) {
      confidence = probabilities[i];
      index = i;
    }
  }
  return { index, confidence };
}
