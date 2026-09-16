

export type Page = 'Overview' | 'Analytics' | 'Reports' | 'Customers' | 'Settings';

interface NavigationProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

export function Navigation({ currentPage, onNavigate }: NavigationProps) {
  const pages: Page[] = ['Overview', 'Analytics', 'Reports', 'Customers', 'Settings'];

  return (
    <nav className="dashboard-nav" style={{ width: '200px', borderRight: '1px solid #ccc', padding: '16px' }}>
      <h2 style={{ fontSize: '18px', marginBottom: '24px' }}>Analytics Dashboard</h2>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {pages.map((page) => (
          <li key={page} style={{ marginBottom: '8px' }}>
            <button
              onClick={() => onNavigate(page)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '8px 12px',
                border: 'none',
                background: currentPage === page ? '#e0f7fa' : 'transparent',
                color: currentPage === page ? '#006064' : 'inherit',
                fontWeight: currentPage === page ? 'bold' : 'normal',
                cursor: 'pointer',
                borderRadius: '4px'
              }}
            >
              {page}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
