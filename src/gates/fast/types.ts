/**
 * Fast Gate Interface & Decision Contracts
 * Implements Stage 7.1 specifications from docs/testbed/prd.md Section 18 & docs/plan/tasks/7.1.md.
 * Evaluates semantic macro interaction sequences against mined prefix patterns (or deterministic rules).
 */

import { MacroInteraction } from '../../telemetry/events';
import { InterventionCommand } from '../../intervention/types';
import { GatePrediction } from '../contracts';

export type {
  PatternOutcomeMapping,
  PatternTarget,
  PatternTarget as PatternIntervention
} from './patternTarget';
export { isPatternOutcomeMapping, resolvePatternTarget } from './patternTarget';

/**
 * Why a Fast Gate evaluation produced no match.
 *
 * A miss is a result, not an absence: "the miner found nothing frequent", "the pattern has
 * no declared target" and "mining timed out" call for different responses from a researcher,
 * and a bare `matched: false` cannot tell them apart.
 */
export type FastGateNoMatchReason =
  | 'empty_sequence'
  | 'miner_unavailable'
  | 'mining_timeout'
  | 'mining_failed'
  | 'no_frequent_pattern'
  | 'no_actionable_pattern'
  | 'no_declared_target'
  | 'no_matching_pattern';

export interface GateDecision {
  matched: boolean;
  /**
   * Candidate adaptation produced by the gate itself.
   *
   * Compatibility path only: an intervention is a *policy* output (Task 20.1). Gates
   * publish `prediction`, and `intervention/policy.ts` resolves that outcome into a
   * command through the application's candidate resolver.
   */
  intervention?: InterventionCommand;
  /** Normalized prediction emitted when a pattern matched. */
  prediction?: GatePrediction;
  source: 'fast';
  confidence?: number;
  matchedPattern?: string[];
  /** Version of the pattern set that produced a match, for provenance. */
  gateVersion?: string;
  /** Present exactly when `matched` is false: why no pattern was selected. */
  reason?: FastGateNoMatchReason;
}

export interface FastGate {
  evaluate(sequence: MacroInteraction[]): Promise<GateDecision>;
}
