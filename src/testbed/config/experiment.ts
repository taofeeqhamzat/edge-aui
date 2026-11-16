/**
 * Testbed Experiment Configuration (Task 20.2)
 *
 * Trial order and per-task timeouts belong to the study the testbed runs, not to the
 * framework. Framework defaults are empty, so a deployment that forgets to declare them
 * runs no trial rather than silently running the testbed's schedule.
 */

/** Order in which the study presents its tasks. */
export const TESTBED_TRIAL_ORDER: string[] = ['TD1', 'TD2', 'TD3', 'TD4'];

/** Per-task time limit, in milliseconds. TD3/TD4 carry more steps. */
export const TESTBED_TASK_TIMEOUTS_MS: Record<string, number> = {
  TD1: 120_000,
  TD2: 120_000,
  TD3: 150_000,
  TD4: 150_000
};

export const TESTBED_EXPERIMENT_CONFIG = {
  trialOrder: TESTBED_TRIAL_ORDER,
  taskTimeoutsMs: TESTBED_TASK_TIMEOUTS_MS
};
