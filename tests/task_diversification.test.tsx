import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { taskManager, TaskLifecycleEvent } from '../src/testbed/tasks/taskManager';
import {
  INITIAL_TASK_EVIDENCE,
  INITIAL_TASK_UI_STATE,
  TaskEvidence,
  TaskUiState
} from '../src/testbed/tasks/taskModel';
import { evaluateTaskCompletion } from '../src/testbed/tasks/completion';

const ui = (patch: Partial<TaskUiState>): TaskUiState => ({
  ...INITIAL_TASK_UI_STATE,
  appliedFilters: { dateFrom: '', region: 'All', categories: [] },
  ...patch
});

const evidence = (patch: Partial<TaskEvidence>): TaskEvidence => ({
  ...INITIAL_TASK_EVIDENCE,
  ...patch
});

describe('State-verified completion predicates', () => {
  it('TD1 requires Europe, 18 rows, and an export action', () => {
    const state = ui({
      page: 'Analytics',
      appliedFilters: { dateFrom: '', region: 'Europe', categories: [] },
      visibleRowCount: 18
    });

    expect(evaluateTaskCompletion('TD1', state, evidence({ exportRecorded: true }))).toBe(true);
    expect(evaluateTaskCompletion('TD1', state, evidence({ exportRecorded: false }))).toBe(false);
    expect(
      evaluateTaskCompletion(
        'TD1',
        { ...state, appliedFilters: { dateFrom: '', region: 'All', categories: [] } },
        evidence({ exportRecorded: true })
      )
    ).toBe(false);
  });

  it('TD2 requires the exact date and category state with five rows', () => {
    const state = ui({
      page: 'Analytics',
      appliedFilters: { dateFrom: '2025-06-01', region: 'All', categories: ['Books'] },
      visibleRowCount: 5
    });

    expect(evaluateTaskCompletion('TD2', state, evidence({ applyRecorded: true }))).toBe(true);
    expect(
      evaluateTaskCompletion(
        'TD2',
        { ...state, appliedFilters: { ...state.appliedFilters, categories: ['Books', 'Clothing'] } },
        evidence({ applyRecorded: true })
      )
    ).toBe(false);
  });

  it('TD3 requires an observed empty state, a reset, and the 50-row state', () => {
    const restored = ui({ page: 'Analytics', visibleRowCount: 50 });

    expect(
      evaluateTaskCompletion('TD3', restored, evidence({ sawEmptyResult: true, resetRecorded: true }))
    ).toBe(true);
    expect(
      evaluateTaskCompletion('TD3', restored, evidence({ sawEmptyResult: false, resetRecorded: true }))
    ).toBe(false);
    expect(
      evaluateTaskCompletion(
        'TD3',
        { ...restored, visibleRowCount: 6 },
        evidence({ sawEmptyResult: true, resetRecorded: true })
      )
    ).toBe(false);
  });

  it('TD3 rejects a restored row count when any filter is still non-default', () => {
    const restored = ui({ page: 'Analytics', visibleRowCount: 50 });
    const evidenceState = evidence({ sawEmptyResult: true, resetRecorded: true });

    expect(
      evaluateTaskCompletion(
        'TD3',
        { ...restored, appliedFilters: { dateFrom: '2025-01-01', region: 'All', categories: [] } },
        evidenceState
      )
    ).toBe(false);
    expect(
      evaluateTaskCompletion(
        'TD3',
        { ...restored, appliedFilters: { dateFrom: '', region: 'Europe', categories: [] } },
        evidenceState
      )
    ).toBe(false);
    expect(
      evaluateTaskCompletion(
        'TD3',
        { ...restored, appliedFilters: { dateFrom: '', region: 'All', categories: ['Books'] } },
        evidenceState
      )
    ).toBe(false);
  });

  it('TD4 requires both reports, Europe Books, six rows, and export', () => {
    const state = ui({
      page: 'Analytics',
      appliedFilters: { dateFrom: '', region: 'Europe', categories: ['Books'] },
      visibleRowCount: 6,
      currentReportId: 'eu-books',
      visitedReportIds: ['eu-electronics', 'eu-books']
    });

    expect(evaluateTaskCompletion('TD4', state, evidence({ exportRecorded: true }))).toBe(true);
    expect(
      evaluateTaskCompletion(
        'TD4',
        { ...state, visitedReportIds: ['eu-books'] },
        evidence({ exportRecorded: true })
      )
    ).toBe(false);
  });
});

