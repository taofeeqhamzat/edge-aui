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
 * | 0     | route              | Stable index into ROUTE_VOCABULARY, normalized by route count     |
 * | 1     | primaryAction      | 1.0 when a primary action is available, else 0.0                 |
 * | 2     | helpAvailable      | 1.0 when contextual help/tooltip is available, else 0.0          |
 * | 3     | expandable         | 1.0 when an expandable/accordion surface is present, else 0.0    |
 * | 4     | taskProgress       | current step index / total steps (0.0 when no task is active)     |
 * | 5     | actionAvailability | available action count normalized by ACTION_VOCABULARY size       |
 *
 * All components are bounded in [0, 1] to match the MicroTensor normalization contract.
 * `CONTEXT_VECTOR_DIM` is asserted against the model-preparation `context_dim`.
 */

import { UIContext } from './uiContext.js';

export const CONTEXT_VECTOR_DIM = 6;

/** Route vocabulary shared with the target UI's `data-aui-route` values. */
export const ROUTE_VOCABULARY = [
  'Overview',
  'Analytics',
  'Reports',
  'Customers',
  'Settings'
] as const;

/** Action vocabulary from the semantic DOM annotation contract. */
export const ACTION_VOCABULARY = [
  'click',
  'change',
  'toggle',
  'hover',
  'select',
  'input',
  'focus'
] as const;

/** Total step count per task id, used for the task-progress component. */
export const TASK_STEP_COUNTS: Record<string, number> = {
  T1: 4,
  T2: 2,
  T3: 4
};

export interface ContextVectorOptions {
  /** Order of task steps used to derive progress; index within this list is used. */
  taskStepOrder?: string[];
}

/**
 * Encodes a `UIContext` snapshot into the 6-dimensional context vector expected by
 * the target intervention head. Deterministic and pure.
 */
export function encodeUIContext(context: UIContext): Float32Array {
  const vector = new Float32Array(CONTEXT_VECTOR_DIM);

  // 0. Route index, normalized by the vocabulary size.
  const routeIndex = ROUTE_VOCABULARY.indexOf(
    context.route as (typeof ROUTE_VOCABULARY)[number]
  );
  vector[0] = routeIndex >= 0 ? routeIndex / ROUTE_VOCABULARY.length : 0.0;

  // 1-3. Capability flags.
  vector[1] = context.primaryActionAvailable ? 1.0 : 0.0;
  vector[2] = context.helpAvailable ? 1.0 : 0.0;
  vector[3] = context.expandable ? 1.0 : 0.0;

  // 4. Task progress from the current step index.
  if (context.taskId && context.taskStepId) {
    const stepCount = TASK_STEP_COUNTS[context.taskId];
    if (stepCount && stepCount > 0) {
      const stepNumber = Number.parseInt(context.taskStepId.split('-').pop() ?? '', 10);
      if (Number.isFinite(stepNumber) && stepNumber > 0) {
        vector[4] = Math.min(1.0, (stepNumber - 1) / stepCount);
      }
    }
  }

  // 5. Breadth of currently available actions.
  const actionCount = new Set(context.availableActions ?? []).size;
  vector[5] = Math.min(1.0, actionCount / ACTION_VOCABULARY.length);

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
