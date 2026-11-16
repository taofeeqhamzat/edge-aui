import {
  AbandonmentReason,
  EXPERIMENTAL_TASKS,
  INITIAL_TASK_EVIDENCE,
  INITIAL_TASK_UI_STATE,
  TaskEvidence,
  TaskFailureReason,
  TaskId,
  TaskState,
  TaskStatus,
  TaskUiState,
  TargetTask,
  TargetTaskStep
} from './taskModel';
import { evaluateTaskCompletion } from './completion';
import { getWallClockTimestamp } from '../../telemetry/normalizer';

type StateChangeListener = (state: TaskState) => void;

/** Emitted on every task lifecycle transition, for the experiment trace. */
export interface TaskLifecycleEvent {
  timestamp: number;
  type:
    | 'task_start'
    | 'task_step'
    | 'task_complete'
    | 'task_error'
    | 'task_reset'
    | 'task_abandon'
    | 'task_fail';
  taskId: TaskId | null;
  taskStepId?: string;
  status: TaskStatus;
  errors: number;
  /** Present on `task_complete`. */
  durationMs?: number;
  /** Present on `task_abandon` and `task_fail`. */
  reason?: AbandonmentReason | TaskFailureReason;
  /** Task-definition version the trial was run under. */
  definitionVersion?: 'TD-v2';
}

export type TaskLifecycleListener = (event: TaskLifecycleEvent) => void;

/**
 * Deterministic experimental task state machine.
 *
 * Completion is state-verified: the predicate in `completion.ts` must pass against the testbed's
 * UI snapshot and observed action evidence. The step list is a canonical guide and diagnostic
 * trace, not a control-touch success gate.
 */
