/**
 * Task wiring (assessment §6, §25 P0-4).
 *
 * Two invariants are asserted here:
 * 1. Every component id a task step expects actually exists in the rendered UI, so no
 *    task can be impossible to complete because of a naming mismatch.
 * 2. Driving the real UI through a task produces explicit task lifecycle events.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { App } from '../src/app/App';
import { FilterDrawer } from '../src/testbed/components/FilterDrawer';
import { ResultsTable } from '../src/testbed/components/ResultsTable';
import { Navigation } from '../src/app/Navigation';
import { KPICards } from '../src/testbed/components/KPICards';
import { TrialControls } from '../src/testbed/components/TrialControls';
import { EXPERIMENTAL_TASKS, TaskId, getTaskRequiredComponentIds } from '../src/testbed/tasks/taskModel';
import { taskManager, TaskLifecycleEvent } from '../src/testbed/tasks/taskManager';
import { experimentRecorder } from '../src/telemetry/recorder';
import { defaultTelemetryObserver } from '../src/telemetry/observer';
import { generateDeterministicData, defaultTableData } from '../src/testbed/mock-data/tableData';

/** Action recorded against the task model for each observed event type. */
const TASK_ACTION_BY_EVENT: Record<string, string> = {
  click: 'click',
  submit: 'submit',
  change: 'change',
  input: 'input'
};

function renderTestbedSurface() {
  return render(
    <div data-aui-route="Analytics">
      <Navigation currentPage="Analytics" onNavigate={() => {}} />
      <FilterDrawer />
      <TrialControls />
      <KPICards />
      <ResultsTable />
    </div>
  );
}

describe('Task model / DOM annotation contract', () => {
  beforeEach(() => {
    taskManager.resetTask();
  });

  it('every task step references a component that is actually rendered', () => {
    const { container } = renderTestbedSurface();
    const missing: string[] = [];

    const selectorFor = (componentId: string) =>
      `[data-aui-component="${componentId.replace(/"/g, '\\"')}"]`;

    // Sections are progressively disclosed: a control inside a collapsed accordion is
    // not in the DOM until its section is opened, which is exactly what the task step
    // preceding it asks the participant to do.
    const sectionForControl = (componentId: string) =>
      Array.from(container.querySelectorAll('[data-aui-role="accordion"]')).find(
        (accordion) => {
          const section = accordion.parentElement;
          return Boolean(section && section.querySelector(selectorFor(componentId)));
        }
      ) as HTMLElement | undefined;

    // Controls are children of the accordion's sibling content block, so a control
    // inside a closed section is absent from the DOM entirely.
    const collapseAll = () => {
      for (const accordion of Array.from(
        container.querySelectorAll('[data-aui-role="accordion"]')
      ) as HTMLElement[]) {
        if (accordion.getAttribute('aria-expanded') === 'true') accordion.click();
      }
    };

    act(() => collapseAll());

    const requiredIds = (Object.keys(EXPERIMENTAL_TASKS) as TaskId[]).flatMap((taskId) =>
      getTaskRequiredComponentIds(taskId).map((componentId) => ({ taskId, componentId }))
    );

    // Open each accordion in turn and check which required controls it reveals.
    const remaining = new Set(requiredIds.map(({ componentId }) => componentId));
    for (const accordion of Array.from(
      container.querySelectorAll('[data-aui-role="accordion"]')
    ) as HTMLElement[]) {
      act(() => accordion.click());
      for (const { taskId, componentId } of requiredIds) {
        if (container.querySelector(selectorFor(componentId))) {
          remaining.delete(componentId);
        } else if (accordion.parentElement?.innerText?.includes(componentId)) {
          missing.push(`${taskId} -> ${componentId}`);
        }
      }
    }

    for (const { taskId, componentId } of requiredIds) {
      if (remaining.has(componentId)) {
        missing.push(`${taskId} -> ${componentId}`);
      }
    }

    expect(missing).toEqual([]);
  });

  it('has a declared expected action for every step', () => {
    for (const taskId of Object.keys(EXPERIMENTAL_TASKS) as TaskId[]) {
      for (const step of EXPERIMENTAL_TASKS[taskId].steps) {
        expect(step.expectedAction).toBeTruthy();
        expect(step.expectedComponentId).toBeTruthy();
      }
    }
  });

  it('renders trial controls that can start and reset a task', () => {
    renderTestbedSurface();

    expect(screen.getByText(/Experimental Trial/i)).not.toBeNull();
    expect(document.querySelector('[data-aui-component="btn-start-T1"]')).not.toBeNull();
    expect(document.querySelector('[data-aui-component="btn-reset-trial"]')).not.toBeNull();
    expect(document.querySelector('[data-aui-component="condition-baseline"]')).not.toBeNull();
    expect(document.querySelector('[data-aui-component="condition-adaptive"]')).not.toBeNull();
  });
});

