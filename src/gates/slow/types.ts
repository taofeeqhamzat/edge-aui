/**
 * Slow Gate Interface & Inference Contracts
 * Implements Stage 7.2 specifications from docs/testbed/prd.md Section 20 & docs/plan/tasks/7.2.md.
 * Ingests (1, 8, 18) MicroTensor sequences and UIContext to produce probabilistic outcome predictions
 * and candidate UI intervention commands.
 */

import { UIContext } from '../../types/uiContext.js';
import { OutcomeType } from '../../telemetry/events';
import { InterventionCommand } from '../../intervention/types';
import { GatePrediction } from '../contracts';

/**
 * Version of the generic foundation outcome vocabulary
 * (`NO_OUTCOME | CLICK | FORM_SUBMIT | BACKTRACK | RAPID_SCROLL | HOVER_DWELL | ABANDON`).
 *
 * The vocabulary itself is a model-manifest property (Task 20.3); this constant is the
 * identity of the built-in default that the bundled foundation graphs were trained on.
 */
export const FOUNDATION_OUTCOME_VOCABULARY_VERSION = 'foundation-7-class/1.0.0';

export interface SlowGateInput {
  sequence: Float32Array;
  shape: [number, number, number];
  context: UIContext;
}

export type SlowGateMappingSource = 'learned_head' | 'deterministic_mapping';

export interface SlowGateResult {
  outcome?: OutcomeType;
  /**
   * Candidate adaptation produced by the gate itself.
   *
   * Compatibility path only: an intervention is a *policy* output (Task 20.1). The gate
   * publishes `prediction`, and the policy resolves that outcome into a command through
   * the application's candidate resolver.
   */
  intervention?: InterventionCommand;
  /** Normalized prediction emitted for the inferred outcome. */
  prediction?: GatePrediction;
  probabilities?: Float32Array;
  confidence?: number;
  /** Explicit intervention head probability distribution over the 5 target classes. */
  interventionProbabilities?: Float32Array;
  /** Confidence score of the top-ranked intervention class. */
  interventionConfidence?: number;
  /** Attribution of how candidate intervention was produced (ADR-006). */
  mappingSource?: SlowGateMappingSource;
  /** Version of the outcome model/pattern set serving the prediction, for provenance. */
  gateVersion?: string;
  source: 'slow';
}

export interface SlowGate {
  infer(input: SlowGateInput): Promise<SlowGateResult>;
}
