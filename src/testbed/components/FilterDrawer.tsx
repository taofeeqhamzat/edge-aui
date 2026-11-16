import { useMemo, useState } from "react";
import { REPORT_CATEGORIES, REPORT_REGIONS } from "../mock-data/tableData";

export interface FilterState {
  dateFrom: string;
  region: string;
  categories: string[];
}

export function createEmptyFilterState(): FilterState {
  return {
    dateFrom: "",
    region: "All",
    categories: [],
  };
}

export const EMPTY_FILTER_STATE: FilterState = createEmptyFilterState();

export interface FilterDrawerProps {
  /** Initial open/closed state of each accordion section. */
  initialOpen?: Record<string, boolean>;
  /** Controlled filter values. When omitted, the drawer keeps local draft state. */
  value?: FilterState;
  /** Called whenever the draft changes (controlled or uncontrolled). */
  onChange?: (filters: FilterState) => void;
  /** Called when the user submits the filter form. */
  onApply?: (filters: FilterState) => void;
  /** Called when the user activates Reset Filters. */
  onReset?: () => void;
  /** Called whenever the drawer state changes, for observability. */
  onFiltersChange?: (filters: FilterState) => void;
}

export function FilterDrawer({
  initialOpen,
  value,
  onChange,
  onApply,
  onReset,
  onFiltersChange,
}: FilterDrawerProps) {
  // All sections start collapsed. Progressive disclosure is part of the task design: the
  // task step before a control asks the participant to open its section first.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(
    initialOpen ?? {
      "Date Range": false,
      Region: false,
      "Product Category": false,
    },
  );

  const [internalFilters, setInternalFilters] = useState<FilterState>(createEmptyFilterState);
  const filters = value ?? internalFilters;

  const update = (patch: Partial<FilterState>) => {
    const next = { ...filters, ...patch };
    if (value === undefined) {
      setInternalFilters(next);
    }
    onChange?.(next);
    onFiltersChange?.(next);
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

  const handleReset = () => {
    const empty = createEmptyFilterState();
    if (value === undefined) {
      setInternalFilters(empty);
    }
    onChange?.(empty);
    onFiltersChange?.(empty);
    onReset?.();
    if (!onReset) {
      onApply?.(empty);
    }
  };

  const sections = useMemo(
    () => [
      {
        id: "date-range",
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
        id: "region",
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
        id: "product-category",
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
    ],
    [filters],
  );

  return (
    <form
      onSubmit={handleSubmit}
      data-aui-component="filter-drawer"
      data-aui-role="filter"
      data-aui-region="filters"
      aria-label="Filters"
      className="filter-drawer-container"
    >
      <h3 className="filter-drawer-title">Filters</h3>
      {sections.map((section) => (
        <div key={section.name} className="filter-section">
          <button
            type="button"
            onClick={() => toggleSection(section.name)}
            data-aui-component={`filter-section-${section.id}`}
            data-aui-role="accordion"
            data-aui-action="click"
            aria-expanded={openSections[section.name]}
            className="filter-accordion-btn"
          >
            {openSections[section.name] ? "▼" : "▶"} {section.name}
          </button>
          {openSections[section.name] && (
            <div className="filter-section-content">{section.content}</div>
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
      <button
        type="button"
        onClick={handleReset}
        data-aui-component="btn-reset-filters"
        data-aui-role="secondary-action"
        data-aui-action="click"
        className="btn-reset-filters"
      >
        Reset Filters
      </button>
    </form>
  );
}
