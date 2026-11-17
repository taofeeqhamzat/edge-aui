/**
 * Task wiring for the TD1–TD4 testbed.
 *
 * These tests drive the real React testbed. Task completion is state-verified, so the tests
 * assert the resulting UI state and lifecycle events rather than only that a control was touched.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { App } from '../src/app/App';
import { EXPERIMENTAL_TASKS, TaskId, getTaskRequiredComponentIds } from '../src/testbed/tasks/taskModel';
import { taskManager, TaskLifecycleEvent } from '../src/testbed/tasks/taskManager';
import { defaultTelemetryObserver } from '../src/telemetry/observer';

function click(selector: string): void {
  const element = document.querySelector(selector) as HTMLElement | null;
  expect(element, `missing ${selector}`).not.toBeNull();
  act(() => {
    fireEvent.click(element!);
  });
}

function select(selector: string, value: string): void {
  const element = document.querySelector(selector) as HTMLSelectElement | null;
  expect(element, `missing ${selector}`).not.toBeNull();
  act(() => {
    fireEvent.change(element!, { target: { value } });
  });
}

function navigate(page: 'Analytics' | 'Reports' | 'Overview'): void {
  click(`[data-aui-component="nav-${page}"]`);
}

function trialText(): string {
  return document.querySelector('[data-aui-component="trial-status"]')?.textContent ?? '';
}

function openSection(componentId: string): void {
  const section = document.querySelector(`[data-aui-component="${componentId}"]`);
  if (section?.getAttribute('aria-expanded') !== 'true') {
    click(`[data-aui-component="${componentId}"]`);
  }
}

const TASK_ACTION_BY_EVENT: Record<string, string> = {
  click: 'click',
  submit: 'submit',
  change: 'change',
  input: 'input',
};

describe('Task model / DOM annotation contract', () => {
  let unsubscribeBridge: (() => void) | undefined;

  beforeEach(() => {
    taskManager.resetTask();
    unsubscribeBridge = defaultTelemetryObserver.subscribe((event) => {
      const action = TASK_ACTION_BY_EVENT[event.type];
      if (action && event.componentId) {
        taskManager.recordInteraction(event.componentId, action);
      }
    });
    defaultTelemetryObserver.start();
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:test'),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    defaultTelemetryObserver.stop();
    unsubscribeBridge?.();
    unsubscribeBridge = undefined;
    taskManager.resetTask();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('references rendered controls for every task', () => {
    render(<App />);

    navigate('Analytics');
    click('[data-aui-component="filter-section-date-range"]');
    click('[data-aui-component="filter-section-region"]');
    click('[data-aui-component="filter-section-product-category"]');

    const visibleIds = new Set(
      Array.from(document.querySelectorAll('[data-aui-component]')).map((element) =>
        element.getAttribute('data-aui-component'),
      ),
    );

    navigate('Reports');
    for (const element of Array.from(document.querySelectorAll('[data-aui-component]'))) {
      visibleIds.add(element.getAttribute('data-aui-component'));
    }

    const missing: string[] = [];
    for (const taskId of Object.keys(EXPERIMENTAL_TASKS) as TaskId[]) {
      for (const componentId of getTaskRequiredComponentIds(taskId)) {
        if (!visibleIds.has(componentId)) missing.push(`${taskId} -> ${componentId}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('exposes TD1–TD4 start controls and a reset control', () => {
    render(<App />);
    for (const taskId of Object.keys(EXPERIMENTAL_TASKS) as TaskId[]) {
      expect(document.querySelector(`[data-aui-component="btn-start-${taskId}"]`)).not.toBeNull();
    }
    expect(document.querySelector('[data-aui-component="btn-reset-trial"]')).not.toBeNull();
  });

  it('normalizes the starting state and disables replacement while in progress', () => {
    render(<App />);
    navigate('Reports');
    click('[data-aui-component="btn-start-TD1"]');

    expect(taskManager.getState().status).toBe('In Progress');
    expect(taskManager.getState().currentTaskId).toBe('TD1');
    expect(document.querySelector('.app-container')?.getAttribute('data-aui-route')).toBe('Overview');
    expect((document.querySelector('[data-aui-component="btn-start-TD1"]') as HTMLButtonElement).disabled).toBe(true);
    expect((document.querySelector('[data-aui-component="condition-adaptive"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('completes TD1 from the real UI and records the lifecycle', () => {
    const lifecycle: TaskLifecycleEvent[] = [];
    const unsubscribe = taskManager.onLifecycle((event) => lifecycle.push(event));
    render(<App />);

    click('[data-aui-component="btn-start-TD1"]');
    expect(trialText()).toContain('TD1-1');
    navigate('Analytics');
    expect(trialText()).toContain('TD1-2');
    click('[data-aui-component="filter-section-region"]');
    expect(trialText()).toContain('TD1-3');
    select('[data-aui-component="filter-Region-select"]', 'Europe');
    expect(trialText()).toContain('TD1-4');
    click('[data-aui-component="btn-apply-filters"]');
    expect(trialText()).toContain('TD1-5');
    click('[data-aui-component="btn-export"]');

    const state = taskManager.getState();
    expect(trialText()).toContain('Completed');
    expect(state.status).toBe('Completed');
    expect(state.errors).toBe(0);
    expect(state.completedSteps).toEqual(['TD1-1', 'TD1-2', 'TD1-3', 'TD1-4', 'TD1-5']);
    expect(lifecycle.some((event) => event.type === 'task_start')).toBe(true);
    expect(lifecycle.some((event) => event.type === 'task_complete')).toBe(true);
    unsubscribe();
  });

  it('does not complete TD2 when the required state is wrong', () => {
    render(<App />);
    click('[data-aui-component="btn-start-TD2"]');
    click('[data-aui-component="btn-apply-filters"]');

    expect(taskManager.getState().status).toBe('In Progress');
  });

  it('opens a report, synchronizes the preset filters, and shows the current report', () => {
    render(<App />);
    navigate('Reports');
    click('[data-aui-component="open-report-eu-books"]');

    expect(screen.getByText('Report: Europe Books')).not.toBeNull();
    expect(screen.getByText('Results (6)')).not.toBeNull();
    openSection('filter-section-region');
    openSection('filter-section-product-category');
    expect((document.querySelector('[data-aui-component="filter-Region-select"]') as HTMLSelectElement).value).toBe('Europe');
    expect((document.querySelector('[data-aui-component="filter-category-books"]') as HTMLInputElement).checked).toBe(true);
  });

  it('keeps table and drawer filter state consistent across navigation', () => {
    render(<App />);
    navigate('Analytics');
    click('[data-aui-component="filter-section-region"]');
    select('[data-aui-component="filter-Region-select"]', 'Europe');
    click('[data-aui-component="btn-apply-filters"]');
    expect(screen.getByText('Results (18)')).not.toBeNull();

    navigate('Reports');
    navigate('Analytics');
    expect(screen.getByText('Results (18)')).not.toBeNull();
    openSection('filter-section-region');
    expect((document.querySelector('[data-aui-component="filter-Region-select"]') as HTMLSelectElement).value).toBe('Europe');
  });

  it('resets drafts and applied filters', () => {
    render(<App />);
    navigate('Analytics');
    click('[data-aui-component="filter-section-region"]');
    select('[data-aui-component="filter-Region-select"]', 'Europe');
    click('[data-aui-component="btn-apply-filters"]');
    click('[data-aui-component="btn-reset-filters"]');

    expect(screen.getByText('Results (50)')).not.toBeNull();
    openSection('filter-section-region');
    expect((document.querySelector('[data-aui-component="filter-Region-select"]') as HTMLSelectElement).value).toBe('All');
  });

  it('completes TD2 with the correct date/category state and no spurious errors', () => {
    render(<App />);
    click('[data-aui-component="btn-start-TD2"]');
    expect(trialText()).toContain('TD2-1');
    openSection('filter-section-date-range');
    expect(trialText()).toContain('TD2-2');
    const dateInput = document.querySelector('[data-aui-component="filter-date-input"]') as HTMLInputElement;
    act(() => {
      fireEvent.change(dateInput, { target: { value: '2025-06-01' } });
    });
    expect(trialText()).toContain('TD2-3');
    openSection('filter-section-product-category');
    expect(trialText()).toContain('TD2-4');
    const books = document.querySelector('[data-aui-component="filter-category-books"]') as HTMLInputElement;
    act(() => {
      fireEvent.click(books);
    });
    expect(trialText()).toContain('TD2-5');
    click('[data-aui-component="btn-apply-filters"]');

    expect(screen.getByText('Results (5)')).not.toBeNull();
    expect(trialText()).toContain('Completed');
    expect(taskManager.getState().status).toBe('Completed');
    expect(taskManager.getState().errors).toBe(0);
  });

  it('shows the exact value each step expects', () => {
    // TD2's old prose ("on or after 1 June") admitted a later date that the completion
    // predicate rejects. The step labels now name the exact target the predicate checks.
    render(<App />);
    click('[data-aui-component="btn-start-TD2"]');

    openSection('filter-section-date-range');
    // Opening the section completes TD2-1, so the step shown is the exact date instruction.
    expect(trialText()).toContain('Set the start date to 1 June 2025');
    const dateInput = document.querySelector('[data-aui-component="filter-date-input"]') as HTMLInputElement;
    act(() => {
      fireEvent.change(dateInput, { target: { value: '2025-06-01' } });
    });
    openSection('filter-section-product-category');
    expect(trialText()).toContain('Select only Books');
  });

  it('explains locked controls while a trial is incomplete and restores them on completion', () => {
    render(<App />);
    click('[data-aui-component="btn-start-TD2"]');
    openSection('filter-section-date-range');
    const dateInput = document.querySelector('[data-aui-component="filter-date-input"]') as HTMLInputElement;
    act(() => {
      fireEvent.change(dateInput, { target: { value: '2025-07-01' } });
    });
    openSection('filter-section-product-category');
    act(() => {
      fireEvent.click(
        document.querySelector('[data-aui-component="filter-category-books"]') as HTMLInputElement
      );
    });
    click('[data-aui-component="btn-apply-filters"]');

    // The later start date is a reasonable reading of the old prose but not the task's
    // required state, so the trial stays open. The locked controls must say why.
    expect(taskManager.getState().status).toBe('In Progress');
    const note = document.querySelector('[data-aui-component="trial-lock-note"]');
    expect(note).not.toBeNull();
    expect(note?.textContent).toContain('Trial controls are disabled while a task is in progress');
    expect(note?.textContent).toContain('Reset Trial');
    expect(note?.getAttribute('aria-live')).toBe('polite');
    // Every step has been visited, so the step line must not read "N/A" while the trial is
    // still open: that is the state that looked inexplicable to a participant.
    expect(trialText()).toContain("the task's required state is not met yet");
    expect(
      document.querySelector('[data-aui-component="condition-selector"]')?.getAttribute('aria-describedby')
    ).toBe('trial-lock-note');
    expect(
      (document.querySelector('[data-aui-component="btn-start-TD3"]') as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (document.querySelector('[data-aui-component="condition-adaptive"]') as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (document.querySelector('[data-aui-component="btn-reset-trial"]') as HTMLButtonElement).disabled
    ).toBe(false);

    // Correcting the date completes the trial; the explanation disappears with the lock.
    act(() => {
      fireEvent.change(dateInput, { target: { value: '2025-06-01' } });
    });
    click('[data-aui-component="btn-apply-filters"]');
    expect(taskManager.getState().status).toBe('Completed');
    expect(document.querySelector('[data-aui-component="trial-lock-note"]')).toBeNull();
    expect(
      (document.querySelector('[data-aui-component="btn-start-TD3"]') as HTMLButtonElement).disabled
    ).toBe(false);
  });

  it('completes TD3 from the empty state and a Reset Filters recovery', () => {
    render(<App />);
    click('[data-aui-component="btn-start-TD3"]');
    openSection('filter-section-region');
    select('[data-aui-component="filter-Region-select"]', 'Europe');
    openSection('filter-section-product-category');
    const books = document.querySelector('[data-aui-component="filter-category-books"]') as HTMLInputElement;
    act(() => {
      fireEvent.click(books);
    });
    openSection('filter-section-date-range');
    const dateInput = document.querySelector('[data-aui-component="filter-date-input"]') as HTMLInputElement;
    act(() => {
      fireEvent.change(dateInput, { target: { value: '2025-09-01' } });
    });
    click('[data-aui-component="btn-apply-filters"]');

    expect(screen.getByText('Results (0)')).not.toBeNull();
    expect(taskManager.getState().status).toBe('In Progress');
    click('[data-aui-component="btn-reset-filters"]');

    expect(screen.getByText('Results (50)')).not.toBeNull();
    expect(taskManager.getState().status).toBe('Completed');
    expect(taskManager.getState().errors).toBe(0);
  });

  it('completes TD4 by comparing both reports and exporting Europe Books', () => {
    render(<App />);
    click('[data-aui-component="btn-start-TD4"]');
    expect(document.querySelector('.app-container')?.getAttribute('data-aui-route')).toBe('Reports');
    click('[data-aui-component="open-report-eu-electronics"]');
    expect(screen.getByText('Results (3)')).not.toBeNull();
    navigate('Reports');
    click('[data-aui-component="open-report-eu-books"]');
    expect(screen.getByText('Results (6)')).not.toBeNull();
    click('[data-aui-component="btn-export"]');

    expect(taskManager.getState().status).toBe('Completed');
    expect(taskManager.getState().errors).toBe(0);
  });

  it('normalizes filter disclosure when the next trial starts', () => {
    // The drawer keeps its open sections in local state. A participant who finishes TD2 with
    // the date and category sections open must not start TD3 with them already expanded,
    // because TD3's canonical path asks them to open those sections themselves.
    render(<App />);
    click('[data-aui-component="btn-start-TD2"]');
    openSection('filter-section-date-range');
    openSection('filter-section-product-category');
    const dateInput = document.querySelector('[data-aui-component="filter-date-input"]') as HTMLInputElement;
    act(() => {
      fireEvent.change(dateInput, { target: { value: '2025-06-01' } });
    });
    act(() => {
      fireEvent.click(
        document.querySelector('[data-aui-component="filter-category-books"]') as HTMLInputElement
      );
    });
    click('[data-aui-component="btn-apply-filters"]');
    expect(taskManager.getState().status).toBe('Completed');
    expect(
      document.querySelector('[data-aui-component="filter-section-date-range"]')?.getAttribute('aria-expanded')
    ).toBe('true');

    click('[data-aui-component="btn-start-TD3"]');

    expect(taskManager.getState().status).toBe('In Progress');
    expect(
      document.querySelector('[data-aui-component="filter-section-date-range"]')?.getAttribute('aria-expanded')
    ).toBe('false');
    expect(
      document.querySelector('[data-aui-component="filter-section-product-category"]')?.getAttribute('aria-expanded')
    ).toBe('false');
  });

  it('records abandonment when Reset Trial is used mid-task', () => {
    const lifecycle: TaskLifecycleEvent[] = [];
    const unsubscribe = taskManager.onLifecycle((event) => lifecycle.push(event));
    render(<App />);
    click('[data-aui-component="btn-start-TD2"]');
    click('[data-aui-component="btn-reset-trial"]');

    expect(lifecycle.some((event) => event.type === 'task_abandon' && event.reason === 'reset')).toBe(true);
    expect(taskManager.getState().status).toBe('Idle');
    unsubscribe();
  });
});
