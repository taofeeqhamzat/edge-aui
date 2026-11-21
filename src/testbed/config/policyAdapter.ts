/**
 * Testbed Policy Adapter (Tasks 20.1, 50.2, 60.1)
 *
 * The framework predicts an outcome; the *application* decides which outcome warrants
 * which UI adaptation. This module is that decision for the testbed, and it is the reason
 * the policy can be interface-agnostic: core holds no outcome→intervention table.
 *
 * Two separate decisions live here on purpose:
 *
 * 1. Which outcome warrants which adaptation (`TESTBED_OUTCOME_INTERVENTIONS`). This is a
 *    conservative policy choice, not evidence. An outcome absent from the table produces a
 *    recorded decision-only verdict, never an invented adaptation.
 * 2. Which element that adaptation is declared to act on. The target comes from
 *    configuration (`interventionTargets.ts`), or from the prediction when the outcome
 *    names an element, and never from "whatever component was active".
 *
 * The previous fallback to `context.activeComponentId` made the target depend on the last
 * hovered element, so a filter prediction could be applied to the results table. Workstream
 * 60 removed it: an adaptation with no resolvable target is a recorded failure.
 */

import { CandidateResolver } from '../../intervention/policy';
import { InterventionCommand, InterventionType, isInterventionType } from '../../intervention/types';
import { DEFAULT_OUTCOME_INTERVENTIONS } from '../../gates/slow/onnxSlowGate';
import { TESTBED_INTERVENTION_TARGETS } from './interventionTargets';
import { EXPERIMENTAL_TASKS, TaskId } from '../tasks/taskModel';
import type { UIContext } from '../../types/uiContext';

/**
 * Semantic outcome → adaptation map for the testbed.
 *
 * The Fast Gate predicts a semantic outcome (`open_filter_section`, `apply_filter`, …) and
 * the Slow Gate predicts either the foundation outcome classes or the semantic task-outcome
 * vocabulary, so the policy needs a decision for every outcome either gate can emit.
 */
export const TESTBED_SEMANTIC_OUTCOME_INTERVENTIONS: Readonly<
  Partial<Record<string, InterventionType>>
> = {
  open_filter_section: 'simplify_options',
  select_date_range: 'simplify_options',
  select_category: 'simplify_options',
  select_region: 'simplify_options',
  apply_filter: 'highlight_primary_action',
  select_report: 'expand_tooltip',
  export_report: 'highlight_primary_action',
  reset_filter: 'offer_assistance',
  backtrack: 'offer_assistance',
  inspect_help: 'expand_tooltip'
};

/**
 * Testbed outcome → adaptation map.
 *
 * Keys are the foundation outcome classes (the vocabulary the bundled graph emits), the
 * semantic outcomes the gates can predict, and — through `isInterventionType` — the legacy
 * intervention vocabulary a compatibility head emits. Values are declared system
 * adaptations, never user actions.
 */
export const TESTBED_OUTCOME_INTERVENTIONS: Readonly<
  Partial<Record<string, InterventionType>>
> = {
  ...DEFAULT_OUTCOME_INTERVENTIONS,
  ...TESTBED_SEMANTIC_OUTCOME_INTERVENTIONS
};

/**
 * Macro tokens that represent passive exploratory or hover events in the testbed.
 * These actions do NOT re-arm repeat suppression (`newActSinceAccept`).
 */
export const TESTBED_PASSIVE_ACTIONS: readonly string[] = [
  'HOVER_KPI',
  'HOVER_HELP',
  'IDLE_DWELL',
  'TABLE_ROW_SELECT',
  'hover'
];

/** Adaptations that change a specific element; `no_op` and the banner do not. */
function requiresTarget(type: InterventionType): boolean {
  return type !== 'no_op' && type !== 'offer_assistance';
}

/**
 * The target id an adaptation declares.
 *
 * Outcome-specific controls take priority (e.g. apply_filter -> btn-apply-filters,
 * export_report -> btn-export) so distinct actions are not confounded.
 */
function targetIdFor(
  type: InterventionType,
  prediction: Parameters<CandidateResolver['resolve']>[0]
): string | undefined {
  if (prediction.outcomeId === 'select_report') {
    return 'reports-header-action';
  }
  const configured = TESTBED_INTERVENTION_TARGETS[type];
  if (configured) return configured;
  if (type === 'expand_tooltip') return prediction.target?.componentId;
  return undefined;
}

function resolveTaskStepHint(context?: UIContext): string | undefined {
  if (!context?.taskId || !context?.taskStepId) return undefined;
  const task = EXPERIMENTAL_TASKS[context.taskId as TaskId];
  if (!task) return undefined;
  const step = task.steps.find((s) => s.stepId === context.taskStepId);
  return step?.description ? `Next step: ${step.description}` : undefined;
}

function buildCommand(
  type: InterventionType,
  targetComponentId: string | undefined,
  prediction: Parameters<CandidateResolver['resolve']>[0],
  customReason?: string
): InterventionCommand {
  return {
    type,
    source: prediction.source,
    confidence: prediction.confidence,
    issuedAt: prediction.timestamp,
    targetComponentId,
    mappingSource: prediction.mappingSource ?? 'deterministic_mapping',
    reason:
      customReason ??
      (type === 'offer_assistance'
        ? undefined
        : `Testbed mapping: outcome '${prediction.outcomeId}' -> ${type} (target: ${
            targetComponentId ?? 'global'
          })`)
  };
}

/**
 * Candidate resolver for the testbed.
 *
 * Order matters: the testbed's declared mapping wins, then the intervention vocabulary
 * itself (the legacy heads and declared Fast Gate patterns predict an intervention class),
 * and finally no candidate — which the policy records as a deliberate `no_op` rather than a
 * guessed adaptation. A mapped adaptation that cannot name its element is refused the same
 * way instead of being issued against a fallback target.
 */
export function createTestbedCandidateResolver(): CandidateResolver {
  return {
    resolve(prediction, context) {
      // 1. Navigation outcomes: if in an active task trial (context.taskId present),
      // offer assistance carrying the step hint; otherwise treat as nominal no-op.
      if (
        prediction.outcomeId === 'navigate_overview' ||
        prediction.outcomeId === 'navigate_analytics' ||
        prediction.outcomeId === 'navigate_reports'
      ) {
        const stepHint = resolveTaskStepHint(context);
        if (stepHint) {
          return buildCommand('offer_assistance', undefined, prediction, stepHint);
        }
        return null;
      }

      // 2. Filter reset or backtracking: provide contextual filter guidance tip.
      if (prediction.outcomeId === 'reset_filter' || prediction.outcomeId === 'backtrack') {
        return buildCommand(
          'offer_assistance',
          undefined,
          prediction,
          'Tip: Apply or Reset the filter to refine your report data.'
        );
      }

      // 3. General mapped adaptations
      const mapped =
        TESTBED_OUTCOME_INTERVENTIONS[prediction.outcomeId] ??
        (isInterventionType(prediction.outcomeId) ? prediction.outcomeId : undefined);
      if (!mapped) return null;

      const targetComponentId = targetIdFor(mapped, prediction);
      if (requiresTarget(mapped) && !targetComponentId) return null;

      return buildCommand(mapped, targetComponentId, prediction);
    }
  };
}
