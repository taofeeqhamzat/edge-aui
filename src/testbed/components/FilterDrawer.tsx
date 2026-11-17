import { useState } from "react";
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

interface FilterSectionProps {
  id: string;
  name: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function FilterSection({ id, name, open, onToggle, children }: FilterSectionProps) {
  return (
    <div className="filter-section">
      <button
        type="button"
        onClick={onToggle}
        data-aui-component={`filter-section-${id}`}
        data-aui-role="accordion"
        data-aui-action="click"
        aria-expanded={open}
        className="filter-accordion-btn"
      >
        {open ? "▼" : "▶"} {name}
      </button>
      {open && <div className="filter-section-content">{children}</div>}
    </div>
  );
}

function DateRangeField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      data-aui-component="filter-date-input"
      data-aui-role="form-field"
      data-aui-action="change"
      className="filter-input-date"
    />
  );
}

function RegionField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
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
  );
}

function CategoryFields({
  categories,
  onToggle,
}: {
  categories: string[];
  onToggle: (category: string, checked: boolean) => void;
}) {
  return (
    <div>
      {REPORT_CATEGORIES.map((category) => (
        <label key={category} className="filter-checkbox-label">
          <input
            type="checkbox"
            checked={categories.includes(category)}
            onChange={(e) => onToggle(category, e.target.checked)}
            data-aui-component={`filter-category-${category.toLowerCase()}`}
            data-aui-role="filter"
            data-aui-action="change"
          />
          {category}
        </label>
      ))}
    </div>
  );
}

interface FilterControlOptions {
  value?: FilterState;
  onChange?: (filters: FilterState) => void;
  onApply?: (filters: FilterState) => void;
  onReset?: () => void;
  onFiltersChange?: (filters: FilterState) => void;
}

function publishDraft(
  next: FilterState,
  value: FilterState | undefined,
  setInternalFilters: (filters: FilterState) => void,
  onChange: ((filters: FilterState) => void) | undefined,
  onFiltersChange: ((filters: FilterState) => void) | undefined,
) {
  if (value === undefined) setInternalFilters(next);
  onChange?.(next);
  onFiltersChange?.(next);
}

function clearDraft(
  value: FilterState | undefined,
  setInternalFilters: (filters: FilterState) => void,
  onChange: ((filters: FilterState) => void) | undefined,
  onFiltersChange: ((filters: FilterState) => void) | undefined,
  onReset: (() => void) | undefined,
  onApply: ((filters: FilterState) => void) | undefined,
) {
  const empty = createEmptyFilterState();
  publishDraft(empty, value, setInternalFilters, onChange, onFiltersChange);
  onReset?.();
  if (!onReset) onApply?.(empty);
}

function useFilterControls({
  value,
  onChange,
  onApply,
  onReset,
  onFiltersChange,
}: FilterControlOptions) {
  const [internalFilters, setInternalFilters] = useState<FilterState>(createEmptyFilterState);
  const filters = value ?? internalFilters;

  const update = (patch: Partial<FilterState>) => {
    publishDraft({ ...filters, ...patch }, value, setInternalFilters, onChange, onFiltersChange);
  };

  const toggleCategory = (category: string, checked: boolean) => {
    const next = checked
      ? Array.from(new Set([...filters.categories, category]))
      : filters.categories.filter((c) => c !== category);
    update({ categories: next });
  };

  const reset = () => {
    clearDraft(value, setInternalFilters, onChange, onFiltersChange, onReset, onApply);
  };

  return { filters, update, toggleCategory, reset };
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

  const { filters, update, toggleCategory, reset } = useFilterControls({
    value,
    onChange,
    onApply,
    onReset,
    onFiltersChange,
  });

  const toggleSection = (section: string) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onApply?.(filters);
  };

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
      <FilterSection
        id="date-range"
        name="Date Range"
        open={Boolean(openSections["Date Range"])}
        onToggle={() => toggleSection("Date Range")}
      >
        <DateRangeField value={filters.dateFrom} onChange={(dateFrom) => update({ dateFrom })} />
      </FilterSection>
      <FilterSection
        id="region"
        name="Region"
        open={Boolean(openSections.Region)}
        onToggle={() => toggleSection("Region")}
      >
        <RegionField value={filters.region} onChange={(region) => update({ region })} />
      </FilterSection>
      <FilterSection
        id="product-category"
        name="Product Category"
        open={Boolean(openSections["Product Category"])}
        onToggle={() => toggleSection("Product Category")}
      >
        <CategoryFields categories={filters.categories} onToggle={toggleCategory} />
      </FilterSection>
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
        onClick={reset}
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
