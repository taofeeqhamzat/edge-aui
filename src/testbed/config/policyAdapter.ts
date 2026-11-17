/**
 * Testbed Policy Adapter (Task 20.1)
 *
 * The framework predicts an outcome; the *application* decides which outcome warrants
 * which UI adaptation. This module is that decision for the testbed, and it is the reason
 * the policy can be interface-agnostic: core holds no outcome→intervention table.
 *
 * The table it starts from is the legacy outcome→intervention mapping the bundled
 * foundation graph was diagnosed against. It is a compatibility mapping, not a semantic
 * one: the semantic outcome vocabulary arrives in Task 20.4 and replaces these keys.
 */

import { CandidateResolver, createDefaultCandidateResolver } from '../../intervention/policy';
import { InterventionCommand, InterventionType, isInterventionType } from '../../intervention/types';
import { DEFAULT_OUTCOME_INTERVENTIONS } from '../../gates/slow/onnxSlowGate';

/**
 * Testbed outcome → adaptation map.
 *
 * Keys are the foundation outcome classes (the vocabulary the bundled INT8 graph emits).
 * Values are declared system adaptations, never user actions.
 */
export const TESTBED_OUTCOME_INTERVENTIONS: Readonly<
  Partial<Record<string, InterventionType>>
> = {
  ...DEFAULT_OUTCOME_INTERVENTIONS
};

function buildCommand(
  type: InterventionType,
  prediction: Parameters<CandidateResolver['resolve']>[0],
  context: Parameters<CandidateResolver['resolve']>[1]
): InterventionCommand {
  return {
    type,
    source: prediction.source,
    confidence: prediction.confidence,
    issuedAt: prediction.timestamp,
    targetComponentId: prediction.target?.componentId ?? context.activeComponentId,
    mappingSource: prediction.mappingSource ?? 'deterministic_mapping',
    reason: `Testbed mapping: outcome '${prediction.outcomeId}' -> ${type}`
  };
}

/**
 * Candidate resolver for the testbed.
 *
 * Order matters: the testbed's declared semantic mapping wins, then the intervention
 * vocabulary itself (the legacy heads and declared Fast Gate patterns predict an
 * intervention class), and finally no candidate — which the policy records as a deliberate
 * `no_op` rather than a guessed adaptation.
 */
export function createTestbedCandidateResolver(): CandidateResolver {
  const fallback = createDefaultCandidateResolver();

  return {
    resolve(prediction, context) {
      const mapped = TESTBED_OUTCOME_INTERVENTIONS[prediction.outcomeId];
      if (mapped) {
        return buildCommand(mapped, prediction, context);
      }
      if (isInterventionType(prediction.outcomeId)) {
        return fallback.resolve(prediction, context);
      }
      return null;
    }
  };
}