describe('Task lifecycle events from real UI interaction', () => {
  let lifecycle: TaskLifecycleEvent[];
  let unsubscribe: () => void;

  beforeEach(() => {
    taskManager.resetTask();
    experimentRecorder.clear();
    lifecycle = [];
    unsubscribe = taskManager.onLifecycle((event) => lifecycle.push(event));
  });

  afterEach(() => {
    unsubscribe();
    taskManager.resetTask();
    document.body.innerHTML = '';
  });

  it('emits task_start when a task is started and task_reset when reset', () => {
    act(() => {
      taskManager.startTask('T1');
    });
    expect(lifecycle.map((e) => e.type)).toContain('task_start');
    expect(taskManager.getState().status).toBe('In Progress');

    act(() => {
      taskManager.resetTask();
    });
    // Resetting an in-progress task records an abandonment, then the reset.
    expect(lifecycle.map((e) => e.type)).toContain('task_abandon');
    expect(lifecycle.map((e) => e.type)).toContain('task_reset');
    expect(taskManager.getState().status).toBe('Idle');
  });

  it('completes T1 through the real observer bridge and records the lifecycle', () => {
    // Bridge observed events into the task manager exactly as App.tsx does.
    const unsubBridge = defaultTelemetryObserver.subscribe((event) => {
      const action = TASK_ACTION_BY_EVENT[event.type];
      if (action && event.componentId) {
        taskManager.recordInteraction(event.componentId, action);
      }
    });

    renderTestbedSurface();
    defaultTelemetryObserver.start();

    act(() => {
      taskManager.startTask('T1');
    });

    const clickComponent = (componentId: string) => {
      const el = document.querySelector(`[data-aui-component="${componentId}"]`) as HTMLElement;
      expect(el).not.toBeNull();
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 5, clientY: 5 }));
    };

    // T1-1 navigate, T1-2 open Region accordion, T1-3 select region, T1-4 apply.
    act(() => clickComponent('nav-Analytics'));

    // T1-1 navigate, T1-2 open the Region section, which discloses its <select>.
    act(() => clickComponent('filter-Region'));

    const select = document.querySelector(
      '[data-aui-component="filter-Region-select"]'
    ) as HTMLSelectElement;
    expect(select).not.toBeNull();

    act(() => {
      select.value = 'Europe';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    act(() => clickComponent('btn-apply-filters'));

    const state = taskManager.getState();
    expect(state.status).toBe('Completed');
    expect(state.completedSteps).toEqual(['T1-1', 'T1-2', 'T1-3', 'T1-4']);

    const completeEvent = lifecycle.find((e) => e.type === 'task_complete');
    expect(completeEvent).toBeDefined();
    expect(completeEvent?.taskId).toBe('T1');
    expect(typeof completeEvent?.durationMs).toBe('number');

    defaultTelemetryObserver.stop();
    unsubBridge();
  });

  it('counts a wrong interaction as a task error without completing a step', () => {
    act(() => {
      taskManager.startTask('T2');
    });

    act(() => {
      taskManager.recordInteraction('btn-export', 'click'); // step 1 is nav-Analytics
    });

    const state = taskManager.getState();
    expect(state.status).toBe('In Progress');
    expect(state.errors).toBe(1);
    expect(lifecycle.some((e) => e.type === 'task_error')).toBe(true);
  });

  it('records abandonment when the trial is reset mid-task', () => {
    act(() => {
      taskManager.startTask('T3');
    });
    act(() => {
      taskManager.resetTask();
    });

    const abandon = lifecycle.find((e) => e.type === 'task_abandon');
    expect(abandon).toBeDefined();
    expect(abandon?.reason).toBe('reset');
  });

  it('records an explicit abandonment with a navigation reason', () => {
    act(() => {
      taskManager.startTask('T1');
    });
    act(() => {
      taskManager.abandonTask('navigation');
    });

    expect(taskManager.getState().status).toBe('Abandoned');
    expect(taskManager.getState().abandonmentReason).toBe('navigation');
  });
});

describe('Deterministic stimulus data (assessment §6.1)', () => {
  it('produces identical rows for the same seed', () => {
    const a = generateDeterministicData(20, 1234);
    const b = generateDeterministicData(20, 1234);
    expect(a).toEqual(b);
  });

  it('produces different rows for different seeds', () => {
    const a = generateDeterministicData(20, 1);
    const b = generateDeterministicData(20, 2);
    expect(a).not.toEqual(b);
  });

  it('does not change between module evaluations', () => {
    // The default dataset must be stable, not regenerated with Math.random().
    const again = generateDeterministicData(50);
    expect(again).toEqual(defaultTableData);
  });
});
