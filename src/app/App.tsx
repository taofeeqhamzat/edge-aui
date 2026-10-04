import { useEffect, useMemo, useState } from 'react';
import { Navigation, Page } from './Navigation';

import { KPICards } from '../testbed/components/KPICards';
import { FilterDrawer, EMPTY_FILTER_STATE, FilterState } from '../testbed/components/FilterDrawer';
import { ResultsTable, downloadRows } from '../testbed/components/ResultsTable';
import { TrialControls } from '../testbed/components/TrialControls';
import { defaultTableData } from '../testbed/mock-data/tableData';
import { DebugPanel } from '../debug/DebugPanel';
import { initUIContextTracker } from '../telemetry/contextProvider';
import { testbedAdapter } from '../testbed/adapter';

// Ensure testbed adapter is initialized when testbed App is loaded
testbedAdapter.onInit?.();

export function App() {
  const [currentPage, setCurrentPage] = useState<Page>('Overview');
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(EMPTY_FILTER_STATE);

  // Passive UI-context tracking (hover/focus) so `getActiveUIContext` is populated.
  useEffect(() => initUIContextTracker(document), []);

  const rows = useMemo(() => defaultTableData, []);

  return (
    <div
      className="app-container"
      data-aui-route={currentPage}
      data-aui-component={`page-${currentPage.toLowerCase()}`}
    >
      <Navigation currentPage={currentPage} onNavigate={setCurrentPage} />

      <main className="app-main">
        <header className="page-header">
          <h1 className="page-title">{currentPage}</h1>
        </header>

        <TrialControls />

        <div className="page-body">
          {currentPage === 'Analytics' ? (
            <div className="analytics-layout">
              <FilterDrawer onApply={setAppliedFilters} />
              <div className="analytics-results">
                <KPICards />
                <ResultsTable
                  rows={rows}
                  filters={appliedFilters}
                  onExport={(visibleRows) => downloadRows(visibleRows)}
                />
              </div>
            </div>
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
