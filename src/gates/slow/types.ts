/**
 * Slow Gate Interface & Inference Contracts
 * Implements Stage 7.2 specifications from docs/testbed/prd.md Section 20 & docs/plan/tasks/7.2.md.
 * Ingests (1, 8, 18) MicroTensor sequences and UIContext to produce probabilistic outcome predictions
 * and candidate UI intervention commands.
 */

import { UIContext } from '../../types/uiContext.js';
import { OutcomeType } from '../../telemetry/events';
import { InterventionCommand } from '../../intervention/types';

export interface SlowGateInput {
  sequence: Float32Array;
  shape: [number, number, number];
  context: UIContext;
}

export type SlowGateMappingSource = 'learned_head' | 'deterministic_mapping';

export interface SlowGateResult {
  outcome?: OutcomeType;
  intervention?: InterventionCommand;
  probabilities?: Float32Array;
  confidence?: number;
  /** Explicit intervention head probability distribution over the 5 target classes. */
  interventionProbabilities?: Float32Array;
  /** Confidence score of the top-ranked intervention class. */
  interventionConfidence?: number;
  /** Attribution of how candidate intervention was produced (ADR-006). */
  mappingSource?: SlowGateMappingSource;
  source: 'slow';
}

export interface SlowGate {
  infer(input: SlowGateInput): Promise<SlowGateResult>;
}
