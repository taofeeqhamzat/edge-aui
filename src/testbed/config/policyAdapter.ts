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
 * Semantic outcome → adaptation map for the testbed (Task 50.2).
 *
 * The Fast Gate now predicts a semantic outcome (`open_filter_section`, `apply_filter`, …)
 * rather than an intervention class, so the policy needs a decision for that vocabulary.
 * This table is a **policy choice**, not evidence: it says which outcomes the testbed chooses
 * to adapt to. Outcomes absent from it produce a recorded decision-only verdict rather than
 * an invented adaptation — closing a filter, resetting filters and navigating are recognised
 * but never adapted.
 *
 * The adaptations mirror the intent of the legacy per-pattern table: the filter surface is
 * the heavy one, so its selection steps simplify the options, while committing a filter or a
 * report highlights the primary action.
 */
export const TESTBED_SEMANTIC_OUTCOME_INTERVENTIONS: Readonly<
  Partial<Record<string, InterventionType>>
> = {
  open_filter_section: 'simplify_options',
  select_date_range: 'simplify_options',
  select_category: 'simplify_options',
  apply_filter: 'highlight_primary_action',
  select_report: 'highlight_primary_action',
  export_report: 'highlight_primary_action'
};

/**
 * Testbed outcome → adaptation map.
 *
 * Keys are the foundation outcome classes (the vocabulary the bundled INT8 graph emits)
 * plus the semantic outcomes the Fast Gate can predict (Task 50.2). Values are declared
 * system adaptations, never user actions.
 */
export const TESTBED_OUTCOME_INTERVENTIONS: Readonly<
  Partial<Record<string, InterventionType>>
> = {
  ...DEFAULT_OUTCOME_INTERVENTIONS,
  ...TESTBED_SEMANTIC_OUTCOME_INTERVENTIONS
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
