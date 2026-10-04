import { useMemo } from "react";
import { defaultTableData, ReportData } from "../mock-data/tableData";
import { FilterState } from "./FilterDrawer";

export interface ResultsTableProps {
  /** Rows to display; defaults to the deterministic 50-row stimulus set. */
  rows?: ReportData[];
  /** Active filters applied to the displayed rows. */
  filters?: FilterState;
  /** Called when the user activates the Export Report control. */
  onExport?: (rows: ReportData[]) => void;
}

/** Applies the drawer's filter state to a dataset. Pure. */
export function applyFilters(
  rows: ReportData[],
  filters?: FilterState,
): ReportData[] {
  if (!filters) return rows;

  return rows.filter((row) => {
    if (
      filters.region &&
      filters.region !== "All" &&
      row.region !== filters.region
    )
      return false;
    if (
      filters.categories.length > 0 &&
      !filters.categories.includes(row.category)
    )
      return false;
    if (filters.dateFrom && row.date < filters.dateFrom) return false;
    return true;
  });
}

/** Triggers a client-side JSON download of the given rows. No server involvement. */
export function downloadRows(rows: ReportData[], filename?: string): void {
  if (typeof document === "undefined" || typeof URL === "undefined") return;

  const payload = JSON.stringify(
    { exportedAt: new Date().toISOString(), rowCount: rows.length, rows },
    null,
    2,
  );
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename ?? `report-export-${Date.now()}.json`;
  anchor.style.display = "none";
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
    [rows, filters],
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
      className="results-table-card"
    >
      <div className="results-table-header">
        <h3
          className="results-table-title"
          data-aui-component="results-count"
          data-aui-role="status"
        >
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
            className="btn-export"
          >
            Export Report
          </button>
        </div>
      </div>
      <div className="results-table-scroll">
        <table className="results-data-table">
          <colgroup>
            <col style={{ width: "12%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "18%" }} />
            <col style={{ width: "20%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "18%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>ID</th>
              <th>Date</th>
              <th>
                Region{" "}
                <span
                  data-aui-component="tooltip-region"
                  data-aui-role="tooltip"
                  data-aui-action="hover"
                  title="Geographical sales region"
                  className="th-tooltip-trigger"
                >
                  [?]
                </span>
              </th>
              <th>Category</th>
              <th>Sales</th>
              <th>
                Status{" "}
                <span
                  data-aui-component="tooltip-status"
                  data-aui-role="tooltip"
                  data-aui-action="hover"
                  title="Current processing status"
                  className="th-tooltip-trigger"
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
              >
                <td>{row.id}</td>
                <td>{row.date}</td>
                <td>{row.region}</td>
                <td>{row.category}</td>
                <td style={{ fontFamily: "var(--font-mono)" }}>
                  ${row.sales.toLocaleString()}
                </td>
                <td>
                  <span
                    className={`table-status-badge ${
                      row.status === "Completed"
                        ? "table-status-completed"
                        : row.status === "Pending"
                          ? "table-status-pending"
                          : "table-status-failed"
                    }`}
                  >
                    {row.status}
                  </span>
                </td>
              </tr>
            ))}
            {visibleRows.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  style={{ padding: "20px", color: "var(--text-muted)", textAlign: "center" }}
                  data-aui-component="results-empty"
                >
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
