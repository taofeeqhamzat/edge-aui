/**
 * UI Context Vector Encoding
 *
 * `model-preparation/src/training.py` declares `TargetInterventionHead(context_dim=6)`
 * and raises if the context tensor is absent. The runtime previously exposed
 * `UIContext` only as a TypeScript object with no numeric encoding, so the target head
 * had no computable input (assessment §15).
 *
 * This module defines the canonical, documented encoding from `UIContext` to `R^6`.
 *
 * | Index | Field              | Encoding                                                        |
 * |-------|--------------------|-----------------------------------------------------------------|
 * | 0     | route              | Stable index into the configured route vocabulary, / vocabulary   |
 * | 1     | primaryAction      | 1.0 when a primary action is available, else 0.0                 |
 * | 2     | helpAvailable      | 1.0 when contextual help/tooltip is available, else 0.0          |
 * | 3     | expandable         | 1.0 when an expandable/accordion surface is present, else 0.0    |
 * | 4     | taskProgress       | current step index / configured total steps (0.0 when inactive)   |
 * | 5     | actionAvailability | available action count normalized by the configured action count  |
 *
 * All components are bounded in [0, 1] to match the MicroTensor normalization contract.
 * `CONTEXT_VECTOR_DIM` is asserted against the model-preparation `context_dim`.
 *
 * The route, action and task vocabularies are application vocabulary (Task 20.2). The
 * framework encodes whatever vocabulary it is given and holds no route names or task ids of
 * its own; the testbed supplies its own in `src/testbed/config/contextEncoding.ts`.
 */

import { UIContext } from './uiContext.js';

export const CONTEXT_VECTOR_DIM = 6;

/**
 * Application-supplied vocabulary and task geometry for the context encoding.
 *
 * `version` is recorded with the prediction so a re-encoded context is distinguishable
 * from a re-trained head.
 */
export interface ContextEncodingConfig {
  /** Identity of this encoding configuration. */
  id: string;
  /** Version of the vocabulary; travels with the prediction. */
  version: string;
  /** Ordered route vocabulary; the index is normalized by its length. */
  routeVocabulary: readonly string[];
  /** Ordered action vocabulary; used to normalize action breadth. */
  actionVocabulary: readonly string[];
  /** Total step count per task id, used for the task-progress component. */
  taskStepCounts: Readonly<Record<string, number>>;
}

/**
 * Encoding used when an application supplies none.
 *
 * It declares the generic annotation action vocabulary — part of the semantic annotation
 * contract, not application vocabulary — and no routes or tasks, so every route and task
 * component encodes to 0 rather than to a guessed index.
 */
export const DEFAULT_CONTEXT_ENCODING_CONFIG: ContextEncodingConfig = {
  id: 'annotation-default',
  version: '1.0.0',
  routeVocabulary: [],
  actionVocabulary: ['click', 'change', 'toggle', 'hover', 'select', 'input', 'focus'],
  taskStepCounts: {}
};

/**
 * Encodes a `UIContext` snapshot into the 6-dimensional context vector expected by
 * the target intervention head. Deterministic and pure.
 */
export function encodeUIContext(
  context: UIContext,
  config: ContextEncodingConfig = DEFAULT_CONTEXT_ENCODING_CONFIG
): Float32Array {
  const vector = new Float32Array(CONTEXT_VECTOR_DIM);

  // 0. Route index, normalized by the vocabulary size.
  const routeIndex = config.routeVocabulary.indexOf(context.route);
  vector[0] =
    routeIndex >= 0 && config.routeVocabulary.length > 0
      ? routeIndex / config.routeVocabulary.length
      : 0.0;

  // 1-3. Capability flags.
  vector[1] = context.primaryActionAvailable ? 1.0 : 0.0;
  vector[2] = context.helpAvailable ? 1.0 : 0.0;
  vector[3] = context.expandable ? 1.0 : 0.0;

  // 4. Task progress from the current step index.
  if (context.taskId && context.taskStepId) {
    const stepCount = config.taskStepCounts[context.taskId];
    if (stepCount && stepCount > 0) {
      const stepNumber = Number.parseInt(context.taskStepId.split('-').pop() ?? '', 10);
      if (Number.isFinite(stepNumber) && stepNumber > 0) {
        vector[4] = Math.min(1.0, (stepNumber - 1) / stepCount);
      }
    }
  }

  // 5. Breadth of currently available actions.
  const actionCount = new Set(context.availableActions ?? []).size;
  vector[5] =
    config.actionVocabulary.length > 0
      ? Math.min(1.0, actionCount / config.actionVocabulary.length)
      : 0.0;

  return vector;
}

/**
 * Validates that an encoded vector satisfies the target head's contract.
 */
export function validateContextVector(vector: Float32Array): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (vector.length !== CONTEXT_VECTOR_DIM) {
    errors.push(
      `Context vector must have ${CONTEXT_VECTOR_DIM} elements, received ${vector.length}`
    );
  }
  for (let i = 0; i < vector.length; i++) {
    if (!Number.isFinite(vector[i])) {
      errors.push(`Context vector element ${i} is not finite: ${vector[i]}`);
    } else if (vector[i] < 0.0 || vector[i] > 1.0) {
      errors.push(`Context vector element ${i} out of [0, 1] bounds: ${vector[i]}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
