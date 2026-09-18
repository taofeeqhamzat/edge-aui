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

      // Navigate to Analytics
      const analyticsNavBtn = screen.getByRole('button', { name: /Analytics/i });
      act(() => {
        fireEvent.click(analyticsNavBtn);
      });

      // Analytics page renders KPICards, FilterDrawer, ResultsTable
      expect(screen.getByText('Filters')).not.toBeNull();
      expect(screen.getByText(/Results \(\d+\)/)).not.toBeNull();
      expect(screen.getByText('Total Revenue')).not.toBeNull();

      // Navigate to Reports
      const reportsNavBtn = screen.getByRole('button', { name: /Reports/i });
      act(() => {
        fireEvent.click(reportsNavBtn);
      });
      expect(screen.getByText('This is the Reports view.')).not.toBeNull();
    });
  });

  describe('FilterDrawer Component', () => {
    it('toggles accordions open and closed on click', () => {
      act(() => {
        render(<FilterDrawer />);
      });

      // Date Range is open by default
      expect(screen.getByRole('button', { name: /▼ Date Range/i })).not.toBeNull();

      // Product Category is closed by default
      const productCatBtn = screen.getByRole('button', { name: /▶ Product Category/i });
      expect(screen.queryByText('Electronics')).toBeNull();

      // Open Product Category accordion
      act(() => {
        fireEvent.click(productCatBtn);
      });
      expect(screen.getByText('Electronics')).not.toBeNull();

      // Collapse Date Range accordion
      const dateRangeBtn = screen.getByRole('button', { name: /▼ Date Range/i });
      act(() => {
        fireEvent.click(dateRangeBtn);
      });
      expect(screen.getByRole('button', { name: /▶ Date Range/i })).not.toBeNull();
    });

    it('handles filter selection changes and primary apply button click', () => {
      act(() => {
        render(<FilterDrawer />);
      });

      const regionSelect = screen.getByRole('combobox');
      act(() => {
        fireEvent.change(regionSelect, { target: { value: 'Europe' } });
      });
      expect((regionSelect as HTMLSelectElement).value).toBe('Europe');

      const applyBtn = screen.getByRole('button', { name: /Apply Filters/i });
      expect(applyBtn.getAttribute('data-aui-role')).toBe('primary-action');
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
    it('executes task transitions, records correct interactions, and resets deterministically', () => {
      expect(taskManager.getState().status).toBe('Idle');
      expect(taskManager.getState().currentTaskId).toBeNull();

      // Start Task T1
      taskManager.startTask('T1');
      let state = taskManager.getState();
      expect(state.status).toBe('In Progress');
      expect(state.currentTaskId).toBe('T1');
      expect(state.currentStepIndex).toBe(0);

      // Step 1: nav-Analytics / click
      taskManager.recordInteraction('nav-Analytics', 'click');
      state = taskManager.getState();
      expect(state.currentStepIndex).toBe(1);
      expect(state.completedSteps).toContain('T1-1');

      // Erroneous action on non-matching element increments errors
      taskManager.recordInteraction('wrong-button', 'click');
      state = taskManager.getState();
      expect(state.errors).toBe(1);
      expect(state.currentStepIndex).toBe(1);

      // Step 2: filter-Region / click
      taskManager.recordInteraction('filter-Region', 'click');
      expect(taskManager.getState().currentStepIndex).toBe(2);

      // Step 3: filter-Region-select / change
      taskManager.recordInteraction('filter-Region-select', 'change');
      expect(taskManager.getState().currentStepIndex).toBe(3);

      // Step 4: btn-apply-filters / click
      taskManager.recordInteraction('btn-apply-filters', 'click');
      state = taskManager.getState();
      expect(state.status).toBe('Completed');
      expect(state.completedSteps).toEqual(['T1-1', 'T1-2', 'T1-3', 'T1-4']);
      expect(state.endTime).toBeDefined();

      // Reset Task returns to clean initial state
      taskManager.resetTask();
      const resetState = taskManager.getState();
      expect(resetState.status).toBe('Idle');
      expect(resetState.currentTaskId).toBeNull();
      expect(resetState.currentStepIndex).toBe(0);
      expect(resetState.completedSteps).toHaveLength(0);
      expect(resetState.errors).toBe(0);
    });
  });
});
