import type { CompletionId, TaskEvidence, TaskId, TaskUiState } from './taskModel';

type Predicate = (state: TaskUiState, evidence: TaskEvidence) => boolean;

const isDefaultFilters = (state: TaskUiState): boolean =>
  state.appliedFilters.dateFrom === '' &&
  state.appliedFilters.region === 'All' &&
  state.appliedFilters.categories.length === 0;

const hasOnlyBooks = (state: TaskUiState): boolean =>
  state.appliedFilters.categories.length === 1 &&
  state.appliedFilters.categories[0] === 'Books';

const onAnalytics = (state: TaskUiState): boolean => state.page === 'Analytics';

const isTd1Complete: Predicate = (state, evidence) =>
  onAnalytics(state) &&
  state.appliedFilters.region === 'Europe' &&
  state.visibleRowCount === 18 &&
  !state.empty &&
  evidence.exportRecorded;

const isTd2Complete: Predicate = (state, evidence) =>
  onAnalytics(state) &&
  state.appliedFilters.dateFrom === '2025-06-01' &&
  hasOnlyBooks(state) &&
  state.visibleRowCount === 5 &&
  evidence.applyRecorded;

const isTd3Complete: Predicate = (state, evidence) =>
  onAnalytics(state) &&
  evidence.sawEmptyResult &&
  evidence.resetRecorded &&
  isDefaultFilters(state) &&
  state.visibleRowCount === 50 &&
  !state.empty;

const visitedBothReports = (state: TaskUiState): boolean =>
  state.visitedReportIds.includes('eu-electronics') &&
  state.visitedReportIds.includes('eu-books');

const isTd4Complete: Predicate = (state, evidence) =>
  onAnalytics(state) &&
  visitedBothReports(state) &&
  state.currentReportId === 'eu-books' &&
  state.appliedFilters.region === 'Europe' &&
  hasOnlyBooks(state) &&
  state.visibleRowCount === 6 &&
  evidence.exportRecorded;

const PREDICATES: Record<CompletionId, Predicate> = {
  'td1-region-export': isTd1Complete,
  'td2-date-category': isTd2Complete,
  'td3-empty-recovery': isTd3Complete,
  'td4-report-comparison': isTd4Complete,
};

const COMPLETION_ID_BY_TASK: Record<TaskId, CompletionId> = {
  TD1: 'td1-region-export',
  TD2: 'td2-date-category',
  TD3: 'td3-empty-recovery',
  TD4: 'td4-report-comparison',
};

/**
 * Testbed-native completion predicates.
 *
 * A predicate is evaluated against observed UI state and action evidence. It does not depend
 * on the order in which controls were touched, and it never lives in the framework core.
 */
export function evaluateCompletion(
  completionId: CompletionId,
  state: TaskUiState,
  evidence: TaskEvidence
): boolean {
  return PREDICATES[completionId](state, evidence);
}

export function evaluateTaskCompletion(
  taskId: TaskId,
  state: TaskUiState,
  evidence: TaskEvidence
): boolean {
  return evaluateCompletion(COMPLETION_ID_BY_TASK[taskId], state, evidence);
}
