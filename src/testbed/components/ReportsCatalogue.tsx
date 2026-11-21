import { REPORT_CATALOG, ReportDefinition } from "../data/reportCatalog";

export interface ReportsCatalogueProps {
  onOpen: (report: ReportDefinition) => void;
  currentReportId?: string | null;
}

export function ReportsCatalogue({ onOpen, currentReportId }: ReportsCatalogueProps) {
  return (
    <section
      data-aui-component="reports-catalogue"
      data-aui-role="table"
      data-aui-region="reports"
      className="reports-catalogue"
      aria-label="Available reports"
    >
      <h2 className="reports-catalogue-title">Available Reports</h2>
      <table className="results-data-table reports-data-table">
        <thead>
          <tr>
            <th>Report</th>
            <th>Region</th>
            <th>Category</th>
            <th
              data-aui-component="reports-header-action"
              data-aui-role="tooltip"
              title="Open a report to compare"
              data-tooltip="Open a report to view and compare detailed metrics"
            >
              Action
            </th>
          </tr>
        </thead>
        <tbody>
          {REPORT_CATALOG.map((report) => (
            <tr
              key={report.id}
              data-aui-component={`report-row-${report.id}`}
              data-aui-role="report-row"
              data-aui-action="hover"
              className={currentReportId === report.id ? "report-row-current" : undefined}
            >
              <td data-aui-component={`report-name-${report.id}`}>{report.name}</td>
              <td data-aui-component={`report-meta-${report.id}`}>{report.region}</td>
              <td>{report.category}</td>
              <td>
                <button
                  type="button"
                  onClick={() => onOpen(report)}
                  data-aui-component={`open-report-${report.id}`}
                  data-aui-role="secondary-action"
                  data-aui-action="click"
                  className="btn-open-report"
                  aria-label={`Open ${report.name}`}
                >
                  Open
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