export class TaskManager {
  private state: TaskState;
  private evidence: TaskEvidence = { ...INITIAL_TASK_EVIDENCE };
  private listeners: Set<StateChangeListener> = new Set();
  private lifecycleListeners: Set<TaskLifecycleListener> = new Set();
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.state = this.getInitialState();
  }

  private getInitialState(
    taskId: TaskId | null = null,
    uiState: TaskUiState = INITIAL_TASK_UI_STATE
  ): TaskState {
    return {
      currentTaskId: taskId,
      status: 'Idle',
      currentStepIndex: 0,
      completedSteps: [],
      errors: 0,
      definitionVersion: taskId ? 'TD-v2' : undefined,
      uiState: cloneUiState(uiState)
    };
  }

  public subscribe(listener: StateChangeListener): () => void {
    const unsubscribe = addListener(this.listeners, listener);
    listener(this.state);
    return unsubscribe;
  }

  /** Subscribes to task lifecycle transitions. */
  public onLifecycle(listener: TaskLifecycleListener): () => void {
    return addListener(this.lifecycleListeners, listener);
  }

  private notify() {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private emitLifecycle(event: TaskLifecycleEvent): void {
    for (const listener of this.lifecycleListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[TaskManager] Lifecycle listener error:', err);
      }
    }
  }

  public startTask(taskId: TaskId, initialState: TaskUiState = INITIAL_TASK_UI_STATE) {
    if (this.state.status === 'In Progress' && this.state.currentTaskId !== null) {
      this.abandonTask('replaced');
    }
    this.clearTimeout();

    const task = EXPERIMENTAL_TASKS[taskId];
    this.evidence = { ...INITIAL_TASK_EVIDENCE };
    this.state = {
      ...this.getInitialState(taskId, initialState),
      status: 'In Progress',
      startTime: getWallClockTimestamp()
    };

    this.scheduleTimeout(task.timeoutMs);
    this.notify();
    this.emitLifecycle({
      timestamp: getWallClockTimestamp(),
      type: 'task_start',
      taskId,
      status: this.state.status,
      errors: 0,
      definitionVersion: task.definitionVersion
    });
  }

  /**
   * Updates the UI snapshot used by the completion predicate. Called by the testbed host on
   * relevant React state changes; it never comes from framework core.
   */
  public updateUiState(uiState: TaskUiState) {
    this.state = { ...this.state, uiState: cloneUiState(uiState) };

    if (uiState.empty && this.evidence.applyRecorded) {
      this.evidence.sawEmptyResult = true;
    }

    if (this.state.status === 'In Progress') {
      this.checkCompletion();
      this.notify();
    }
  }

  /**
   * Resets to Idle. When a task was in progress it is recorded as abandoned rather
   * than silently discarded, so incomplete trials remain visible in the trace.
   */
  public resetTask() {
    const wasInProgress = this.state.status === 'In Progress' && this.state.currentTaskId !== null;

    if (wasInProgress) {
      this.abandonTask('reset');
    }

    this.clearTimeout();
    this.evidence = { ...INITIAL_TASK_EVIDENCE };
    this.state = this.getInitialState();
    this.notify();
    this.emitLifecycle({
      timestamp: getWallClockTimestamp(),
      type: 'task_reset',
      taskId: null,
      status: this.state.status,
      errors: 0
    });
  }

  /**
   * Records an interaction against the active task.
   *
   * A step is marked complete when its component id and action match any not-yet-completed step,
   * so a valid out-of-order action still progresses. Duplicate companion events (checkbox
   * click/input alongside change, form submit alongside the Apply click) are ignored rather than
   * counted as errors. A genuinely wrong action on a required control increments `errors`.
   */
  public recordInteraction(componentId: string, action: string) {
    if (this.state.status !== 'In Progress' || !this.state.currentTaskId) return;

    const task = EXPERIMENTAL_TASKS[this.state.currentTaskId];
    const completed = new Set(this.state.completedSteps);
    this.evidence = updateEvidence(this.evidence, componentId, action, this.state.uiState);

    const matchingStep = findUncompletedStep(task, completed, componentId, action);
    if (matchingStep) {
      this.completeStep(matchingStep.stepId);
      this.checkCompletion();
      return;
    }

    const expectedStep = findExpectedStep(task, completed, componentId);
    if (!expectedStep || isBenignCompanion(expectedStep.expectedAction, action)) return;
    if (!isActionBearing(action)) return;

    this.recordError(expectedStep.stepId, task.definitionVersion);
  }

  private recordError(stepId: string, definitionVersion: 'TD-v2'): void {
    this.state = { ...this.state, errors: this.state.errors + 1 };
    this.notify();
    this.emitLifecycle({
      timestamp: getWallClockTimestamp(),
      type: 'task_error',
      taskId: this.state.currentTaskId,
      taskStepId: stepId,
      status: this.state.status,
      errors: this.state.errors,
      definitionVersion
    });
  }

  private completeStep(stepId: string) {
    const completedSteps = [...this.state.completedSteps, stepId];
    this.state = {
      ...this.state,
      completedSteps,
      currentStepIndex: completedSteps.length
    };
    this.notify();
    this.emitLifecycle({
      timestamp: getWallClockTimestamp(),
      type: 'task_step',
      taskId: this.state.currentTaskId,
      taskStepId: stepId,
      status: this.state.status,
      errors: this.state.errors,
      definitionVersion: this.state.definitionVersion
    });
  }

  private checkCompletion(): void {
    if (this.state.status !== 'In Progress' || !this.state.currentTaskId) return;

    const uiState = this.state.uiState ?? INITIAL_TASK_UI_STATE;
    if (!evaluateTaskCompletion(this.state.currentTaskId, uiState, this.evidence)) return;

    this.clearTimeout();
    this.state = {
      ...this.state,
      status: 'Completed',
      endTime: getWallClockTimestamp()
    };
    this.notify();

    const durationMs =
      this.state.startTime !== undefined && this.state.endTime !== undefined
        ? this.state.endTime - this.state.startTime
        : undefined;

    this.emitLifecycle({
      timestamp: getWallClockTimestamp(),
      type: 'task_complete',
      taskId: this.state.currentTaskId,
      taskStepId: this.state.completedSteps[this.state.completedSteps.length - 1],
      status: this.state.status,
      errors: this.state.errors,
      durationMs,
      definitionVersion: this.state.definitionVersion
    });
  }

  /** Marks the active task abandoned without resetting the machine. */
  public abandonTask(reason: AbandonmentReason | TaskFailureReason = 'interrupted') {
    if (reason === 'timeout') {
      this.failTask('timeout');
      return;
    }
    if (this.state.status !== 'In Progress' || !this.state.currentTaskId) return;

    this.clearTimeout();
    this.state = {
      ...this.state,
      status: 'Abandoned',
      endTime: getWallClockTimestamp(),
      abandonmentReason: reason
    };
    this.notify();
    this.emitLifecycle({
      timestamp: getWallClockTimestamp(),
      type: 'task_abandon',
      taskId: this.state.currentTaskId,
      status: this.state.status,
      errors: this.state.errors,
      reason,
      definitionVersion: this.state.definitionVersion
    });
  }

  private failTask(reason: TaskFailureReason) {
    if (this.state.status !== 'In Progress' || !this.state.currentTaskId) return;

    this.clearTimeout();
    this.state = {
      ...this.state,
      status: 'Failed',
      endTime: getWallClockTimestamp(),
      failureReason: reason
    };
    this.notify();
    this.emitLifecycle({
      timestamp: getWallClockTimestamp(),
      type: 'task_fail',
      taskId: this.state.currentTaskId,
      status: this.state.status,
      errors: this.state.errors,
      reason,
      definitionVersion: this.state.definitionVersion
    });
  }

  private scheduleTimeout(timeoutMs: number): void {
    this.clearTimeout();
    this.timeoutHandle = setTimeout(() => {
      this.timeoutHandle = null;
      this.failTask('timeout');
    }, timeoutMs);
  }

  private clearTimeout(): void {
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }

  public getState(): TaskState {
    return this.state;
  }
}

