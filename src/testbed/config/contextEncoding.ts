/**
 * Testbed Context Encoding Vocabulary (Task 20.2)
 *
 * The routes, actions and task geometry the testbed encodes into the R^6 context vector.
 * Framework core encodes whatever vocabulary it is handed; these names belong to the
 * testbed application, so they live here and are injected at the composition root.
 *
 * `TASK_STEP_COUNTS` must match `EXPERIMENTAL_TASKS` in `src/testbed/tasks/taskModel.ts`
 * (asserted by tests/context_vector.test.ts).
 */

import type { ContextEncodingConfig } from '../../types/contextVector';

export const TESTBED_CONTEXT_ENCODING_VERSION = 'R6-testbed/1.0.0';

/** Route vocabulary shared with the target UI's `data-aui-route` values. */
export const TESTBED_ROUTE_VOCABULARY = [
  'Overview',
  'Analytics',
  'Reports',
  'Customers',
  'Settings'
] as const;

/** Action vocabulary from the semantic DOM annotation contract. */
export const TESTBED_ACTION_VOCABULARY = [
  'click',
  'change',
  'toggle',
  'hover',
  'select',
  'input',
  'focus'
] as const;

/** Total step count per task id, used for the task-progress component. */
export const TASK_STEP_COUNTS: Readonly<Record<string, number>> = {
  TD1: 5,
  TD2: 5,
  TD3: 8,
  TD4: 4
};

export const TESTBED_CONTEXT_ENCODING_CONFIG: ContextEncodingConfig = {
  id: 'testbed',
  version: TESTBED_CONTEXT_ENCODING_VERSION,
  routeVocabulary: TESTBED_ROUTE_VOCABULARY,
  actionVocabulary: TESTBED_ACTION_VOCABULARY,
  taskStepCounts: TASK_STEP_COUNTS
};
