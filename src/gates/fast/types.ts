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
}

export interface FastGate {
  evaluate(sequence: MacroInteraction[]): Promise<GateDecision>;
}
