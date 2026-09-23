import { describe, it, expect } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { Navigation } from '../src/app/Navigation';
import { FilterDrawer } from '../src/testbed/components/FilterDrawer';
import { ResultsTable } from '../src/testbed/components/ResultsTable';
import { KPICards } from '../src/testbed/components/KPICards';
import { App } from '../src/app/App';

describe('Task 3.1: Semantic DOM Annotation Contract (data-aui-*)', () => {
  it('annotates navigation buttons with stable component IDs and roles', () => {
    const { container } = render(<Navigation currentPage="Analytics" onNavigate={() => {}} />);
    const navButtons = container.querySelectorAll('button[data-aui-component^="nav-"]');

    expect(navButtons.length).toBe(5);
    const analyticsBtn = container.querySelector('[data-aui-component="nav-Analytics"]');
    expect(analyticsBtn).not.toBeNull();
    expect(analyticsBtn?.getAttribute('data-aui-role')).toBe('navigation');
    expect(analyticsBtn?.getAttribute('data-aui-action')).toBe('click');
  });

  it('annotates FilterDrawer accordion sections and filter controls', () => {
    // All sections start collapsed (progressive disclosure is part of the task design), so
    // the section containing a control is opened before that control is queried.
    const { container } = render(<FilterDrawer />);
    const openSection = (componentId: string) => {
      const accordion = container.querySelector(
        `[data-aui-component="${componentId}"]`
      ) as HTMLElement | null;
      if (accordion && accordion.getAttribute('aria-expanded') !== 'true') {
        act(() => accordion.click());
      }
    };

    // Submit control. The apply button is a real form submit control so the observer
    // captures a `submit` event, which is what the FORM_SUBMIT outcome requires.
    const applyBtn = container.querySelector('[data-aui-component="btn-apply-filters"]');
    expect(applyBtn).not.toBeNull();
    expect(applyBtn?.getAttribute('data-aui-role')).toBe('submit-action');
    expect(applyBtn?.getAttribute('data-aui-action')).toBe('click');
    expect(applyBtn?.getAttribute('data-aui-task-role')).toBe('required');
    expect(applyBtn?.getAttribute('type')).toBe('submit');

    // The drawer is a real form so submit semantics exist in the DOM.
    expect(container.querySelector('form')).not.toBeNull();

    // Accordions
    const regionAccordion = container.querySelector('[data-aui-component="filter-Region"]');
    expect(regionAccordion).not.toBeNull();
    expect(regionAccordion?.getAttribute('data-aui-role')).toBe('accordion');

    // Region select filter (disclosed by opening its section)
    openSection('filter-Region');
    const regionSelect = container.querySelector('[data-aui-component="filter-Region-select"]');
    expect(regionSelect).not.toBeNull();
    expect(regionSelect?.getAttribute('data-aui-role')).toBe('filter');
    expect(regionSelect?.getAttribute('data-aui-action')).toBe('change');
    expect(regionSelect?.getAttribute('data-aui-task-role')).toBe('required');

    // Date range input (disclosed by opening its section)
    openSection('filter-Date Range');
    const dateInput = container.querySelector('[data-aui-component="filter-date-input"]');
    expect(dateInput).not.toBeNull();
    expect(dateInput?.getAttribute('data-aui-role')).toBe('form-field');

    // Advanced Options accordion toggle & customer segment select
    const advancedAccordion = container.querySelector('[data-aui-component="filter-Advanced Options"]');
    expect(advancedAccordion).not.toBeNull();
    expect(advancedAccordion?.getAttribute('data-aui-role')).toBe('accordion');
    expect(advancedAccordion?.getAttribute('aria-expanded')).toBe('false');

    // Click to expand Advanced Options
    fireEvent.click(advancedAccordion!);
    expect(advancedAccordion?.getAttribute('aria-expanded')).toBe('true');

    const segmentSelect = container.querySelector('[data-aui-component="filter-segment-select"]');
    expect(segmentSelect).not.toBeNull();
    expect(segmentSelect?.getAttribute('data-aui-role')).toBe('filter');
  });

  it('annotates ResultsTable actions, tooltips, and table rows', () => {
    const { container } = render(<ResultsTable />);

    // Primary export action
    const exportBtn = container.querySelector('[data-aui-component="btn-export"]');
    expect(exportBtn).not.toBeNull();
    expect(exportBtn?.getAttribute('data-aui-role')).toBe('primary-action');
    expect(exportBtn?.getAttribute('data-aui-task-role')).toBe('required');

    // Contextual help tooltips
    const regionTooltip = container.querySelector('[data-aui-component="tooltip-region"]');
    expect(regionTooltip).not.toBeNull();
    expect(regionTooltip?.getAttribute('data-aui-role')).toBe('tooltip');
    expect(regionTooltip?.getAttribute('data-aui-action')).toBe('hover');

    const statusTooltip = container.querySelector('[data-aui-component="tooltip-status"]');
    expect(statusTooltip).not.toBeNull();
    expect(statusTooltip?.getAttribute('data-aui-role')).toBe('tooltip');

    // Table rows
    const rows = container.querySelectorAll('tr[data-aui-role="table-row"]');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].getAttribute('data-aui-component')).toMatch(/^table-row-/);
  });

  it('annotates KPICards container and items', () => {
    const { container } = render(<KPICards />);
    const cards = container.querySelectorAll('[data-aui-role="kpi-card"]');
    expect(cards.length).toBe(4);
    expect(cards[0].getAttribute('data-aui-component')).toMatch(/^kpi-card-/);
  });

  it('annotates App container with current route', () => {
    const { container } = render(<App />);
    const appContainer = container.querySelector('.app-container');
    expect(appContainer?.getAttribute('data-aui-route')).toBe('Overview');
  });
});
