import { useMemo } from 'react';
import { defaultTableData, ReportData } from '../mock-data/tableData';
import { FilterState } from './FilterDrawer';

export interface ResultsTableProps {
  /** Rows to display; defaults to the deterministic 50-row stimulus set. */
  rows?: ReportData[];
  /** Active filters applied to the displayed rows. */
  filters?: FilterState;
  /** Called when the user activates the Export Report control. */
  onExport?: (rows: ReportData[]) => void;
}

/** Applies the drawer's filter state to a dataset. Pure. */
export function applyFilters(rows: ReportData[], filters?: FilterState): ReportData[] {
  if (!filters) return rows;

  return rows.filter((row) => {
    if (filters.region && filters.region !== 'All' && row.region !== filters.region) return false;
    if (filters.categories.length > 0 && !filters.categories.includes(row.category)) return false;
    if (filters.dateFrom && row.date < filters.dateFrom) return false;
    return true;
  });
}

/** Triggers a client-side JSON download of the given rows. No server involvement. */
export function downloadRows(rows: ReportData[], filename?: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;

  const payload = JSON.stringify({ exportedAt: new Date().toISOString(), rowCount: rows.length, rows }, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename ?? `report-export-${Date.now()}.json`;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();

  setTimeout(() => {
    if (anchor.parentNode) anchor.parentNode.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, 100);
}

export function ResultsTable({ rows, filters, onExport }: ResultsTableProps) {
  const visibleRows = useMemo(
    () => applyFilters(rows ?? defaultTableData, filters),
    [rows, filters]
  );

  const handleExport = () => {
    if (onExport) {
      onExport(visibleRows);
      return;
    }
    downloadRows(visibleRows);
  };

  return (
    <div
      data-aui-component="results-table"
      data-aui-role="table"
      style={{ background: '#fff', border: '1px solid #ccc', borderRadius: '8px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
    >
      <div style={{ padding: '16px', borderBottom: '1px solid #ccc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }} data-aui-component="results-count" data-aui-role="status">
          Results ({visibleRows.length})
        </h3>
        <div>
          <button
            type="button"
            onClick={handleExport}
            data-aui-component="btn-export"
            data-aui-role="primary-action"
            data-aui-action="click"
            data-aui-task-role="required"
            style={{ padding: '8px 16px', background: '#e0e0e0', border: 'none', borderRadius: '4px', cursor: 'pointer', marginRight: '8px' }}
          >
            Export Report
          </button>
        </div>
      </div>
      <div style={{ overflowY: 'auto', maxHeight: '400px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead style={{ background: '#f5f5f5', position: 'sticky', top: 0, borderBottom: '1px solid #ddd' }}>
            <tr>
              <th style={{ padding: '12px 16px' }}>ID</th>
              <th style={{ padding: '12px 16px' }}>Date</th>
              <th style={{ padding: '12px 16px' }}>
                Region{' '}
                <span
                  data-aui-component="tooltip-region"
                  data-aui-role="tooltip"
                  data-aui-action="hover"
                  title="Geographical sales region"
                  style={{ cursor: 'help' }}
                >
                  [?]
                </span>
              </th>
              <th style={{ padding: '12px 16px' }}>Category</th>
              <th style={{ padding: '12px 16px' }}>Sales</th>
              <th style={{ padding: '12px 16px' }}>
                Status{' '}
                <span
                  data-aui-component="tooltip-status"
                  data-aui-role="tooltip"
                  data-aui-action="hover"
                  title="Current processing status"
                  style={{ cursor: 'help' }}
                >
                  [?]
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr
                key={row.id}
                data-aui-component={`table-row-${row.id}`}
                data-aui-role="table-row"
                data-aui-action="hover"
                style={{ borderBottom: '1px solid #eee' }}
              >
                <td style={{ padding: '12px 16px' }}>{row.id}</td>
                <td style={{ padding: '12px 16px' }}>{row.date}</td>
                <td style={{ padding: '12px 16px' }}>{row.region}</td>
                <td style={{ padding: '12px 16px' }}>{row.category}</td>
                <td style={{ padding: '12px 16px' }}>${row.sales.toLocaleString()}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{
                    padding: '4px 8px',
                    borderRadius: '12px',
                    fontSize: '12px',
                    background: row.status === 'Completed' ? '#e8f5e9' : row.status === 'Pending' ? '#fff3e0' : '#ffebee',
                    color: row.status === 'Completed' ? '#2e7d32' : row.status === 'Pending' ? '#ef6c00' : '#c62828'
                  }}>
                    {row.status}
                  </span>
                </td>
              </tr>
            ))}
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: '16px', color: '#666' }} data-aui-component="results-empty">
                  No rows match the active filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
