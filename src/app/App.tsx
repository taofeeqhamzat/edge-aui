import { useEffect, useMemo, useState } from 'react';
import { Navigation, Page } from './Navigation';

import { KPICards } from '../testbed/components/KPICards';
import { FilterDrawer, EMPTY_FILTER_STATE, FilterState } from '../testbed/components/FilterDrawer';
import { ResultsTable, downloadRows } from '../testbed/components/ResultsTable';
import { TrialControls } from '../testbed/components/TrialControls';
import { defaultTableData } from '../testbed/mock-data/tableData';
import { DebugPanel } from '../debug/DebugPanel';
import { initUIContextTracker } from '../telemetry/contextProvider';

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
      style={{ display: 'flex', minHeight: '100vh', fontFamily: 'sans-serif' }}
    >
      <Navigation currentPage={currentPage} onNavigate={setCurrentPage} />

      {currentPage === 'Analytics' ? (
        <div style={{ display: 'flex', flex: 1 }}>
          <FilterDrawer onApply={setAppliedFilters} />
          <main style={{ flex: 1, padding: '24px', display: 'flex', flexDirection: 'column' }}>
            <header style={{ borderBottom: '1px solid #ccc', paddingBottom: '16px', marginBottom: '24px' }}>
              <h1 style={{ margin: 0, fontSize: '24px' }}>{currentPage}</h1>
            </header>
            <TrialControls />
            <KPICards />
            <ResultsTable
              rows={rows}
              filters={appliedFilters}
              onExport={(visibleRows) => downloadRows(visibleRows)}
            />
          </main>
        </div>
      ) : (
        <main style={{ flex: 1, padding: '24px' }}>
          <header style={{ borderBottom: '1px solid #ccc', paddingBottom: '16px', marginBottom: '24px' }}>
            <h1 style={{ margin: 0, fontSize: '24px' }}>{currentPage}</h1>
          </header>
          <TrialControls />
          <div className="page-content">
            <p>This is the {currentPage} view.</p>
          </div>
        </main>
      )}
      <DebugPanel />
    </div>
  );
}
