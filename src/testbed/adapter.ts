/**
 * Testbed UI Adapter
 *
 * Implements Stage 4.1 specifications from docs/plan/1/tasks/4.1.md and ADR-011.
 * Serves as the reference implementation of UiAdapter for the target testbed application.
 */

import { UiAdapter, UiTaskStateSnapshot, UiTaskLifecycleEvent, DEFAULT_TASK_ACTION_BY_EVENT } from '../integration/index';
import { taskManager } from './tasks/taskManager';
import { EXPERIMENTAL_TASKS } from './tasks/taskModel';
import { getActiveUIContext, setTaskContextResolver } from '../telemetry/contextProvider';
import { UIContext } from '../types/uiContext';

export function initTestbedAdapter(): void {
  setTaskContextResolver(() => {
    const state = taskManager.getState();
    if (!state || !state.currentTaskId) {
      return {};
    }
    const task = EXPERIMENTAL_TASKS[state.currentTaskId];
    const step = task?.steps?.[state.currentStepIndex];
    return {
      taskId: state.currentTaskId,
      taskStepId: step?.stepId
    };
  });
}

// Auto-register for testbed application environment
initTestbedAdapter();

export class TestbedUiAdapter implements UiAdapter {
  readonly id = 'edge-aui-testbed';
  readonly version = '1.0.0';

  onInit(): void {
    initTestbedAdapter();
  }

  onDestroy(): void {
    setTaskContextResolver(null);
  }

  getActiveContext(options?: {
    targetElement?: Element | null;
    root?: Document | HTMLElement;
  }): UIContext {
    let taskId: string | undefined;
    let taskStepId: string | undefined;
    const taskState = taskManager.getState();
    if (taskState && taskState.currentTaskId) {
      taskId = taskState.currentTaskId;
      const task = EXPERIMENTAL_TASKS[taskState.currentTaskId];
      if (task && task.steps && task.steps[taskState.currentStepIndex]) {
        taskStepId = task.steps[taskState.currentStepIndex].stepId;
      }
    }
    return getActiveUIContext({
      ...options,
      taskId,
      taskStepId
    });
  }

  getTaskState(): UiTaskStateSnapshot {
    return taskManager.getState();
  }

  onTaskStateChange(callback: (state: UiTaskStateSnapshot) => void): () => void {
    return taskManager.subscribe(callback);
  }

  onTaskLifecycle(callback: (event: UiTaskLifecycleEvent) => void): () => void {
    return taskManager.onLifecycle((evt) => {
      callback({
        timestamp: evt.timestamp,
        type: evt.type,
        taskId: evt.taskId,
        taskStepId: evt.taskStepId,
        status: evt.status,
        errors: evt.errors,
        durationMs: evt.durationMs,
        reason: evt.reason
      });
    });
  }

  recordInteraction(componentId: string, action: string): void {
    taskManager.recordInteraction(componentId, action);
  }

  abandonTask(reason: string): void {
    taskManager.abandonTask(reason as 'reset' | 'timeout' | 'navigation');
  }

  getTaskActionForEvent(eventType: string): string | undefined {
    return DEFAULT_TASK_ACTION_BY_EVENT[eventType];
  }
}

export const testbedAdapter = new TestbedUiAdapter();