function addListener<T>(listeners: Set<T>, listener: T): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function updateEvidence(
  evidence: TaskEvidence,
  componentId: string,
  action: string,
  uiState: TaskUiState | undefined
): TaskEvidence {
  const next = { ...evidence };
  if (isApplyInteraction(componentId, action)) next.applyRecorded = true;
  if (componentId === 'btn-reset-filters' && action === 'click') next.resetRecorded = true;
  if (componentId === 'btn-export' && action === 'click') next.exportRecorded = true;
  if (uiState?.empty && next.applyRecorded) next.sawEmptyResult = true;
  return next;
}

function isApplyInteraction(componentId: string, action: string): boolean {
  return componentId === 'btn-apply-filters' ||
    (componentId === 'filter-drawer' && action === 'submit');
}

function findUncompletedStep(
  task: TargetTask,
  completed: Set<string>,
  componentId: string,
  action: string
): TargetTaskStep | undefined {
  return task.steps.find(
    (step) =>
      !completed.has(step.stepId) &&
      step.expectedComponentId === componentId &&
      step.expectedAction === action
  );
}

function findExpectedStep(
  task: TargetTask,
  completed: Set<string>,
  componentId: string
): TargetTaskStep | undefined {
  return task.steps.find(
    (step) => !completed.has(step.stepId) && step.expectedComponentId === componentId
  );
}

const ACTION_BEARING = new Set(['click', 'change', 'submit']);

function isActionBearing(action: string): boolean {
  return ACTION_BEARING.has(action);
}

function cloneUiState(state: TaskUiState): TaskUiState {
  return {
    ...state,
    appliedFilters: {
      ...state.appliedFilters,
      categories: [...state.appliedFilters.categories]
    },
    visitedReportIds: [...state.visitedReportIds]
  };
}

function isBenignCompanion(expectedAction: string | undefined, action: string): boolean {
  // The observer emits native click/input/change for a checkbox and click/submit for a form.
  // Only the committed event should count; the companions are not errors.
  if (expectedAction === 'change' && (action === 'click' || action === 'input')) return true;
  if (expectedAction === 'click' && action === 'submit') return true;
  return false;
}

export const taskManager = new TaskManager();
