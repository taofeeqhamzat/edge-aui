/**
 * Fast Gate Interface & Decision Contracts
 * Implements Stage 7.1 specifications from docs/testbed/prd.md Section 18 & docs/plan/tasks/7.1.md.
 * Evaluates semantic macro interaction sequences against mined prefix patterns (or deterministic rules).
 */

import { MacroInteraction } from '../../telemetry/events';
import { InterventionCommand } from '../../intervention/types';

export interface GateDecision {
  matched: boolean;
  intervention?: InterventionCommand;
  source: 'fast';
  confidence?: number;
  matchedPattern?: string[];
}

export interface FastGate {
  evaluate(sequence: MacroInteraction[]): Promise<GateDecision>;
}
