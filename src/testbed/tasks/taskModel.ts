import type { Page } from '../../app/Navigation';
import { DEFAULT_RUNTIME_CONFIG } from '../../config/runtimeConfig';

export type TaskId = 'TD1' | 'TD2' | 'TD3' | 'TD4';
export type TaskStatus = 'Idle' | 'In Progress' | 'Completed' | 'Abandoned' | 'Failed';

/** Why a trial ended without completing. Timeout is a failure, not abandonment. */
export type AbandonmentReason = 'reset' | 'replaced' | 'condition_change' | 'interrupted';
export type TaskFailureReason = 'timeout';

export type CompletionId =
  | 'td1-region-export'
  | 'td2-date-category'
  | 'td3-empty-recovery'
  | 'td4-report-comparison';

export interface TargetTaskStep {
  stepId: string;
  description: string;
  expectedComponentId?: string;
  expectedAction?: string;
}

export interface TargetTask {
  id: TaskId;
  name: string;
  description: string;
  startingPage: Page;
  definitionVersion: 'TD-v2';
  timeoutMs: number;
  completionId: CompletionId;
  steps: TargetTaskStep[];
}

/**
 * Narrow UI state used by the testbed's completion predicates.
 *
 * Deliberately excludes free-text field values. All fields are enumerated state or a count.
 */
export interface TaskUiState {
  page: Page;
  appliedFilters: {
    dateFrom: string;
    region: string;
    categories: string[];
  };
  visibleRowCount: number;
  empty: boolean;
  currentReportId: string | null;
  visitedReportIds: string[];
}

export interface TaskEvidence {
  applyRecorded: boolean;
  resetRecorded: boolean;
  exportRecorded: boolean;
  sawEmptyResult: boolean;
}

export const INITIAL_TASK_UI_STATE: TaskUiState = {
  page: 'Overview',
  appliedFilters: { dateFrom: '', region: 'All', categories: [] },
  visibleRowCount: 50,
  empty: false,
  currentReportId: null,
  visitedReportIds: []
};

export const INITIAL_TASK_EVIDENCE: TaskEvidence = {
  applyRecorded: false,
  resetRecorded: false,
  exportRecorded: false,
  sawEmptyResult: false
};

export interface TaskState {
  currentTaskId: TaskId | null;
  status: TaskStatus;
  currentStepIndex: number;
  completedSteps: string[];
  startTime?: number;
  endTime?: number;
  errors: number;
  definitionVersion?: 'TD-v2';
  uiState?: TaskUiState;
  /** Set when the task was abandoned rather than completed. */
  abandonmentReason?: AbandonmentReason;
  /** Set when the task failed rather than completed or was abandoned. */
  failureReason?: TaskFailureReason;
}

const DEFAULT_TIMEOUT_MS = 120_000;

const timeoutFor = (taskId: TaskId): number =>
  DEFAULT_RUNTIME_CONFIG.experiment.taskTimeoutsMs[taskId] ?? DEFAULT_TIMEOUT_MS;

/**
 * Experimental task definitions.
 *
 * Completion is verified by `completion.ts` against `TaskUiState`; the `steps` list is the
 * canonical action guide and diagnostic trace, not a control-touch success gate.
 */