describe('Task lifecycle, timeout, and canonical interactions', () => {
  let lifecycle: TaskLifecycleEvent[];

  beforeEach(() => {
    taskManager.resetTask();
    lifecycle = [];
    taskManager.onLifecycle((event) => lifecycle.push(event));
  });

  afterEach(() => {
    taskManager.resetTask();
    vi.useRealTimers();
  });

  it('fails with task_fail/Failed when the timeout expires', () => {
    vi.useFakeTimers();
    taskManager.startTask('TD1');

    vi.advanceTimersByTime(120_001);

    expect(taskManager.getState().status).toBe('Failed');
    expect(taskManager.getState().failureReason).toBe('timeout');
    expect(lifecycle.some((event) => event.type === 'task_fail' && event.reason === 'timeout')).toBe(true);
  });

  it('completes TD3 after the empty state and a reset restore the full table', () => {
    taskManager.startTask('TD3');

    taskManager.recordInteraction('btn-apply-filters', 'click');
    taskManager.updateUiState({
      page: 'Analytics',
      appliedFilters: { dateFrom: '2025-09-01', region: 'Europe', categories: ['Books'] },
      visibleRowCount: 0,
      empty: true,
      currentReportId: null,
      visitedReportIds: []
    });

    expect(taskManager.getState().status).toBe('In Progress');
    taskManager.recordInteraction('btn-reset-filters', 'click');
    taskManager.updateUiState({
      page: 'Analytics',
      appliedFilters: { dateFrom: '', region: 'All', categories: [] },
      visibleRowCount: 50,
      empty: false,
      currentReportId: null,
      visitedReportIds: []
    });

    expect(taskManager.getState().status).toBe('Completed');
  });

  it('ignores companion click/input events for a checkbox change', () => {
    taskManager.startTask('TD2');

    taskManager.recordInteraction('filter-category-books', 'click');
    taskManager.recordInteraction('filter-category-books', 'input');
    taskManager.recordInteraction('filter-category-books', 'change');

    expect(taskManager.getState().errors).toBe(0);
    expect(taskManager.getState().completedSteps).toContain('TD2-4');
  });

  it('ignores the form submit companion after the Apply click', () => {
    taskManager.startTask('TD1');
    taskManager.updateUiState({
      page: 'Analytics',
      appliedFilters: { dateFrom: '', region: 'Europe', categories: [] },
      visibleRowCount: 18,
      empty: false,
      currentReportId: null,
      visitedReportIds: []
    });

    taskManager.recordInteraction('btn-apply-filters', 'click');
    taskManager.recordInteraction('filter-drawer', 'submit');
    taskManager.recordInteraction('btn-export', 'click');

    expect(taskManager.getState().errors).toBe(0);
    expect(taskManager.getState().status).toBe('Completed');
  });

  it('records Apply from a form submit even without a button click', () => {
    taskManager.startTask('TD1');
    taskManager.updateUiState({
      page: 'Analytics',
      appliedFilters: { dateFrom: '', region: 'Europe', categories: [] },
      visibleRowCount: 18,
      empty: false,
      currentReportId: null,
      visitedReportIds: []
    });
    taskManager.recordInteraction('filter-drawer', 'submit');
    taskManager.recordInteraction('btn-export', 'click');

    expect(taskManager.getState().status).toBe('Completed');
    expect(taskManager.getState().errors).toBe(0);
  });

  it('treats a submit companion on a click target as benign', () => {
    taskManager.startTask('TD1');
    taskManager.recordInteraction('nav-Analytics', 'submit');

    expect(taskManager.getState().errors).toBe(0);
    expect(taskManager.getState().completedSteps).not.toContain('TD1-1');
  });

  it('does not count an empty state observed before Apply as TD3 recovery evidence', () => {
    taskManager.startTask('TD3');
    taskManager.updateUiState({
      page: 'Analytics',
      appliedFilters: { dateFrom: '2025-09-01', region: 'Europe', categories: ['Books'] },
      visibleRowCount: 0,
      empty: true,
      currentReportId: null,
      visitedReportIds: []
    });
    taskManager.updateUiState({
      page: 'Analytics',
      appliedFilters: { dateFrom: '', region: 'All', categories: [] },
      visibleRowCount: 50,
      empty: false,
      currentReportId: null,
      visitedReportIds: []
    });
    taskManager.recordInteraction('btn-apply-filters', 'click');
    taskManager.recordInteraction('btn-reset-filters', 'click');

    expect(taskManager.getState().status).toBe('In Progress');
  });

  it('does not treat a non-Apply interaction as apply evidence', () => {
    taskManager.startTask('TD2');
    taskManager.updateUiState({
      page: 'Analytics',
      appliedFilters: { dateFrom: '2025-06-01', region: 'All', categories: ['Books'] },
      visibleRowCount: 5,
      empty: false,
      currentReportId: null,
      visitedReportIds: []
    });
    taskManager.recordInteraction('filter-Region-select', 'change');

    expect(taskManager.getState().status).toBe('In Progress');
  });

  it('records a completed task duration and terminal step', () => {
    taskManager.startTask('TD1');
    taskManager.updateUiState({
      page: 'Analytics',
      appliedFilters: { dateFrom: '', region: 'Europe', categories: [] },
      visibleRowCount: 18,
      empty: false,
      currentReportId: null,
      visitedReportIds: []
    });
    taskManager.recordInteraction('btn-apply-filters', 'click');
    taskManager.recordInteraction('btn-export', 'click');

    const complete = lifecycle.find((event) => event.type === 'task_complete');
    const state = taskManager.getState();
    expect(complete?.taskStepId).toBe('TD1-5');
    expect(complete?.durationMs).toBe((state.endTime ?? 0) - (state.startTime ?? 0));
  });

  it('resets a completed trial without reporting an abandonment', () => {
    taskManager.startTask('TD2');
    taskManager.updateUiState({
      page: 'Analytics',
      appliedFilters: { dateFrom: '2025-06-01', region: 'All', categories: ['Books'] },
      visibleRowCount: 5,
      empty: false,
      currentReportId: null,
      visitedReportIds: []
    });
    taskManager.recordInteraction('btn-apply-filters', 'click');
    expect(taskManager.getState().status).toBe('Completed');
    lifecycle.length = 0;

    taskManager.resetTask();

    expect(lifecycle.some((event) => event.type === 'task_abandon')).toBe(false);
    expect(taskManager.getState().status).toBe('Idle');
  });

  it('records a replaced trial when a new task starts mid-trial', () => {
    taskManager.startTask('TD1');
    taskManager.startTask('TD2');

    expect(lifecycle.some((event) => event.type === 'task_abandon' && event.reason === 'replaced')).toBe(true);
    expect(taskManager.getState().currentTaskId).toBe('TD2');
    expect(taskManager.getState().status).toBe('In Progress');
  });

  it('counts a wrong action on a required control as a task error', () => {
    taskManager.startTask('TD1');
    taskManager.recordInteraction('filter-Region-select', 'submit');

    expect(taskManager.getState().errors).toBe(1);
    expect(taskManager.getState().status).toBe('In Progress');
  });

  it('clears the timeout when a trial is reset', () => {
    vi.useFakeTimers();
    taskManager.startTask('TD1');
    taskManager.resetTask();

    vi.advanceTimersByTime(200_000);

    expect(taskManager.getState().status).toBe('Idle');
    expect(lifecycle.some((event) => event.type === 'task_fail')).toBe(false);
  });
});
