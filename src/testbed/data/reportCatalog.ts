export interface ReportDefinition {
  id: string;
  name: string;
  region: string;
  category: string;
}

/**
 * Deterministic report catalogue for TD4.
 *
 * The matching row counts are intentionally not part of this data. Participants must open a
 * report to see its result count; exposing counts here would remove the comparison step.
 */
export const REPORT_CATALOG: ReportDefinition[] = [
  { id: 'eu-electronics', name: 'Europe Electronics', region: 'Europe', category: 'Electronics' },
  { id: 'eu-books', name: 'Europe Books', region: 'Europe', category: 'Books' },
  { id: 'eu-clothing', name: 'Europe Clothing', region: 'Europe', category: 'Clothing' },
  { id: 'na-clothing', name: 'North America Clothing', region: 'North America', category: 'Clothing' },
  { id: 'apac-electronics', name: 'Asia Pacific Electronics', region: 'Asia Pacific', category: 'Electronics' },
];

export function findReport(reportId: string | null): ReportDefinition | undefined {
  if (!reportId) return undefined;
  return REPORT_CATALOG.find((report) => report.id === reportId);
}
