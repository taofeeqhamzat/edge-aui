import { useEffect, useMemo, useState } from 'react';
import { Navigation, Page } from './Navigation';

import { KPICards } from '../testbed/components/KPICards';
import {
  FilterDrawer,
  createEmptyFilterState,
  FilterState,
} from '../testbed/components/FilterDrawer';
import { ReportsCatalogue } from '../testbed/components/ReportsCatalogue';
import { ResultsTable, applyFilters, downloadRows } from '../testbed/components/ResultsTable';
import { TrialControls } from '../testbed/components/TrialControls';
import { defaultTableData } from '../testbed/mock-data/tableData';
import { findReport, ReportDefinition } from '../testbed/data/reportCatalog';
import { DebugPanel } from '../debug/DebugPanel';
import { initUIContextTracker } from '../telemetry/contextProvider';
import { testbedAdapter } from '../testbed/adapter';
import { taskManager } from '../testbed/tasks/taskManager';
import { TargetTask, TaskUiState } from '../testbed/tasks/taskModel';

// Ensure testbed adapter is initialized when testbed App is loaded
testbedAdapter.onInit?.();

export function App() {
  const [currentPage, setCurrentPage] = useState<Page>('Overview');
  const [filters, setFilters] = useState<FilterState>(createEmptyFilterState);
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(createEmptyFilterState);
  const [currentReportId, setCurrentReportId] = useState<string | null>(null);
  const [visitedReportIds, setVisitedReportIds] = useState<string[]>([]);
  /**
   * Bumped whenever a trial boundary is crossed.
   *
   * The drawer keeps its open/closed sections in local state, so resetting the filter values
   * is not enough: a task that begins after another task's disclosure would start with that
   * task's sections open (Workstream 10 exit criterion: sections reset too). Remounting the
   * drawer through this key restores the declared "all sections collapsed" start state.
   */
  const [trialKey, setTrialKey] = useState(0);

  // Passive UI-context tracking (hover/focus) so `getActiveUIContext` is populated.
  useEffect(() => initUIContextTracker(document), []);

  const rows = useMemo(() => defaultTableData, []);

  const makeUiState = (
    page: Page,
    applied: FilterState,
    reportId: string | null,
    visited: string[],
  ): TaskUiState => {
    const count = applyFilters(rows, applied).length;
    return {
      page,
      appliedFilters: applied,
      visibleRowCount: count,
      empty: count === 0,
      currentReportId: reportId,
      visitedReportIds: visited,
    };
  };

  useEffect(() => {
    taskManager.updateUiState(
      makeUiState(currentPage, appliedFilters, currentReportId, visitedReportIds),
    );
  }, [currentPage, appliedFilters, currentReportId, visitedReportIds, rows]);

  /** Testbed-owned task-start normalization. Runs before `task_start` is emitted. */
  const prepareTask = (task: TargetTask): TaskUiState => {
    const empty = createEmptyFilterState();
    setFilters(empty);
    setAppliedFilters(empty);
    setCurrentReportId(null);
    setVisitedReportIds([]);
    setCurrentPage(task.startingPage);

    const snapshot = makeUiState(task.startingPage, empty, null, []);
    taskManager.updateUiState(snapshot);
    setTrialKey((key) => key + 1);
    return snapshot;
  };

  const resetTaskUi = () => {
    const empty = createEmptyFilterState();
    setFilters(empty);
    setAppliedFilters(empty);
    setCurrentReportId(null);
    setVisitedReportIds([]);
    setTrialKey((key) => key + 1);
    taskManager.updateUiState(makeUiState(currentPage, empty, null, []));
  };

  const handleApply = (next: FilterState) => {
    setAppliedFilters(next);
    // A manual filter change no longer describes the selected report.
    setCurrentReportId(null);
  };

  const handleResetFilters = () => {
    const empty = createEmptyFilterState();
    setFilters(empty);
    setAppliedFilters(empty);
    setCurrentReportId(null);
    setVisitedReportIds([]);
    taskManager.updateUiState(makeUiState(currentPage, empty, null, []));
  };

  const handleOpenReport = (report: ReportDefinition) => {
    const preset: FilterState = {
      dateFrom: '',
      region: report.region,
      categories: [report.category],
    };
    const nextVisited = visitedReportIds.includes(report.id)
      ? visitedReportIds
      : [...visitedReportIds, report.id];

    setFilters(preset);
    setAppliedFilters(preset);
    setCurrentReportId(report.id);
    setVisitedReportIds(nextVisited);
    setCurrentPage('Analytics');

    taskManager.updateUiState(makeUiState('Analytics', preset, report.id, nextVisited));
  };

  const currentReport = findReport(currentReportId);

  return (
    <div
      className="app-container"
      data-aui-route={currentPage}
      data-aui-component={`page-${currentPage.toLowerCase()}`}
      data-aui-region="app"
    >
      <Navigation currentPage={currentPage} onNavigate={setCurrentPage} />

      <main className="app-main" data-aui-region="page">
        <header className="page-header">
          <h1 className="page-title">{currentPage}</h1>
        </header>

        <TrialControls onPrepareTask={prepareTask} onResetTaskUi={resetTaskUi} />

        <div className="page-body">
          {currentPage === 'Analytics' ? (
            <div className="analytics-layout">
              <FilterDrawer
                key={trialKey}
                value={filters}
                onChange={setFilters}
                onApply={handleApply}
                onReset={handleResetFilters}
              />
              <div className="analytics-results">
                <KPICards />
                {currentReport && (
                  <div
                    data-aui-component="current-report"
                    data-aui-role="status"
                    className="current-report"
                  >
                    Report: {currentReport.name}
                  </div>
                )}
                <ResultsTable
                  rows={rows}
                  filters={appliedFilters}
                  onExport={(visibleRows) => downloadRows(visibleRows)}
                />
              </div>
            </div>
          ) : currentPage === 'Reports' ? (
            <ReportsCatalogue
              onOpen={handleOpenReport}
              currentReportId={currentReportId}
            />
          ) : (
            <div className="page-content">
              <p>This is the {currentPage} view.</p>
            </div>
          )}
        </div>
      </main>

      <DebugPanel />
    </div>
  );
}
