export type Page =
  | "Overview"
  | "Analytics"
  | "Reports"
  | "Customers"
  | "Settings";

interface NavigationProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

export function Navigation({ currentPage, onNavigate }: NavigationProps) {
  const pages: Page[] = [
    "Overview",
    "Analytics",
    "Reports",
    "Customers",
    "Settings",
  ];

  return (
    <nav className="dashboard-nav" aria-label="Main Navigation">
      <h2 className="nav-title">Dashboard</h2>
      <ul className="nav-list">
        {pages.map((page) => (
          <li key={page} className="nav-item">
            <button
              type="button"
              onClick={() => onNavigate(page)}
              data-aui-component={`nav-${page}`}
              data-aui-role="navigation"
              data-aui-action="click"
              className={`nav-btn ${currentPage === page ? "active" : ""}`}
            >
              {page}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