export const EXPERIMENTAL_TASKS: Record<TaskId, TargetTask> = {
  TD1: {
    id: 'TD1',
    name: 'Regional sales export',
    description: 'Filter Analytics to Europe and export the filtered report.',
    startingPage: 'Overview',
    definitionVersion: 'TD-v2',
    timeoutMs: timeoutFor('TD1'),
    completionId: 'td1-region-export',
    steps: [
      { stepId: 'TD1-1', description: 'Navigate to Analytics', expectedComponentId: 'nav-Analytics', expectedAction: 'click' },
      { stepId: 'TD1-2', description: 'Open Region filter', expectedComponentId: 'filter-section-region', expectedAction: 'click' },
      { stepId: 'TD1-3', description: 'Select Europe', expectedComponentId: 'filter-Region-select', expectedAction: 'change' },
      { stepId: 'TD1-4', description: 'Apply filters', expectedComponentId: 'btn-apply-filters', expectedAction: 'click' },
      { stepId: 'TD1-5', description: 'Export report', expectedComponentId: 'btn-export', expectedAction: 'click' }
    ]
  },
  TD2: {
    id: 'TD2',
    name: 'Date and category filter',
    description: 'Show Books sold on or after 1 June 2025 and apply the filters.',
    startingPage: 'Analytics',
    definitionVersion: 'TD-v2',
    timeoutMs: timeoutFor('TD2'),
    completionId: 'td2-date-category',
    steps: [
      { stepId: 'TD2-1', description: 'Open Date Range', expectedComponentId: 'filter-section-date-range', expectedAction: 'click' },
      { stepId: 'TD2-2', description: 'Set start date', expectedComponentId: 'filter-date-input', expectedAction: 'change' },
      { stepId: 'TD2-3', description: 'Open Product Category', expectedComponentId: 'filter-section-product-category', expectedAction: 'click' },
      { stepId: 'TD2-4', description: 'Select Books', expectedComponentId: 'filter-category-books', expectedAction: 'change' },
      { stepId: 'TD2-5', description: 'Apply filters', expectedComponentId: 'btn-apply-filters', expectedAction: 'click' }
    ]
  },
  TD3: {
    id: 'TD3',
    name: 'Empty-result recovery',
    description: 'Create an empty result set, recognise it, and reset the filters.',
    startingPage: 'Analytics',
    definitionVersion: 'TD-v2',
    timeoutMs: timeoutFor('TD3'),
    completionId: 'td3-empty-recovery',
    steps: [
      { stepId: 'TD3-1', description: 'Open Region filter', expectedComponentId: 'filter-section-region', expectedAction: 'click' },
      { stepId: 'TD3-2', description: 'Select Europe', expectedComponentId: 'filter-Region-select', expectedAction: 'change' },
      { stepId: 'TD3-3', description: 'Open Product Category', expectedComponentId: 'filter-section-product-category', expectedAction: 'click' },
      { stepId: 'TD3-4', description: 'Select Books', expectedComponentId: 'filter-category-books', expectedAction: 'change' },
      { stepId: 'TD3-5', description: 'Open Date Range', expectedComponentId: 'filter-section-date-range', expectedAction: 'click' },
      { stepId: 'TD3-6', description: 'Set 1 September 2025', expectedComponentId: 'filter-date-input', expectedAction: 'change' },
      { stepId: 'TD3-7', description: 'Apply filters', expectedComponentId: 'btn-apply-filters', expectedAction: 'click' },
      { stepId: 'TD3-8', description: 'Reset filters', expectedComponentId: 'btn-reset-filters', expectedAction: 'click' }
    ]
  },
  TD4: {
    id: 'TD4',
    name: 'Report comparison and export',
    description: 'Compare Europe Electronics with Europe Books and export the larger report.',
    startingPage: 'Reports',
    definitionVersion: 'TD-v2',
    timeoutMs: timeoutFor('TD4'),
    completionId: 'td4-report-comparison',
    steps: [
      { stepId: 'TD4-1', description: 'Open Europe Electronics', expectedComponentId: 'open-report-eu-electronics', expectedAction: 'click' },
      { stepId: 'TD4-2', description: 'Return to Reports', expectedComponentId: 'nav-Reports', expectedAction: 'click' },
      { stepId: 'TD4-3', description: 'Open Europe Books', expectedComponentId: 'open-report-eu-books', expectedAction: 'click' },
      { stepId: 'TD4-4', description: 'Export report', expectedComponentId: 'btn-export', expectedAction: 'click' }
    ]
  }
};

/**
 * Component ids that must exist in the rendered UI for a task to be completable.
 * Exposed so the DOM annotation contract can be asserted against the task model.
 */
export function getTaskRequiredComponentIds(taskId: TaskId): string[] {
  return EXPERIMENTAL_TASKS[taskId].steps
    .map((step) => step.expectedComponentId)
    .filter((id): id is string => Boolean(id));
}
