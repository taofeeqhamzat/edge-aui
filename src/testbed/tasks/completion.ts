import type { CompletionId, TaskEvidence, TaskId, TaskUiState } from './taskModel';

const isDefaultFilters = (state: TaskUiState): boolean =>
  state.appliedFilters.dateFrom === '' &&
  state.appliedFilters.region === 'All' &&
  state.appliedFilters.categories.length === 0;

const hasOnlyBooks = (state: TaskUiState): boolean =>
  state.appliedFilters.categories.length === 1 &&
  state.appliedFilters.categories[0] === 'Books';

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
  switch (completionId) {
    case 'td1-region-export':
      return (
        state.page === 'Analytics' &&
        state.appliedFilters.region === 'Europe' &&
        state.visibleRowCount === 18 &&
        !state.empty &&
        evidence.exportRecorded
      );

    case 'td2-date-category':
      return (
        state.page === 'Analytics' &&
        state.appliedFilters.dateFrom === '2025-06-01' &&
        hasOnlyBooks(state) &&
        state.visibleRowCount === 5 &&
        evidence.applyRecorded
      );

    case 'td3-empty-recovery':
      return (
        state.page === 'Analytics' &&
        evidence.sawEmptyResult &&
        evidence.resetRecorded &&
        isDefaultFilters(state) &&
        state.visibleRowCount === 50 &&
        !state.empty
      );

    case 'td4-report-comparison':
      return (
        state.page === 'Analytics' &&
        state.visitedReportIds.includes('eu-electronics') &&
        state.visitedReportIds.includes('eu-books') &&
        state.currentReportId === 'eu-books' &&
        state.appliedFilters.region === 'Europe' &&
        hasOnlyBooks(state) &&
        state.visibleRowCount === 6 &&
        evidence.exportRecorded
      );

    default: {
      const exhaustive: never = completionId;
      return exhaustive;
    }
  }
}

export function evaluateTaskCompletion(
  taskId: TaskId,
  state: TaskUiState,
  evidence: TaskEvidence
): boolean {
  const completionIdByTask: Record<TaskId, CompletionId> = {
    TD1: 'td1-region-export',
    TD2: 'td2-date-category',
    TD3: 'td3-empty-recovery',
    TD4: 'td4-report-comparison'
  };
  return evaluateCompletion(completionIdByTask[taskId], state, evidence);
}
