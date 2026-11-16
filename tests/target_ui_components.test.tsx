/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { App } from '../src/app/App';
import { FilterDrawer } from '../src/testbed/components/FilterDrawer';
import { ResultsTable } from '../src/testbed/components/ResultsTable';
import { KPICards } from '../src/testbed/components/KPICards';
import { taskManager } from '../src/testbed/tasks/taskManager';

describe('Target UI & Task State Test Suite (Task 11.1)', () => {
  beforeEach(() => {
    taskManager.resetTask();
  });

  describe('Application Navigation & Page Rendering', () => {
    it('renders Overview view by default and switches views upon navigation', () => {
      act(() => {
        render(<App />);
      });

      // Default page is Overview
      expect(screen.getByText('This is the Overview view.')).not.toBeNull();

      // Navigate to Analytics. Scoped to the navigation component because the trial
      // controls also expose buttons whose accessible names contain "Analytics".
      const analyticsNavBtn = document.querySelector(
        '[data-aui-component="nav-Analytics"]'
      ) as HTMLElement;
      act(() => {
        fireEvent.click(analyticsNavBtn);
      });

      // Analytics page renders KPICards, FilterDrawer, ResultsTable
      expect(screen.getByText('Filters')).not.toBeNull();
      expect(screen.getByText(/Results \(\d+\)/)).not.toBeNull();
      expect(screen.getByText('Total Revenue')).not.toBeNull();

      // Navigate to Reports
      const reportsNavBtn = document.querySelector(
        '[data-aui-component="nav-Reports"]'
      ) as HTMLElement;
      act(() => {
        fireEvent.click(reportsNavBtn);
      });
      expect(screen.getByText('Available Reports')).not.toBeNull();
    });
  });

  describe('FilterDrawer Component', () => {
    it('toggles accordions open and closed on click', () => {
      act(() => {
        render(<FilterDrawer />);
      });

      // Every section starts collapsed, so no section control is in the DOM yet.
      expect(screen.getByRole('button', { name: /▶ Date Range/i })).not.toBeNull();
      const productCatBtn = screen.getByRole('button', { name: /▶ Product Category/i });
      expect(screen.queryByText('Electronics')).toBeNull();

      // Open Product Category accordion
      act(() => {
        fireEvent.click(productCatBtn);
      });
      expect(screen.getByText('Electronics')).not.toBeNull();

      // Open then collapse Date Range accordion
      const dateRangeBtn = screen.getByRole('button', { name: /▶ Date Range/i });
      act(() => {
        fireEvent.click(dateRangeBtn);
      });
      expect(screen.getByRole('button', { name: /▼ Date Range/i })).not.toBeNull();
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: /▼ Date Range/i }));
      });
      expect(screen.getByRole('button', { name: /▶ Date Range/i })).not.toBeNull();
    });

    it('handles filter selection changes and primary apply button click', () => {
      act(() => {
        render(<FilterDrawer />);
      });

      // The Region control is disclosed by opening its section first.
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: /▶ Region/i }));
      });
      const regionSelect = screen.getByRole('combobox');
      act(() => {
        fireEvent.change(regionSelect, { target: { value: 'Europe' } });
      });
      expect((regionSelect as HTMLSelectElement).value).toBe('Europe');

      const applyBtn = screen.getByRole('button', { name: /Apply Filters/i });
      expect(applyBtn.getAttribute('data-aui-role')).toBe('submit-action');
      expect(applyBtn.getAttribute('data-aui-action')).toBe('click');
    });
  });

  describe('ResultsTable Component', () => {
    it('renders tabular dataset rows, action buttons, and accessible tooltips', () => {
      act(() => {
        render(<ResultsTable />);
      });

      const exportBtn = screen.getByRole('button', { name: /Export Report/i });
      expect(exportBtn.getAttribute('data-aui-component')).toBe('btn-export');
      expect(exportBtn.getAttribute('data-aui-role')).toBe('primary-action');

      const regionTooltip = screen.getByTitle('Geographical sales region');
      expect(regionTooltip.getAttribute('data-aui-role')).toBe('tooltip');

      // Table row items rendered
      const firstRow = document.querySelector('[data-aui-component="table-row-REP-1000"]');
      expect(firstRow).not.toBeNull();
    });
  });

  describe('KPICards Component', () => {
    it('renders all key performance indicators with correct attributes', () => {
      act(() => {
        render(<KPICards />);
      });

      expect(screen.getByText('Total Revenue')).not.toBeNull();
      expect(screen.getByText('$124,500')).not.toBeNull();
      expect(screen.getByText('Active Users')).not.toBeNull();
      expect(screen.getByText('Conversion Rate')).not.toBeNull();
    });
  });

  describe('TaskManager State Machine & Reset', () => {
    it('executes state-verified task transitions and resets deterministically', () => {
      expect(taskManager.getState().status).toBe('Idle');
      expect(taskManager.getState().currentTaskId).toBeNull();

      taskManager.startTask('TD1');
      let state = taskManager.getState();
      expect(state.status).toBe('In Progress');
      expect(state.currentTaskId).toBe('TD1');
      expect(state.definitionVersion).toBe('TD-v2');

      taskManager.recordInteraction('nav-Analytics', 'click');
      taskManager.updateUiState({
        page: 'Analytics',
        appliedFilters: { dateFrom: '', region: 'All', categories: [] },
        visibleRowCount: 50,
        empty: false,
        currentReportId: null,
        visitedReportIds: []
      });
      taskManager.recordInteraction('filter-section-region', 'click');
      taskManager.recordInteraction('filter-Region-select', 'change');
      taskManager.updateUiState({
        page: 'Analytics',
        appliedFilters: { dateFrom: '', region: 'Europe', categories: [] },
        visibleRowCount: 18,
        empty: false,
        currentReportId: null,
        visitedReportIds: []
      });
      taskManager.recordInteraction('btn-apply-filters', 'click');
      expect(taskManager.getState().status).toBe('In Progress');
      taskManager.recordInteraction('btn-export', 'click');

      state = taskManager.getState();
      expect(state.status).toBe('Completed');
      expect(state.errors).toBe(0);
      expect(state.completedSteps).toEqual(['TD1-1', 'TD1-2', 'TD1-3', 'TD1-4', 'TD1-5']);
      expect(state.endTime).toBeDefined();

      taskManager.resetTask();
      const resetState = taskManager.getState();
      expect(resetState.status).toBe('Idle');
      expect(resetState.currentTaskId).toBeNull();
      expect(resetState.completedSteps).toHaveLength(0);
      expect(resetState.errors).toBe(0);
    });
  });
});

