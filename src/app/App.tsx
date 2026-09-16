import { useState } from 'react';
import { Navigation, Page } from './Navigation';

import { KPICards } from '../testbed/components/KPICards';
import { FilterDrawer } from '../testbed/components/FilterDrawer';

export function App() {
  const [currentPage, setCurrentPage] = useState<Page>('Overview');

  return (
    <div className="app-container" style={{ display: 'flex', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      <Navigation currentPage={currentPage} onNavigate={setCurrentPage} />
      
      {currentPage === 'Analytics' ? (
        <div style={{ display: 'flex', flex: 1 }}>
          <FilterDrawer />
          <main style={{ flex: 1, padding: '24px' }}>
            <header style={{ borderBottom: '1px solid #ccc', paddingBottom: '16px', marginBottom: '24px' }}>
              <h1 style={{ margin: 0, fontSize: '24px' }}>{currentPage}</h1>
            </header>
            <KPICards />
          </main>
        </div>
      ) : (
        <main style={{ flex: 1, padding: '24px' }}>
          <header style={{ borderBottom: '1px solid #ccc', paddingBottom: '16px', marginBottom: '24px' }}>
            <h1 style={{ margin: 0, fontSize: '24px' }}>{currentPage}</h1>
          </header>
          <div className="page-content">
            <p>This is the {currentPage} view.</p>
          </div>
        </main>
      )}
    </div>
  );
}
