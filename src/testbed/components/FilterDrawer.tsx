import { useMemo, useState } from "react";
import { REPORT_CATEGORIES, REPORT_REGIONS } from "../mock-data/tableData";

export interface FilterState {
  dateFrom: string;
  region: string;
  categories: string[];
  segment: string;
}

export const EMPTY_FILTER_STATE: FilterState = {
  dateFrom: "",
  region: "All",
  categories: [],
  segment: "All",
};

export interface FilterDrawerProps {
  /** Initial open/closed state of each accordion section. */
  initialOpen?: Record<string, boolean>;
  /** Called when the user submits the filter form. */
  onApply?: (filters: FilterState) => void;
  /** Called whenever the drawer state changes, for observability. */
  onFiltersChange?: (filters: FilterState) => void;
}

export function FilterDrawer({
  initialOpen,
  onApply,
  onFiltersChange,
}: FilterDrawerProps) {
  // All sections start collapsed. Progressive disclosure is part of the task design: T1 step
  // 2 and T3 step 2 ask the participant to open a specific section, so those sections must
  // not already be open, and their controls must not be in the DOM before that action.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(
    initialOpen ?? {
      "Date Range": false,
      Region: false,
      "Product Category": false,
      "Advanced Options": false,
    },
  );

  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTER_STATE);

  const update = (patch: Partial<FilterState>) => {
    setFilters((prev) => {
      const next = { ...prev, ...patch };
      onFiltersChange?.(next);
      return next;
    });
  };

  const toggleSection = (section: string) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const toggleCategory = (category: string, checked: boolean) => {
    const next = checked
      ? Array.from(new Set([...filters.categories, category]))
      : filters.categories.filter((c) => c !== category);
    update({ categories: next });
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onApply?.(filters);
  };

  const sections = useMemo(
    () => [
      {
        name: "Date Range",
        content: (
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => update({ dateFrom: e.target.value })}
            data-aui-component="filter-date-input"
            data-aui-role="form-field"
            data-aui-action="change"
            className="filter-input-date"
          />
        ),
      },
      {
        name: "Region",
        content: (
          <select
            value={filters.region}
            onChange={(e) => update({ region: e.target.value })}
            data-aui-component="filter-Region-select"
            data-aui-role="filter"
            data-aui-action="change"
            data-aui-task-role="required"
            className="filter-select"
          >
            <option value="All">All regions</option>
            {REPORT_REGIONS.map((region) => (
              <option key={region} value={region}>
                {region}
              </option>
            ))}
          </select>
        ),
      },
      {
        name: "Product Category",
        content: (
          <div>
            {REPORT_CATEGORIES.map((category) => (
              <label key={category} className="filter-checkbox-label">
                <input
                  type="checkbox"
                  checked={filters.categories.includes(category)}
                  onChange={(e) => toggleCategory(category, e.target.checked)}
                  data-aui-component={`filter-category-${category.toLowerCase()}`}
                  data-aui-role="filter"
                  data-aui-action="change"
                />
                {category}
              </label>
            ))}
          </div>
        ),
      },
      {
        name: "Advanced Options",
        content: (
          <div>
            <label className="filter-checkbox-label" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
              <span>Customer Segment</span>
              <select
                value={filters.segment}
                onChange={(e) => update({ segment: e.target.value })}
                data-aui-component="filter-segment-select"
                data-aui-role="filter"
                data-aui-action="change"
                data-aui-task-role="required"
                className="filter-select"
              >
                <option value="All">All</option>
                <option value="New">New</option>
                <option value="Returning">Returning</option>
              </select>
            </label>
          </div>
        ),
      },
    ],
    [filters],
  );

  return (
    <form
      onSubmit={handleSubmit}
      data-aui-component="filter-drawer"
      data-aui-role="filter"
      aria-label="Filters"
      className="filter-drawer-container"
    >
      <h3 className="filter-drawer-title">Filters</h3>
      {sections.map((section) => (
        <div key={section.name} className="filter-section">
          <button
            type="button"
            onClick={() => toggleSection(section.name)}
            data-aui-component={`filter-${section.name}`}
            data-aui-role="accordion"
            data-aui-action="click"
            aria-expanded={openSections[section.name]}
            className="filter-accordion-btn"
          >
            {openSections[section.name] ? "▼" : "▶"} {section.name}
          </button>
          {openSections[section.name] && (
            <div className="filter-section-content">
              {section.content}
            </div>
          )}
        </div>
      ))}
      <button
        type="submit"
        data-aui-component="btn-apply-filters"
        data-aui-role="submit-action"
        data-aui-action="click"
        data-aui-task-role="required"
        className="btn-apply-filters"
      >
        Apply Filters
      </button>
    </form>
  );
}
